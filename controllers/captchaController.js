import crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────
const CAPTCHA_SECRET  = process.env.CAPTCHA_SECRET || "captcha-internal-secret-change-me";
const CAPTCHA_CHARS   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CAPTCHA_LENGTH  = 6;
const CAPTCHA_EXPIRE  = 5 * 60 * 1000; // 5 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────
const generateCode = () => {
    const bytes = crypto.randomBytes(CAPTCHA_LENGTH);
    return Array.from(bytes, (b) => CAPTCHA_CHARS[b % CAPTCHA_CHARS.length]).join("");
};

const makeHmac = (code, timestamp) =>
    crypto.createHmac("sha256", CAPTCHA_SECRET)
        .update(`${code.toUpperCase()}:${timestamp}`)
        .digest("hex");

// ─── Public: verify a captcha token + user answer ────────────────────────────
export const verifyCaptchaToken = (token, answer) => {
    if (!token || !answer) return false;
    try {
        const dotIdx = token.lastIndexOf(".");
        if (dotIdx === -1) return false;
        const sig = token.slice(0, dotIdx);
        const ts  = parseInt(token.slice(dotIdx + 1), 10);
        if (isNaN(ts) || Date.now() - ts > CAPTCHA_EXPIRE) return false;
        const expected = makeHmac(answer, ts);
        // constant-time comparison to prevent timing attacks
        if (sig.length !== expected.length) return false;
        return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
    } catch { return false; }
};

// ─── SVG CAPTCHA generator ────────────────────────────────────────────────────
const rnd    = (lo, hi) => lo + Math.random() * (hi - lo);
const rndInt = (lo, hi) => Math.floor(rnd(lo, hi));

const buildSvg = (code) => {
    const W = 200, H = 64;

    // ── Background stripes (subtle) ──────────────────────────────────────────
    let bg = "";
    for (let x = 0; x < W; x += 8) {
        const alpha = rnd(0.02, 0.07).toFixed(3);
        bg += `<rect x="${x}" y="0" width="4" height="${H}" fill="#94a3b8" opacity="${alpha}"/>`;
    }

    // ── Noise dots ───────────────────────────────────────────────────────────
    let dots = "";
    for (let i = 0; i < 40; i++) {
        const cx = rnd(0, W), cy = rnd(0, H), r = rnd(0.5, 2.2);
        const hue = rndInt(200, 270);
        dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="hsl(${hue},50%,45%)" opacity="${rnd(0.25, 0.6).toFixed(2)}"/>`;
    }

    // ── Noise lines ──────────────────────────────────────────────────────────
    let lines = "";
    for (let i = 0; i < 7; i++) {
        const x1 = rnd(0, W), y1 = rnd(0, H);
        const x2 = rnd(0, W), y2 = rnd(0, H);
        const hue = rndInt(190, 260);
        const w   = rnd(0.5, 2).toFixed(1);
        lines += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="hsl(${hue},45%,55%)" stroke-width="${w}" opacity="${rnd(0.3, 0.65).toFixed(2)}"/>`;
    }

    // ── Wavy interference line through the text ───────────────────────────────
    const midY = H / 2;
    let wavePts = `M 0 ${(midY + rnd(-5, 5)).toFixed(1)}`;
    for (let x = 0; x <= W; x += 15) {
        wavePts += ` Q ${(x + 7).toFixed(1)} ${(midY + rnd(-14, 14)).toFixed(1)} ${(x + 15).toFixed(1)} ${(midY + rnd(-8, 8)).toFixed(1)}`;
    }
    const wave = `<path d="${wavePts}" stroke="hsl(${rndInt(210,250)},40%,58%)" stroke-width="${rnd(1,2).toFixed(1)}" fill="none" opacity="0.5"/>`;

    // ── Characters ───────────────────────────────────────────────────────────
    const slotW = W / (CAPTCHA_LENGTH + 0.5);
    let chars = "";
    for (let i = 0; i < code.length; i++) {
        const cx  = slotW * (i + 0.7) + rnd(-4, 4);
        const cy  = H / 2 + rnd(-7, 7);
        const rot = rnd(-20, 20).toFixed(1);
        const sz  = rndInt(24, 32);
        const hue = rndInt(210, 260);
        const sat = rndInt(55, 80);
        const lum = rndInt(20, 40);
        // slight italic effect via skewX
        const skew = rnd(-10, 10).toFixed(1);
        chars += `<text `
            + `x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" `
            + `font-size="${sz}" font-family="Arial Black,Impact,sans-serif" font-weight="900" `
            + `fill="hsl(${hue},${sat}%,${lum}%)" `
            + `transform="rotate(${rot},${cx.toFixed(1)},${cy.toFixed(1)}) skewX(${skew})" `
            + `dominant-baseline="middle" text-anchor="middle">`
            + code[i]
            + `</text>`;
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" rx="8" fill="#eef2ff"/>
  ${bg}${dots}${lines}${wave}${chars}
</svg>`;
};

// ─── Route handler: GET /api/auth/captcha ────────────────────────────────────
export const getCaptcha = (_req, res) => {
    const code      = generateCode();
    const timestamp = Date.now();
    const sig       = makeHmac(code, timestamp);
    const token     = `${sig}.${timestamp}`;
    const svg       = buildSvg(code);
    const image     = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");

    // short cache so the browser doesn't cache a stale captcha
    res.set("Cache-Control", "no-store");
    res.json({ image, token });
};

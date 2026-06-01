import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma, pool } from "../configs/prisma.js";
import { sendEmailLogged } from "../configs/emailQueue.js";
import { verifyCaptchaToken } from "./captchaController.js";

// ── IP-based rate limiting for forgot-password (max 4 per hour per IP) ────────
const forgotPasswordIpMap = new Map(); // ip -> { count, windowStart }
const FORGOT_MAX = 4;
const FORGOT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const checkForgotRateLimit = (ip) => {
    const now = Date.now();
    const entry = forgotPasswordIpMap.get(ip);
    if (!entry || now - entry.windowStart > FORGOT_WINDOW_MS) {
        forgotPasswordIpMap.set(ip, { count: 1, windowStart: now });
        return { allowed: true, remaining: FORGOT_MAX - 1 };
    }
    if (entry.count >= FORGOT_MAX) {
        const resetInMs = FORGOT_WINDOW_MS - (now - entry.windowStart);
        const resetInMin = Math.ceil(resetInMs / 60000);
        return { allowed: false, resetInMin };
    }
    entry.count += 1;
    return { allowed: true, remaining: FORGOT_MAX - entry.count };
};

// Cleanup stale entries every hour to avoid memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of forgotPasswordIpMap.entries()) {
        if (now - entry.windowStart > FORGOT_WINDOW_MS) forgotPasswordIpMap.delete(ip);
    }
}, FORGOT_WINDOW_MS);

const signToken = (user, role) => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET is not configured");
    }
    return jwt.sign(
        { userId: user.id, email: user.email, role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};

const ensureAdminUser = async (email) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    const created = await prisma.user.create({
        data: {
            id: crypto.randomUUID(),
            email,
            name: "Admin",
            image: "",
        },
    });

    return created;
};

export const login = async (req, res) => {
    try {
        const { email, password, captchaToken, captchaAnswer } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // Verify custom CAPTCHA
        if (!verifyCaptchaToken(captchaToken, captchaAnswer)) {
            return res.status(400).json({ message: "Incorrect CAPTCHA. Please try again." });
        }

        const adminEmail = process.env.ADMIN_EMAIL;
        const adminPassword = process.env.ADMIN_PASSWORD;

        if (email === adminEmail && password === adminPassword) {
            const adminUser = await ensureAdminUser(email);
            const token = signToken(adminUser, "ADMIN");
            return res.json({ token, user: adminUser, role: "ADMIN" });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        const isMatch = await bcrypt.compare(password, user.passwordHash);
        if (!isMatch) {
            return res.status(401).json({ message: "Invalid credentials" });
        }

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        const token = signToken(user, "MEMBER");
        res.json({ token, user: { ...user, lastLoginAt: new Date() }, role: "MEMBER" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
// POST /api/auth/request-password
// Generates a new random password, hashes + saves it, emails it to the user.
// Only works for registered MEMBER accounts (not the env-based admin account).
export const requestNewPassword = async (req, res) => {
    try {
        const { email, captchaToken, captchaAnswer } = req.body;
        if (!email) return res.status(400).json({ message: "Email is required" });

        // Verify custom CAPTCHA
        if (!verifyCaptchaToken(captchaToken, captchaAnswer)) {
            return res.status(400).json({ message: "Incorrect CAPTCHA. Please try again." });
        }

        // IP-based rate limit: max 4 forgot-password requests per IP per hour
        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
        const rateCheck = checkForgotRateLimit(ip);
        if (!rateCheck.allowed) {
            return res.status(429).json({
                message: `Too many requests. You can request a new password up to ${FORGOT_MAX} times per hour. Please try again in ${rateCheck.resetInMin} minute${rateCheck.resetInMin === 1 ? "" : "s"}.`,
            });
        }

        // Block the env-based admin from using this flow
        if (email === process.env.ADMIN_EMAIL) {
            return res.status(400).json({ message: "This email is not registered in our system" });
        }

        const user = await prisma.user.findUnique({ where: { email } });

        // Treat "no user", "no passwordHash", and "removed from all workspaces" the same —
        // we don't want to leak which accounts exist.
        if (!user || !user.passwordHash) {
            return res.status(404).json({ message: "This email is not registered in our system" });
        }

        // If the user has been removed from all workspaces they are no longer active
        const membership = await prisma.workspaceMember.findFirst({
            where: { userId: user.id },
            include: { workspace: { select: { id: true, name: true } } },
        });
        if (!membership) {
            return res.status(404).json({ message: "This email is not registered in our system" });
        }

        // Generate a short memorable password: 2 lowercase letters + 4 digits  e.g. gk9833
        const letters = "abcdefghjkmnpqrstuvwxyz"; // no l/i/o to avoid confusion
        const digits  = "0123456789";
        const randLetter = (b) => letters[b % letters.length];
        const randDigit  = (b) => digits[b % digits.length];
        const rb = crypto.randomBytes(6);
        const newPassword =
            randLetter(rb[0]) + randLetter(rb[1]) +
            randDigit(rb[2])  + randDigit(rb[3]) +
            randDigit(rb[4])  + randDigit(rb[5]);

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

        // membership is already fetched above — use it for email context
        const workspaceName = membership.workspace?.name || "Workspace";
        const workspaceId   = membership.workspace?.id   || null;

        await sendEmailLogged({
            to: user.email,
            subject: `Your new password — ${workspaceName}`,
            body: `
                <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:28px;">
                    <h2 style="color:#1d4ed8;margin-bottom:8px;">New Password</h2>
                    <p>Hi <strong>${user.name || user.email}</strong>,</p>
                    <p>You requested a new password for your <strong>${workspaceName}</strong> account.</p>
                    <div style="margin:20px 0;padding:16px 24px;background:#f1f5f9;border-radius:8px;border-left:4px solid #2563eb;">
                        <p style="margin:0;font-size:13px;color:#64748b;margin-bottom:6px;">Your new password</p>
                        <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:2px;color:#1e293b;font-family:monospace;">${newPassword}</p>
                    </div>
<div style="margin-top:16px;padding:12px 16px;background:#fffbeb;border-radius:8px;border-left:4px solid #f59e0b;">
                        <p style="margin:0;font-size:12px;color:#92400e;">
                            📬 <strong>Can't find this email?</strong> Check your <strong>Spam</strong> or <strong>Promotions</strong> folder.
                            If found there, please mark it as <em>"Not Spam"</em> so future emails reach your inbox directly.
                        </p>
                    </div>
                    <p style="margin-top:24px;font-size:12px;color:#94a3b8;">If you did not request this, please contact your administrator.</p>
                </div>`,
            workspaceId,
        });

        res.json({ message: "A new password has been sent to your email address." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

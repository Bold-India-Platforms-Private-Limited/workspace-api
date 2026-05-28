import Redis from "ioredis";

let client = null;

export function initRedis() {
    const url = process.env.REDIS_URL;
    if (!url) {
        console.log("[Redis] REDIS_URL not set — workspace caching disabled");
        return;
    }

    client = new Redis(url, {
        // Fail commands immediately when offline — never block an API response
        enableOfflineQueue: false,
        // 1 retry per command then give up (cache miss → DB, not hung request)
        maxRetriesPerRequest: 1,
        // Reconnect with capped exponential backoff; stop after 6 attempts
        retryStrategy(times) {
            if (times > 6) return null;
            return Math.min(times * 300, 3000);
        },
        connectTimeout: 5000,
    });

    client.on("connect", () => console.log("[Redis] Connected"));
    client.on("error", (err) => console.error("[Redis] Error:", err.message));
    client.on("reconnecting", () => console.log("[Redis] Reconnecting…"));
}

export function getRedisClient() {
    return client;
}

const WS_CACHE_TTL = 300; // 5 minutes

export async function cacheGet(key) {
    if (!client) return null;
    try {
        const raw = await client.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null; // graceful degradation — treat as cache miss
    }
}

export async function cacheSet(key, value, ttl = WS_CACHE_TTL) {
    if (!client) return;
    try {
        await client.set(key, JSON.stringify(value), "EX", ttl);
    } catch {} // fire-and-forget; response already sent
}

export async function cacheDel(keys) {
    if (!client || !keys || keys.length === 0) return;
    try {
        // ioredis del accepts an array
        await client.del(keys);
    } catch {}
}

// Invalidate every workspace-member's cached workspace list.
// Called after any mutation that changes workspace data (projects, tasks, members).
export async function invalidateWorkspaceCache(workspaceId, prisma) {
    if (!client) return;
    try {
        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            select: { userId: true },
        });
        const keys = members.map((m) => `ws:user:${m.userId}`);
        await cacheDel(keys);
    } catch (err) {
        console.error("[Redis] Invalidation error:", err.message);
    }
}

import { prisma } from "../configs/prisma.js";
import { cacheGet, cacheSet, cacheDel } from "../configs/redis.js";

const NOTICE_CACHE_TTL = 60; // seconds
// Admins see unpublished notices too, so the cached list must be scoped per role.
const noticeCacheKeys = (workspaceId) => [`notices:${workspaceId}:true`, `notices:${workspaceId}:false`];

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Only admin can manage notices" });
        return false;
    }
    return true;
};

export const listNotices = async (req, res) => {
    try {
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const isAdmin = req.user?.role === "ADMIN";
        const cacheKey = `notices:${workspaceId}:${isAdmin}`;

        let notices = await cacheGet(cacheKey);
        if (!notices) {
            notices = await prisma.notice.findMany({
                where: {
                    workspaceId,
                    ...(isAdmin ? {} : { published: true }),
                },
                orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
                take: 200, // defensive cap — admin-authored content, low write rate
            });
            await cacheSet(cacheKey, notices, NOTICE_CACHE_TTL);
        }

        res.json({ notices });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const createNotice = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { workspaceId, title, content, type, published, priority } = req.body;

        if (!workspaceId || !title || !content) {
            return res.status(400).json({ message: "workspaceId, title, and content are required" });
        }

        const notice = await prisma.notice.create({
            data: {
                workspaceId,
                title,
                content,
                type: type || "INFO",
                published: published ?? false,
                priority: priority ?? 0,
            },
        });
        await cacheDel(noticeCacheKeys(workspaceId));

        res.status(201).json({ notice });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateNotice = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { id } = req.params;
        const { title, content, type, published, priority } = req.body;

        const existing = await prisma.notice.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Notice not found" });

        const notice = await prisma.notice.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(content !== undefined && { content }),
                ...(type !== undefined && { type }),
                ...(published !== undefined && { published: published === true || published === "true" }),
                ...(priority !== undefined && { priority: Number(priority) }),
            },
        });
        await cacheDel(noticeCacheKeys(notice.workspaceId));

        res.json({ notice });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const publishNotice = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { id } = req.params;

        const existing = await prisma.notice.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Notice not found" });

        const notice = await prisma.notice.update({
            where: { id },
            data: { published: !existing.published },
        });
        await cacheDel(noticeCacheKeys(notice.workspaceId));

        res.json({ notice, published: notice.published });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteNotice = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { id } = req.params;

        const existing = await prisma.notice.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Notice not found" });

        await prisma.notice.delete({ where: { id } });
        await cacheDel(noticeCacheKeys(existing.workspaceId));
        res.json({ message: "Notice deleted" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

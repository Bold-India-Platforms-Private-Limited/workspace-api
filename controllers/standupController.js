import { prisma } from "../configs/prisma.js";

const VALID_TYPES = ["SOFTWARE_DEV", "DATA_ANALYSIS", "BRAINSTORM", "DESIGN", "TESTING", "DOCUMENTATION", "MEETING", "OTHER"];

const getDayBounds = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

// POST /api/standup — intern submits a standup entry
export const submitStandup = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, title, type, description, taskId } = req.body;

        if (!workspaceId || !title || !type || !description) {
            return res.status(400).json({ message: "workspaceId, title, type, and description are required" });
        }

        if (!VALID_TYPES.includes(type)) {
            return res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(", ")}` });
        }

        // Verify user is a workspace member
        const membership = await prisma.workspaceMember.findFirst({
            where: { workspaceId, userId },
        });
        if (!membership) return res.status(403).json({ message: "Not a member of this workspace" });

        // Use IST-aware today date
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowIST = new Date(Date.now() + IST_OFFSET_MS);
        const { start: todayStart } = getDayBounds(new Date(nowIST.toISOString().substring(0, 10)));

        const entry = await prisma.standupEntry.create({
            data: {
                workspaceId,
                userId,
                title,
                type,
                description,
                date: todayStart,
                ...(taskId ? { taskId } : {}),
            },
            include: {
                user: { select: { id: true, name: true, email: true, image: true } },
            },
        });

        res.status(201).json({ entry });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// PUT /api/standup/:id — intern edits their own standup (same day only)
export const updateStandup = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;
        const { title, type, description, taskId } = req.body;

        const existing = await prisma.standupEntry.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Entry not found" });
        if (existing.userId !== userId) return res.status(403).json({ message: "Cannot edit another user's entry" });

        // Only allow edits on the same day
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowIST = new Date(Date.now() + IST_OFFSET_MS);
        const { start: todayStart, end: todayEnd } = getDayBounds(new Date(nowIST.toISOString().substring(0, 10)));
        if (existing.date < todayStart || existing.date > todayEnd) {
            return res.status(403).json({ message: "Cannot edit past standup entries" });
        }

        if (type && !VALID_TYPES.includes(type)) {
            return res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(", ")}` });
        }

        const entry = await prisma.standupEntry.update({
            where: { id },
            data: {
                ...(title !== undefined && { title }),
                ...(type !== undefined && { type }),
                ...(description !== undefined && { description }),
                ...(taskId !== undefined && { taskId: taskId || null }),
            },
            include: {
                user: { select: { id: true, name: true, email: true, image: true } },
            },
        });

        res.json({ entry });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// DELETE /api/standup/:id — intern deletes own (same day); admin can delete any
export const deleteStandup = async (req, res) => {
    try {
        const { id: userId, role } = req.user;
        const { id } = req.params;

        const existing = await prisma.standupEntry.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Entry not found" });

        if (role !== "ADMIN") {
            if (existing.userId !== userId) return res.status(403).json({ message: "Access denied" });

            const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
            const nowIST = new Date(Date.now() + IST_OFFSET_MS);
            const { start: todayStart, end: todayEnd } = getDayBounds(new Date(nowIST.toISOString().substring(0, 10)));
            if (existing.date < todayStart || existing.date > todayEnd) {
                return res.status(403).json({ message: "Cannot delete past standup entries" });
            }
        }

        await prisma.standupEntry.delete({ where: { id } });
        res.json({ message: "Entry deleted" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// GET /api/standup/me — intern sees their own entries (filter by month)
export const getMyStandups = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, month } = req.query;

        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const target = month ? new Date(month) : new Date();
        const start = new Date(target.getFullYear(), target.getMonth(), 1);
        const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59, 999);

        const entries = await prisma.standupEntry.findMany({
            where: { workspaceId, userId, date: { gte: start, lte: end } },
            orderBy: { date: "desc" },
        });

        res.json({ entries });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// GET /api/standup — admin views all entries for a workspace by date
export const getStandupsByDate = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

        const { workspaceId, date } = req.query;
        if (!workspaceId || !date) return res.status(400).json({ message: "workspaceId and date are required" });

        const { start, end } = getDayBounds(new Date(date));

        // All workspace members
        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            take: 3000, // defensive cap — bounded by workspace member count
        });

        // All standup entries for that date
        const entries = await prisma.standupEntry.findMany({
            where: { workspaceId, date: { gte: start, lte: end } },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { createdAt: "asc" },
            take: 3000, // single day — bounded by workspace member count
        });

        // Group entries by userId
        const entryMap = {};
        for (const entry of entries) {
            if (!entryMap[entry.userId]) entryMap[entry.userId] = [];
            entryMap[entry.userId].push(entry);
        }

        const submitted = members
            .filter((m) => entryMap[m.userId])
            .map((m) => ({ user: m.user, entries: entryMap[m.userId] }));

        const notSubmitted = members
            .filter((m) => !entryMap[m.userId])
            .map((m) => ({ user: m.user }));

        res.json({
            date,
            totalMembers: members.length,
            submittedCount: submitted.length,
            notSubmittedCount: notSubmitted.length,
            submitted,
            notSubmitted,
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// GET /api/standup/summary — admin sees monthly summary (how many days each member submitted)
export const getStandupSummary = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

        const { workspaceId, month } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const target = month ? new Date(month) : new Date();
        const start = new Date(target.getFullYear(), target.getMonth(), 1);
        const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59, 999);

        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            take: 3000, // defensive cap — bounded by workspace member count
        });

        const entries = await prisma.standupEntry.findMany({
            where: { workspaceId, date: { gte: start, lte: end } },
            select: { userId: true, date: true, type: true },
            take: 15000, // one month, workspace-wide — comfortably above today's real peak (~3k)
        });

        // Count unique days submitted per user
        const userDays = {};
        for (const e of entries) {
            const dayKey = e.date.toISOString().substring(0, 10);
            if (!userDays[e.userId]) userDays[e.userId] = new Set();
            userDays[e.userId].add(dayKey);
        }

        const summary = members.map((m) => ({
            user: m.user,
            daysSubmitted: userDays[m.userId]?.size || 0,
            totalEntries: entries.filter((e) => e.userId === m.userId).length,
        }));

        summary.sort((a, b) => b.daysSubmitted - a.daysSubmitted);

        res.json({ month: target.toISOString().substring(0, 7), summary });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

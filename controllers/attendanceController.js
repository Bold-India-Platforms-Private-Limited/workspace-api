import { prisma, pool } from "../configs/prisma.js";
import { uploadImageToR2, deleteManyFromR2, extractKeyFromUrl } from "../configs/r2.js";
import { sendEmailsWithProgress } from "../configs/emailQueue.js";

// Safe user select — never exposes mobile, passwordHash, or lastLoginAt
const safeUser = { select: { id: true, name: true, email: true, image: true } };

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Only admin can manage attendance" });
        return false;
    }
    return true;
};

const getDayBounds = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

const sanitizeFolder = (value) => String(value || "user").toLowerCase().replace(/[^a-z0-9-_]+/g, "-");

export const markAttendance = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, imageBase64 } = req.body;

        if (!workspaceId || !imageBase64) {
            return res.status(400).json({ message: "workspaceId and imageBase64 are required" });
        }

        const { start, end } = getDayBounds(new Date());
        const existing = await prisma.attendance.findFirst({
            where: { workspaceId, userId, date: { gte: start, lte: end } },
        });

        if (existing) {
            return res.status(409).json({ message: "Attendance already marked for today" });
        }

        // R2 key structure: workspace/{workspaceId}/attendance/{userFolder}/{file}
        const keyPrefix = `workspace/${sanitizeFolder(workspaceId)}/attendance/${sanitizeFolder(req.user?.email || req.user?.name || userId)}`;
        const upload = await uploadImageToR2(imageBase64, keyPrefix);

        const attendance = await prisma.attendance.create({
            data: {
                workspaceId,
                userId,
                date: start,
                imageUrl: upload.url,
            },
        });

        res.json({ attendance, message: "Attendance marked" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const getMyAttendance = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, month } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const target = month ? new Date(month) : new Date();
        const start = new Date(target.getFullYear(), target.getMonth(), 1);
        const end = new Date(target.getFullYear(), target.getMonth() + 1, 0, 23, 59, 59, 999);

        const entries = await prisma.attendance.findMany({
            where: { workspaceId, userId, date: { gte: start, lte: end } },
            orderBy: { date: "asc" },
        });

        const { start: todayStart, end: todayEnd } = getDayBounds(new Date());

        const sanitized = entries.map((entry) => {
            const isToday = entry.date >= todayStart && entry.date <= todayEnd;
            return {
                ...entry,
                imageUrl: req.user?.role === "ADMIN" || isToday ? entry.imageUrl : null,
            };
        });

        res.json({ attendances: sanitized });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const getAttendanceByDate = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { workspaceId, date } = req.query;
        if (!workspaceId || !date) {
            return res.status(400).json({ message: "workspaceId and date are required" });
        }

        const target = new Date(date);
        const { start, end } = getDayBounds(target);

        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: { user: safeUser },
            take: 3000, // defensive cap — bounded by workspace member count
        });

        const entries = await prisma.attendance.findMany({
            where: { workspaceId, date: { gte: start, lte: end } },
            include: { user: safeUser },
            take: 3000, // single day — bounded by workspace member count
        });

        const entryMap = new Map(entries.map((e) => [e.userId, e]));

        const data = members.map((m) => ({
            user: m.user,
            attendance: entryMap.get(m.userId) || null,
        }));

        res.json({ records: data });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Returns two lists (admin only):
//   neverAttended  — members with zero attendance records in this workspace
//   absentToday    — members who have not marked attendance today (IST-aware)
export const getAbsentLists = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        // All workspace members
        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: { user: { select: { id: true, name: true, email: true } } },
            take: 3000, // defensive cap — bounded by workspace member count
        });

        // Today's bounds in IST (server computes IST date to stay consistent with markAttendance)
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowInIST = new Date(Date.now() + IST_OFFSET_MS);
        const todayDateStr = nowInIST.toISOString().substring(0, 10); // "YYYY-MM-DD"
        const { start: todayStart, end: todayEnd } = getDayBounds(new Date(todayDateStr));

        // Two small, bounded queries instead of pulling every attendance row
        // this workspace has ever had: "ever attended" only needs one row per
        // distinct user (bounded by member count), and "today" is already
        // naturally small since it's filtered to a single day.
        const [everAttendedRows, attendedTodayRows] = await Promise.all([
            prisma.attendance.findMany({ where: { workspaceId }, select: { userId: true }, distinct: ["userId"] }),
            prisma.attendance.findMany({ where: { workspaceId, date: { gte: todayStart, lte: todayEnd } }, select: { userId: true } }),
        ]);

        const everAttended = new Set(everAttendedRows.map((a) => a.userId));
        const attendedToday = new Set(attendedTodayRows.map((a) => a.userId));

        const neverAttended = members
            .filter((m) => !everAttended.has(m.userId))
            .map((m) => ({ id: m.userId, name: m.user.name, email: m.user.email }));

        const absentToday = members
            .filter((m) => !attendedToday.has(m.userId))
            .map((m) => ({ id: m.userId, name: m.user.name, email: m.user.email }));

        res.json({ neverAttended, absentToday, todayDate: todayDateStr });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const sendAttendanceReminder = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { workspaceId, type, customMessage } = req.body;

        if (!workspaceId || !type) {
            return res.status(400).json({ message: "workspaceId and type are required" });
        }
        if (!["neverAttended", "absentToday", "both"].includes(type)) {
            return res.status(400).json({ message: "type must be neverAttended, absentToday, or both" });
        }

        const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } });
        if (!workspace) return res.status(404).json({ message: "Workspace not found" });

        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: { user: { select: { id: true, name: true, email: true } } },
            take: 3000, // defensive cap — bounded by workspace member count
        });

        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowInIST = new Date(Date.now() + IST_OFFSET_MS);
        const todayDateStr = nowInIST.toISOString().substring(0, 10);
        const { start: todayStart, end: todayEnd } = getDayBounds(new Date(todayDateStr));

        const [everAttendedRows, attendedTodayRows] = await Promise.all([
            prisma.attendance.findMany({ where: { workspaceId }, select: { userId: true }, distinct: ["userId"] }),
            prisma.attendance.findMany({ where: { workspaceId, date: { gte: todayStart, lte: todayEnd } }, select: { userId: true } }),
        ]);

        const everAttended = new Set(everAttendedRows.map((a) => a.userId));
        const attendedToday = new Set(attendedTodayRows.map((a) => a.userId));

        let targets = [];
        if (type === "neverAttended") {
            targets = members.filter((m) => !everAttended.has(m.userId)).map((m) => m.user);
        } else if (type === "absentToday") {
            targets = members.filter((m) => !attendedToday.has(m.userId)).map((m) => m.user);
        } else {
            const ids = new Set([
                ...members.filter((m) => !everAttended.has(m.userId)).map((m) => m.userId),
                ...members.filter((m) => !attendedToday.has(m.userId)).map((m) => m.userId),
            ]);
            targets = members.filter((m) => ids.has(m.userId)).map((m) => m.user);
        }

        if (targets.length === 0) {
            return res.json({ sent: 0, message: "No users to remind." });
        }

        const extra = customMessage ? `<p style="margin-top:12px;color:#444;">${customMessage}</p>` : "";

        sendEmailsWithProgress({
            adminUserId: req.user?.id,
            workspaceId,
            label: `Attendance Reminder — ${workspace.name}`,
            emails: targets.map((user) => ({
                to: user.email,
                subject: `[${workspace.name}] Attendance Reminder`,
                body: `
                    <div style="font-family:sans-serif;max-width:560px;margin:auto;padding:24px;">
                        <h2 style="color:#1d4ed8;margin-bottom:8px;">Attendance Reminder</h2>
                        <p>Hi <strong>${user.name}</strong>,</p>
                        <p>This is a reminder that your attendance has not been marked${type === "neverAttended" ? " — you have never checked in" : " today"} in the <strong>${workspace.name}</strong> workspace.</p>
                        ${extra}
                        <p style="margin-top:20px;color:#888;font-size:12px;">Please mark your attendance at your earliest convenience.</p>
                    </div>`,
            })),
        }).catch(() => {});

        res.json({ sent: targets.length, total: targets.length, message: "Sending in progress — check the email progress indicator." });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const getMyAttendanceStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        const nowInIST = new Date(Date.now() + IST_OFFSET_MS);
        const todayDateStr = nowInIST.toISOString().substring(0, 10);
        const { start: todayStart, end: todayEnd } = getDayBounds(new Date(todayDateStr));

        const [totalCount, todayRecord] = await Promise.all([
            prisma.attendance.count({ where: { workspaceId, userId } }),
            prisma.attendance.findFirst({ where: { workspaceId, userId, date: { gte: todayStart, lte: todayEnd } }, select: { id: true } }),
        ]);

        res.json({ neverAttended: totalCount === 0, markedToday: !!todayRecord });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/attendance/batch — bulk-deletes the photos for a date range
// (frees R2 storage) but keeps the Attendance rows, so historical
// present/absent status is unaffected by cleaning up old images.
export const deleteAttendanceByDates = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { workspaceId, startDate, endDate } = req.body;

        if (!workspaceId || !startDate || !endDate) {
            return res.status(400).json({ message: "workspaceId, startDate, and endDate are required" });
        }

        const startBound = getDayBounds(new Date(startDate)).start;
        const endBound = getDayBounds(new Date(endDate)).end;

        const records = await prisma.attendance.findMany({
            where: { workspaceId, date: { gte: startBound, lte: endBound }, imageUrl: { not: "" } },
            select: { imageUrl: true },
        });

        const keys = records.map((r) => extractKeyFromUrl(r.imageUrl)).filter(Boolean);
        if (keys.length > 0) {
            await deleteManyFromR2(keys);
        }

        // Clear the images only — keep the Attendance rows so people already
        // marked present for these days stay marked present, per-record fact
        // that shouldn't disappear just because the photo was cleaned up.
        const updated = await prisma.attendance.updateMany({
            where: { workspaceId, date: { gte: startBound, lte: endBound } },
            data: { imageUrl: "" },
        });

        res.json({ message: "Images deleted, attendance kept", count: updated.count });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

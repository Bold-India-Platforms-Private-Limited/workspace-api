import { prisma, pool } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.js";

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

        const folder = `attendance/${sanitizeFolder(req.user?.email || req.user?.name || userId)}`;
        const upload = await cloudinary.uploader.upload(imageBase64, {
            folder,
            resource_type: "image",
            transformation: [{ quality: "auto:low" }],
        });

        const attendance = await prisma.attendance.create({
            data: {
                workspaceId,
                userId,
                date: start,
                imageUrl: upload.secure_url,
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
            include: { user: true },
        });

        const entries = await prisma.attendance.findMany({
            where: { workspaceId, date: { gte: start, lte: end } },
            include: { user: true },
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
            where: { workspaceId, date: { gte: startBound, lte: endBound } },
            select: { imageUrl: true },
        });

        const extractPublicId = (url = "") => {
            try {
                const parts = url.split("/upload/");
                if (parts.length < 2) return null;
                const tail = parts[1].split("?")[0];
                const withoutVersion = tail.replace(/^v\d+\//, "");
                return withoutVersion.replace(/\.[^/.]+$/, "");
            } catch {
                return null;
            }
        };

        const publicIds = records.map((r) => extractPublicId(r.imageUrl)).filter(Boolean);
        if (publicIds.length > 0) {
            const chunkSize = 100;
            for (let i = 0; i < publicIds.length; i += chunkSize) {
                const chunk = publicIds.slice(i, i + chunkSize);
                await cloudinary.api.delete_resources(chunk);
            }
        }

        const deleted = await prisma.attendance.deleteMany({
            where: { workspaceId, date: { gte: startBound, lte: endBound } },
        });

        res.json({ message: "Attendance deleted", count: deleted.count });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

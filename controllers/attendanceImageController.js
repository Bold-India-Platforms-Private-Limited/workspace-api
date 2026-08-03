import { prisma } from "../configs/prisma.js";
import { deleteFromR2, deleteManyFromR2, extractKeyFromUrl, listR2Objects, getPublicUrl } from "../configs/r2.js";

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Admin only" });
        return false;
    }
    return true;
};

// GET /api/attendance-images?days=7|30|90|all
// Returns all workspaces with their attendance records (grouped by date),
// each record includes the image URL + user info. Defaults to the last 7
// days — this list only ever grows, so re-shipping the entire history on
// every admin visit was a real cost; pass days=all to see everything.
export const listAttendanceImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { days } = req.query;
        const windowDays = Number(days);
        const dateFilter = days === "all"
            ? {}
            : { date: { gte: new Date(Date.now() - (windowDays > 0 ? windowDays : 7) * 24 * 60 * 60 * 1000) } };
        // Records whose image was deleted (imageUrl cleared) stay in the DB so
        // attendance stays marked, but there's nothing left to manage here.
        const where = { ...dateFilter, imageUrl: { not: "" } };

        const workspaces = await prisma.workspace.findMany({
            select: { id: true, name: true },
            orderBy: { createdAt: "desc" },
        });

        const records = await prisma.attendance.findMany({
            where,
            orderBy: { date: "desc" },
            include: {
                user: { select: { id: true, name: true, email: true, image: true } },
                workspace: { select: { id: true, name: true } },
            },
        });

        // Group by workspaceId → dateStr → records[]
        const grouped = {};
        for (const r of records) {
            const wid = r.workspaceId;
            const dateStr = r.date.toISOString().substring(0, 10);
            if (!grouped[wid]) grouped[wid] = { workspaceName: r.workspace?.name || wid, dates: {} };
            if (!grouped[wid].dates[dateStr]) grouped[wid].dates[dateStr] = [];
            grouped[wid].dates[dateStr].push({
                id: r.id,
                imageUrl: r.imageUrl,
                publicId: extractKeyFromUrl(r.imageUrl),
                date: r.date,
                user: r.user,
            });
        }

        res.json({ grouped });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// POST /api/attendance-images/bulk-delete  — delete multiple records' images by ids.
// Clears the image only — the Attendance row (and its "marked" status) stays,
// since attendance is a fact about that day regardless of whether the photo
// is still around.
export const bulkDeleteAttendanceImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "ids array is required" });
        }

        const records = await prisma.attendance.findMany({
            where: { id: { in: ids } },
            select: { id: true, imageUrl: true },
        });

        const keys = records.map((r) => extractKeyFromUrl(r.imageUrl)).filter(Boolean);
        await deleteManyFromR2(keys).catch(() => {});

        await prisma.attendance.updateMany({ where: { id: { in: ids } }, data: { imageUrl: "" } });
        res.json({ message: "Image deleted, attendance kept", count: records.length });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/attendance-images/:id  — delete one record's image + R2
// object, keeping the Attendance row (and its "marked" status) intact.
export const deleteAttendanceImage = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { id } = req.params;
        const record = await prisma.attendance.findUnique({ where: { id }, select: { imageUrl: true } });
        if (!record) return res.status(404).json({ message: "Record not found" });

        const key = extractKeyFromUrl(record.imageUrl);
        if (key) {
            await deleteFromR2(key).catch(() => {});
        }

        await prisma.attendance.update({ where: { id }, data: { imageUrl: "" } });
        res.json({ message: "Image deleted, attendance kept" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// GET /api/attendance-images/orphaned
// Scans the `workspace/` R2 prefix and finds object keys with no DB record.
export const listOrphanedImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        // Fetch all DB image URLs → build a Set of known keys
        // (cleared records have no imageUrl, so they're naturally excluded)
        const dbRecords = await prisma.attendance.findMany({ where: { imageUrl: { not: "" } }, select: { imageUrl: true } });
        const knownKeys = new Set(dbRecords.map((r) => extractKeyFromUrl(r.imageUrl)).filter(Boolean));

        // Fetch all objects from R2 under the workspace/ prefix (paginated internally)
        const r2Objects = await listR2Objects("workspace/");

        const orphaned = r2Objects
            .filter((o) => !knownKeys.has(o.Key))
            .map((o) => ({
                publicId: o.Key,
                url: getPublicUrl(o.Key),
                createdAt: o.LastModified,
                bytes: o.Size,
                folder: o.Key.split("/").slice(0, -1).join("/"),
            }));

        res.json({ orphaned, total: r2Objects.length, orphanedCount: orphaned.length });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/attendance-images/orphaned/purge
// body: { publicIds: string[] }   — deletes given R2 keys only (no DB record)
export const purgeOrphanedImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { publicIds } = req.body;
        if (!Array.isArray(publicIds) || publicIds.length === 0) {
            return res.status(400).json({ message: "publicIds array is required" });
        }

        await deleteManyFromR2(publicIds);

        res.json({ message: "Purged", deleted: publicIds.length });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

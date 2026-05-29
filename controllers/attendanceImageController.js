import { prisma } from "../configs/prisma.js";
import cloudinary from "../configs/cloudinary.js";

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Admin only" });
        return false;
    }
    return true;
};

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

// GET /api/attendance-images
// Returns all workspaces with their attendance records (grouped by date),
// each record includes the image URL + user info.
export const listAttendanceImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const workspaces = await prisma.workspace.findMany({
            select: { id: true, name: true },
            orderBy: { createdAt: "desc" },
        });

        const records = await prisma.attendance.findMany({
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
                publicId: extractPublicId(r.imageUrl),
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

// POST /api/attendance-images/bulk-delete  — delete multiple records by ids
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

        const publicIds = records.map((r) => extractPublicId(r.imageUrl)).filter(Boolean);
        const chunkSize = 100;
        for (let i = 0; i < publicIds.length; i += chunkSize) {
            await cloudinary.api.delete_resources(publicIds.slice(i, i + chunkSize)).catch(() => {});
        }

        await prisma.attendance.deleteMany({ where: { id: { in: ids } } });
        res.json({ message: "Deleted", count: records.length });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/attendance-images/:id  — delete one record + cloudinary image
export const deleteAttendanceImage = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { id } = req.params;
        const record = await prisma.attendance.findUnique({ where: { id }, select: { imageUrl: true } });
        if (!record) return res.status(404).json({ message: "Record not found" });

        const publicId = extractPublicId(record.imageUrl);
        if (publicId) {
            await cloudinary.uploader.destroy(publicId).catch(() => {});
        }

        await prisma.attendance.delete({ where: { id } });
        res.json({ message: "Deleted" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// GET /api/attendance-images/orphaned
// Scans the `attendance/` Cloudinary folder and finds public_ids with no DB record.
export const listOrphanedImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        // Fetch all DB image URLs → build a Set of known publicIds
        const dbRecords = await prisma.attendance.findMany({ select: { imageUrl: true } });
        const knownIds = new Set(dbRecords.map((r) => extractPublicId(r.imageUrl)).filter(Boolean));

        // Fetch all resources from Cloudinary under attendance/ folder (paginate with next_cursor)
        const cloudinaryResources = [];
        let nextCursor = null;

        do {
            const params = {
                type: "upload",
                prefix: "attendance/",
                max_results: 500,
            };
            if (nextCursor) params.next_cursor = nextCursor;

            const result = await cloudinary.api.resources(params);
            cloudinaryResources.push(...(result.resources || []));
            nextCursor = result.next_cursor || null;
        } while (nextCursor);

        const orphaned = cloudinaryResources
            .filter((r) => !knownIds.has(r.public_id))
            .map((r) => ({
                publicId: r.public_id,
                url: r.secure_url,
                createdAt: r.created_at,
                bytes: r.bytes,
                folder: r.folder || r.asset_folder || r.public_id.split("/").slice(0, -1).join("/"),
            }));

        res.json({ orphaned, total: cloudinaryResources.length, orphanedCount: orphaned.length });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/attendance-images/orphaned/purge
// body: { publicIds: string[] }   — deletes given publicIds from Cloudinary only (no DB record)
export const purgeOrphanedImages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { publicIds } = req.body;
        if (!Array.isArray(publicIds) || publicIds.length === 0) {
            return res.status(400).json({ message: "publicIds array is required" });
        }

        const chunkSize = 100;
        let deleted = 0;
        for (let i = 0; i < publicIds.length; i += chunkSize) {
            const chunk = publicIds.slice(i, i + chunkSize);
            await cloudinary.api.delete_resources(chunk);
            deleted += chunk.length;
        }

        res.json({ message: "Purged", deleted });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

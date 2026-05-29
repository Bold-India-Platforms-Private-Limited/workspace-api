import { prisma } from "../configs/prisma.js";

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Admin only" });
        return false;
    }
    return true;
};

export const getEmailLogs = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const emails = await prisma.emailLog.findMany({
            where: { workspaceId },
            orderBy: { sentAt: "desc" },
            take: 500,
        });

        res.json({ emails });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/emails/:id  — delete a single log entry
export const deleteEmailLog = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { id } = req.params;
        await prisma.emailLog.delete({ where: { id } });
        res.json({ message: "Log deleted" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/emails/bulk  — delete many logs by workspaceId + optional status filter
// body: { workspaceId, status? }  status omitted = delete all
export const bulkDeleteEmailLogs = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { workspaceId, status } = req.body;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const where = status ? { workspaceId, status } : { workspaceId };
        const { count } = await prisma.emailLog.deleteMany({ where });
        res.json({ message: "Logs deleted", count });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

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

        const { workspaceId, page = "1", pageSize = "50", status, search } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const take = Math.min(Math.max(parseInt(pageSize) || 50, 1), 200);
        const skip = (Math.max(parseInt(page) || 1, 1) - 1) * take;

        const where = {
            workspaceId,
            ...(status && status !== "all" ? { status } : {}),
            ...(search
                ? {
                      OR: [
                          { recipientEmail: { contains: search, mode: "insensitive" } },
                          { subject: { contains: search, mode: "insensitive" } },
                      ],
                  }
                : {}),
        };

        const [emails, totalFiltered, statusGroups] = await Promise.all([
            prisma.emailLog.findMany({ where, orderBy: { sentAt: "desc" }, skip, take }),
            prisma.emailLog.count({ where }),
            prisma.emailLog.groupBy({
                by: ["status"],
                where: { workspaceId },
                _count: { status: true },
            }),
        ]);

        const counts = { total: 0, sent: 0, pending: 0, failed: 0, bounced: 0 };
        for (const g of statusGroups) {
            counts[g.status] = g._count.status;
            counts.total += g._count.status;
        }

        res.json({ emails, counts, totalFiltered, page: parseInt(page), pageSize: take });
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

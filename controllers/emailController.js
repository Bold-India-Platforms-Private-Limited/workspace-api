import { randomUUID } from "crypto";
import { prisma } from "../configs/prisma.js";
import { sendEmailsWithProgress } from "../configs/emailQueue.js";

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Admin only" });
        return false;
    }
    return true;
};

// Fixed send rate for admin-composed broadcasts (workspaces run ~2k members,
// so this is deliberately capped well under mail-provider throughput limits).
const BROADCAST_RATE_PER_MIN = 100;

// POST /api/emails/broadcast
// body: { workspaceId, subject, body (html), recipientMode: "all" | "selected", userIds? }
// Fires the send in the background and returns immediately with a jobId —
// the client tracks real-time progress via the "email_job_progress" socket event.
export const sendBroadcastEmail = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { workspaceId, subject, body, recipientMode, userIds } = req.body;

        if (!workspaceId || !subject?.trim() || !body?.trim()) {
            return res.status(400).json({ message: "workspaceId, subject, and body are required" });
        }
        if (recipientMode === "selected" && (!Array.isArray(userIds) || userIds.length === 0)) {
            return res.status(400).json({ message: "userIds is required when recipientMode is 'selected'" });
        }

        const members = await prisma.workspaceMember.findMany({
            where: {
                workspaceId,
                ...(recipientMode === "selected" ? { userId: { in: userIds } } : {}),
            },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        const recipients = members.map((m) => m.user).filter((u) => u?.email);
        if (recipients.length === 0) {
            return res.status(400).json({ message: "No recipients found" });
        }

        const jobId = randomUUID();
        const emails = recipients.map((u) => ({ to: u.email, subject, body }));

        sendEmailsWithProgress({
            emails,
            adminUserId: req.user.id,
            workspaceId,
            label: subject,
            jobId,
            rateLimit: BROADCAST_RATE_PER_MIN,
        }).catch((err) => console.error("[Broadcast email] send error:", err.message));

        res.json({ message: "Broadcast started", jobId, total: recipients.length, rateLimit: BROADCAST_RATE_PER_MIN });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
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

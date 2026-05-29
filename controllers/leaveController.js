import { prisma } from "../configs/prisma.js";
import sendEmail from "../configs/nodemailer.js";

const userSelect = { id: true, name: true, email: true, image: true };

// POST /api/leave — intern submits a leave/WFH request
export const submitLeave = async (req, res) => {
    try {
        const userId = req.user.id;
        const { workspaceId, startDate, endDate, type, reason } = req.body;

        if (!workspaceId || !startDate || !endDate || !type || !reason) {
            return res.status(400).json({ message: "workspaceId, startDate, endDate, type, and reason are required" });
        }
        if (!["LEAVE", "WORK_FROM_HOME", "HALF_DAY"].includes(type)) {
            return res.status(400).json({ message: "Invalid type" });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start) || isNaN(end) || end < start) {
            return res.status(400).json({ message: "Invalid date range" });
        }

        // Check membership
        const member = await prisma.workspaceMember.findFirst({ where: { workspaceId, userId } });
        if (!member) return res.status(403).json({ message: "Not a workspace member" });

        // Check for overlapping PENDING/APPROVED requests
        const overlap = await prisma.leaveRequest.findFirst({
            where: {
                workspaceId, userId,
                status: { in: ["PENDING", "APPROVED"] },
                startDate: { lte: end },
                endDate: { gte: start },
            },
        });
        if (overlap) {
            return res.status(409).json({ message: "You already have a pending or approved request overlapping these dates" });
        }

        const leave = await prisma.leaveRequest.create({
            data: { workspaceId, userId, startDate: start, endDate: end, type, reason },
            include: { user: { select: userSelect } },
        });

        res.status(201).json({ leave });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/leave/me?workspaceId= — intern views own requests
export const getMyLeaves = async (req, res) => {
    try {
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const leaves = await prisma.leaveRequest.findMany({
            where: { workspaceId, userId: req.user.id },
            orderBy: { createdAt: "desc" },
        });

        res.json({ leaves });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/leave?workspaceId=&status=&month= — admin views all requests
export const getAllLeaves = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });
        const { workspaceId, status, month } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const where = { workspaceId };
        if (status) where.status = status;
        if (month) {
            const d = new Date(month);
            where.startDate = { lte: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59) };
            where.endDate   = { gte: new Date(d.getFullYear(), d.getMonth(), 1) };
        }

        const leaves = await prisma.leaveRequest.findMany({
            where,
            include: { user: { select: userSelect } },
            orderBy: { createdAt: "desc" },
        });

        res.json({ leaves, total: leaves.length });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// PUT /api/leave/:id/review — admin approves or rejects
export const reviewLeave = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });
        const { id } = req.params;
        const { status, adminNote } = req.body;

        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ message: "status must be APPROVED or REJECTED" });
        }

        const existing = await prisma.leaveRequest.findUnique({
            where: { id },
            include: { user: { select: userSelect }, workspace: { select: { name: true } } },
        });
        if (!existing) return res.status(404).json({ message: "Leave request not found" });

        const leave = await prisma.leaveRequest.update({
            where: { id },
            data: { status, adminNote: adminNote || null, reviewedAt: new Date() },
            include: { user: { select: userSelect } },
        });

        // Notify the intern via email
        const typeLabel = { LEAVE: "Leave", WORK_FROM_HOME: "Work From Home", HALF_DAY: "Half Day" }[existing.type];
        const statusColor = status === "APPROVED" ? "#16a34a" : "#dc2626";
        const statusLabel = status === "APPROVED" ? "✅ Approved" : "❌ Rejected";
        const dateRange = existing.startDate.toDateString() === existing.endDate.toDateString()
            ? existing.startDate.toLocaleDateString("en-IN")
            : `${existing.startDate.toLocaleDateString("en-IN")} – ${existing.endDate.toLocaleDateString("en-IN")}`;
        const workspaceName = existing.workspace?.name || "Admin";

        await sendEmail({
            to: existing.user.email,
            subject: `Your ${typeLabel} Request has been ${status === "APPROVED" ? "Approved" : "Rejected"}`,
            body: `
                <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
                    <h2 style="color:${statusColor};margin-bottom:8px;">${statusLabel}</h2>
                    <p>Hi <strong>${existing.user.name}</strong>,</p>
                    <p>Your <strong>${typeLabel}</strong> request for <strong>${dateRange}</strong> has been <strong>${status.toLowerCase()}</strong> by the admin.</p>
                    ${adminNote ? `<div style="background:#f3f4f6;border-radius:6px;padding:12px;margin:12px 0;"><p style="margin:0;font-size:13px;color:#374151;"><strong>Admin Note:</strong> ${adminNote}</p></div>` : ""}
                    <p style="color:#6b7280;font-size:13px;">— ${workspaceName}</p>
                </div>
            `,
        }).catch(() => {}); // don't fail if email errors

        res.json({ leave });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// DELETE /api/leave/:id — intern cancels own PENDING request
export const cancelLeave = async (req, res) => {
    try {
        const { id } = req.params;
        const existing = await prisma.leaveRequest.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ message: "Not found" });
        if (existing.userId !== req.user.id && req.user.role !== "ADMIN") {
            return res.status(403).json({ message: "Access denied" });
        }
        if (existing.status !== "PENDING" && req.user.role !== "ADMIN") {
            return res.status(400).json({ message: "Only PENDING requests can be cancelled" });
        }
        await prisma.leaveRequest.delete({ where: { id } });
        res.json({ message: "Request cancelled" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// PUT /api/leave/bulk-review — admin bulk approve or reject multiple PENDING requests
export const bulkReviewLeaves = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });
        const { ids, status, adminNote } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ message: "ids must be a non-empty array" });
        }
        if (!["APPROVED", "REJECTED"].includes(status)) {
            return res.status(400).json({ message: "status must be APPROVED or REJECTED" });
        }

        await prisma.leaveRequest.updateMany({
            where: { id: { in: ids }, status: "PENDING" },
            data: { status, adminNote: adminNote || null, reviewedAt: new Date() },
        });

        // Best-effort email notifications
        const leaves = await prisma.leaveRequest.findMany({
            where: { id: { in: ids } },
            include: { user: { select: userSelect }, workspace: { select: { name: true } } },
        });

        const typeLabelMap = { LEAVE: "Leave", WORK_FROM_HOME: "Work From Home", HALF_DAY: "Half Day" };
        const statusColor = status === "APPROVED" ? "#16a34a" : "#dc2626";
        const statusLabel = status === "APPROVED" ? "✅ Approved" : "❌ Rejected";

        await Promise.allSettled(leaves.map(existing => {
            const dateRange = existing.startDate.toDateString() === existing.endDate.toDateString()
                ? existing.startDate.toLocaleDateString("en-IN")
                : `${existing.startDate.toLocaleDateString("en-IN")} – ${existing.endDate.toLocaleDateString("en-IN")}`;
            const workspaceName = existing.workspace?.name || "Admin";
            return sendEmail({
                to: existing.user.email,
                subject: `Your ${typeLabelMap[existing.type]} Request has been ${status === "APPROVED" ? "Approved" : "Rejected"}`,
                body: `
                    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
                        <h2 style="color:${statusColor};margin-bottom:8px;">${statusLabel}</h2>
                        <p>Hi <strong>${existing.user.name}</strong>,</p>
                        <p>Your <strong>${typeLabelMap[existing.type]}</strong> request for <strong>${dateRange}</strong> has been <strong>${status.toLowerCase()}</strong>.</p>
                        ${adminNote ? `<div style="background:#f3f4f6;border-radius:6px;padding:12px;margin:12px 0;"><p style="margin:0;font-size:13px;color:#374151;"><strong>Admin Note:</strong> ${adminNote}</p></div>` : ""}
                        <p style="color:#6b7280;font-size:13px;">— ${workspaceName}</p>
                    </div>
                `,
            });
        }));

        res.json({ message: `${ids.length} request(s) ${status.toLowerCase()}`, count: ids.length });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/leave/check?workspaceId=&date= — check approved leaves for a date (for attendance)
export const checkLeaveForDate = async (req, res) => {
    try {
        const { workspaceId, date } = req.query;
        if (!workspaceId || !date) return res.status(400).json({ message: "workspaceId and date required" });

        const d = new Date(date);
        const leaves = await prisma.leaveRequest.findMany({
            where: {
                workspaceId,
                status: "APPROVED",
                startDate: { lte: d },
                endDate: { gte: d },
            },
            select: { userId: true, type: true },
        });

        // Return map of userId → leave type
        const leaveMap = {};
        for (const l of leaves) leaveMap[l.userId] = l.type;

        res.json({ leaveMap });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

import { prisma } from "../configs/prisma.js";

// Safe user select
const safeUser = { select: { id: true, name: true, email: true, image: true } };

// ─── MEMBER: submit or update their drive link ────────────────────────────────
export const submitLink = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, driveLink, note } = req.body;

        if (!workspaceId || !driveLink) {
            return res.status(400).json({ message: "workspaceId and driveLink are required" });
        }

        // Basic URL validation
        try { new URL(driveLink); } catch {
            return res.status(400).json({ message: "Please provide a valid URL" });
        }

        // Confirm member belongs to workspace
        const member = await prisma.workspaceMember.findUnique({
            where: { userId_workspaceId: { userId, workspaceId } },
        });
        if (!member) {
            return res.status(403).json({ message: "You are not a member of this workspace" });
        }

        const submission = await prisma.submission.upsert({
            where: { workspaceId_userId: { workspaceId, userId } },
            update: { driveLink, note: note || null, submittedAt: new Date() },
            create: { workspaceId, userId, driveLink, note: note || null },
            include: { user: safeUser },
        });

        res.json({ submission, message: "Submission saved successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// ─── MEMBER: get own submission ───────────────────────────────────────────────
export const getMySubmission = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.query;

        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const submission = await prisma.submission.findUnique({
            where: { workspaceId_userId: { workspaceId, userId } },
        });

        res.json({ submission });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// ─── ADMIN: get all members + their submission status ─────────────────────────
export const getAllSubmissions = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "Admin only" });
        }

        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        // Get all workspace members
        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            orderBy: { user: { name: "asc" } },
            take: 3000, // defensive cap — bounded by workspace member count
        });

        // Get all submissions for this workspace (one per user, bounded by member count)
        const submissions = await prisma.submission.findMany({
            where: { workspaceId },
            take: 3000,
        });

        const submissionMap = Object.fromEntries(submissions.map(s => [s.userId, s]));

        const result = members.map(m => ({
            userId: m.userId,
            name: m.user.name,
            email: m.user.email,
            image: m.user.image,
            role: m.role,
            submission: submissionMap[m.userId] || null,
        }));

        const submittedCount = result.filter(r => r.submission).length;

        res.json({ members: result, total: members.length, submittedCount });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// ─── ADMIN: add / update note on a submission ─────────────────────────────────
export const addAdminNote = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "Admin only" });
        }

        const { id } = req.params;
        const { adminNote } = req.body;

        const submission = await prisma.submission.update({
            where: { id },
            data: { adminNote: adminNote || null },
            include: { user: safeUser },
        });

        res.json({ submission, message: "Note saved" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

// ─── MEMBER: delete own submission ────────────────────────────────────────────
export const deleteSubmission = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id } = req.params;

        const submission = await prisma.submission.findUnique({ where: { id } });
        if (!submission) {
            return res.status(404).json({ message: "Submission not found" });
        }
        if (submission.userId !== userId && req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "Not allowed" });
        }

        await prisma.submission.delete({ where: { id } });
        res.json({ message: "Submission removed" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.message });
    }
};

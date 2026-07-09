import { prisma } from "../configs/prisma.js";

// Safe user select — never exposes mobile, passwordHash, or lastLoginAt
const safeUser = { select: { id: true, name: true, email: true, image: true } };

// POST /api/projects/:projectId/messages
// Any workspace member (or admin) can send a note about a project to its
// owner (Project.team_lead) — surfaced to admins in the "Candidate Teams" panel.
export const sendProjectMessage = async (req, res) => {
    try {
        const { projectId } = req.params;
        const { message } = req.body;
        const userId = req.user?.id;
        const role = req.user?.role;

        if (!message?.trim()) {
            return res.status(400).json({ message: "Message is required" });
        }

        const project = await prisma.project.findUnique({ where: { id: projectId } });
        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        if (role !== "ADMIN") {
            const membership = await prisma.workspaceMember.findUnique({
                where: { userId_workspaceId: { userId, workspaceId: project.workspaceId } },
            });
            if (!membership) {
                return res.status(403).json({ message: "You are not a member of this workspace" });
            }
        }

        const projectMessage = await prisma.projectMessage.create({
            data: { projectId, userId, message: message.trim() },
            include: { user: safeUser },
        });

        res.json({ message: "Message sent to Project Manager", projectMessage });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// GET /api/projects/candidate-teams?workspaceId=xxx
// Admin-only feed of every project message in the workspace, grouped by project.
export const listCandidateTeamMessages = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "Admin only" });
        }

        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const messages = await prisma.projectMessage.findMany({
            where: { project: { workspaceId } },
            include: {
                user: safeUser,
                project: { select: { id: true, name: true, owner: safeUser } },
            },
            orderBy: { createdAt: "desc" },
        });

        res.json({ messages });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

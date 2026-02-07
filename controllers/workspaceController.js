import prisma from "../configs/prisma.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import sendEmail from "../configs/nodemailer.js";
import cloudinary from "../configs/cloudinary.js";

// Get all workspaces for user
export const getUserWorkspaces = async (req, res) => {
    try {
        const userId = req.user?.id;
        const workspaces = await prisma.workspace.findMany({
            where: {
                members: { some: { userId: userId } }
            },
            include: {
                members: { include: { user: true } },
                groups: { include: { members: { include: { user: true } } } },
                projects: {
                    include: {
                        tasks: {
                            include: {
                                assignees: { include: { user: true } },
                                comments: { include: { user: true } },
                                groups: { include: { group: { include: { members: { include: { user: true } } } } } }
                            }
                        },
                        members: { include: { user: true } },
                        groups: { include: { group: { include: { members: { include: { user: true } } } } } }
                    }
                },
                owner: true
            }
        });
        res.json({ workspaces });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

const generateSlug = (name) => {
    return String(name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");
};

// Create workspace (admin only)
export const createWorkspace = async (req, res) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;
        const { name, description, image_url } = req.body;

        if (role !== "ADMIN") {
            return res.status(403).json({ message: "Only admin can create workspaces" });
        }

        if (!name) {
            return res.status(400).json({ message: "Workspace name is required" });
        }

        const baseSlug = generateSlug(name);
        let slug = baseSlug || `workspace-${Date.now()}`;

        const existing = await prisma.workspace.findUnique({ where: { slug } });
        if (existing) {
            slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
        }

        const workspace = await prisma.workspace.create({
            data: {
                id: crypto.randomUUID(),
                name,
                description: description || null,
                slug,
                ownerId: userId,
                image_url: image_url || "",
            },
        });

        await prisma.workspaceMember.create({
            data: {
                userId,
                workspaceId: workspace.id,
                role: "ADMIN",
            },
        });

        const workspaceWithMembers = await prisma.workspace.findUnique({
            where: { id: workspace.id },
            include: {
                members: { include: { user: true } },
                projects: {
                    include: {
                        tasks: { include: { assignees: { include: { user: true } }, comments: { include: { user: true } }, groups: { include: { group: { include: { members: { include: { user: true } } } } } } } },
                        members: { include: { user: true } },
                        groups: { include: { group: { include: { members: { include: { user: true } } } } } }
                    },
                },
                owner: true,
            },
        });

        res.json({ workspace: workspaceWithMembers, message: "Workspace created successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Invite member to workspace
export const inviteWorkspaceMember = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.params;
        const { email, role } = req.body;
        const origin = req.get('origin');

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: true } } },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const isAdmin = workspace.members.some(
            (member) => member.userId === userId && member.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "You don't have permission to invite members" });
        }

        const existingMember = workspace.members.find(
            (member) => member.user?.email === email
        );

        if (existingMember) {
            return res.status(400).json({ message: "User is already a member" });
        }

        let user = await prisma.user.findUnique({ where: { email } });
        let tempPassword = null;

        if (!user) {
            tempPassword = crypto.randomBytes(3).toString("hex");
            const passwordHash = await bcrypt.hash(tempPassword, 10);

            user = await prisma.user.create({
                data: {
                    id: crypto.randomUUID(),
                    email,
                    name: email.split("@")[0],
                    passwordHash,
                    image: "",
                },
            });
        } else if (!user.passwordHash) {
            tempPassword = crypto.randomBytes(3).toString("hex");
            const passwordHash = await bcrypt.hash(tempPassword, 10);

            user = await prisma.user.update({
                where: { id: user.id },
                data: { passwordHash },
            });
        }

        const normalizedRole = String(role || "MEMBER").toUpperCase();

        const member = await prisma.workspaceMember.create({
            data: {
                userId: user.id,
                workspaceId,
                role: normalizedRole === "ADMIN" ? "ADMIN" : "MEMBER",
            },
        });

        if (tempPassword) {
            await sendEmail({
                to: email,
                subject: "Workspace Invitation",
                body: `
                    <div style="max-width: 600px;">
                        <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                            Go To Workspace
                        </a>
                        <h2>You have been invited to ${workspace.name}</h2>
                        <p>Your login credentials:</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Password:</strong> ${tempPassword}</p>
                        <p>Please login and change your password after first login.</p>
                    </div>
                `,
            });
        }

        res.json({ member, message: "Member invited successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const inviteWorkspaceMembersBulk = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.params;
        const { emails, role } = req.body;
        const origin = req.get('origin');

        if (!Array.isArray(emails) || emails.length === 0) {
            return res.status(400).json({ message: "emails are required" });
        }

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: true } } },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const isAdmin = workspace.members.some(
            (member) => member.userId === userId && member.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "You don't have permission to invite members" });
        }

        const normalizedRole = String(role || "MEMBER").toUpperCase();
        const invited = [];

        for (const email of emails) {
            const trimmed = String(email).trim().toLowerCase();
            if (!trimmed) continue;

            const existingMember = workspace.members.find((member) => member.user?.email?.toLowerCase() === trimmed);
            if (existingMember) continue;

            let user = await prisma.user.findUnique({ where: { email: trimmed } });
            let tempPassword = null;

            if (!user) {
                tempPassword = crypto.randomBytes(3).toString("hex");
                const passwordHash = await bcrypt.hash(tempPassword, 10);

                user = await prisma.user.create({
                    data: {
                        id: crypto.randomUUID(),
                        email: trimmed,
                        name: trimmed.split("@")[0],
                        passwordHash,
                        image: "",
                    },
                });
            } else if (!user.passwordHash) {
                tempPassword = crypto.randomBytes(3).toString("hex");
                const passwordHash = await bcrypt.hash(tempPassword, 10);

                user = await prisma.user.update({
                    where: { id: user.id },
                    data: { passwordHash },
                });
            }

            await prisma.workspaceMember.create({
                data: {
                    userId: user.id,
                    workspaceId,
                    role: normalizedRole === "ADMIN" ? "ADMIN" : "MEMBER",
                },
            });

            if (tempPassword) {
                await sendEmail({
                    to: trimmed,
                    subject: "Workspace Invitation",
                    body: `
                        <div style="max-width: 600px;">
                            <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                                Go To Workspace
                            </a>
                            <h2>You have been invited to ${workspace.name}</h2>
                            <p>Your login credentials:</p>
                            <p><strong>Email:</strong> ${trimmed}</p>
                            <p><strong>Password:</strong> ${tempPassword}</p>
                            <p>Please login and change your password after first login.</p>
                        </div>
                    `,
                });
            }

            invited.push(trimmed);
        }

        res.json({ invited, message: "Invitations sent" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const removeWorkspaceMembersBulk = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.params;
        const { userIds } = req.body;

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ message: "userIds are required" });
        }

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: true },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const isAdmin = workspace.members.some(
            (member) => member.userId === userId && member.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "You don't have permission to remove members" });
        }

        await prisma.workspaceMember.deleteMany({
            where: { workspaceId, userId: { in: userIds } },
        });

        res.json({ message: "Members removed successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const importProjects = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.params;
        const { sourceWorkspaceId } = req.body;

        if (!sourceWorkspaceId) {
            return res.status(400).json({ message: "sourceWorkspaceId is required" });
        }

        const targetWorkspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: true },
        });

        if (!targetWorkspace) {
            return res.status(404).json({ message: "Target workspace not found" });
        }

        const isAdmin = targetWorkspace.members.some(
            (member) => member.userId === userId && member.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "You don't have permission to import" });
        }

        const sourceWorkspace = await prisma.workspace.findUnique({
            where: { id: sourceWorkspaceId },
            include: { projects: { include: { tasks: true } } },
        });

        if (!sourceWorkspace) {
            return res.status(404).json({ message: "Source workspace not found" });
        }

        for (const project of sourceWorkspace.projects) {
            const newProject = await prisma.project.create({
                data: {
                    id: crypto.randomUUID(),
                    workspaceId,
                    name: project.name,
                    description: project.description,
                    priority: project.priority,
                    status: project.status,
                    start_date: project.start_date,
                    end_date: project.end_date,
                    team_lead: userId,
                    progress: project.progress,
                },
            });

            if (project.tasks.length > 0) {
                await prisma.task.createMany({
                    data: project.tasks.map((task) => ({
                        id: crypto.randomUUID(),
                        projectId: newProject.id,
                        title: task.title,
                        description: task.description,
                        status: task.status,
                        type: task.type,
                        priority: task.priority,
                        due_date: task.due_date,
                    })),
                });
            }
        }

        res.json({ message: "Projects imported successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const deleteWorkspace = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId } = req.params;

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: true },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const isAdmin = workspace.members.some(
            (member) => member.userId === userId && member.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "You don't have permission to delete this workspace" });
        }

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

        const attendanceImages = await prisma.attendance.findMany({
            where: { workspaceId },
            select: { imageUrl: true },
        });

        const publicIds = attendanceImages
            .map((entry) => extractPublicId(entry.imageUrl))
            .filter(Boolean);

        if (publicIds.length > 0) {
            const chunkSize = 100;
            for (let i = 0; i < publicIds.length; i += chunkSize) {
                const chunk = publicIds.slice(i, i + chunkSize);
                await cloudinary.api.delete_resources(chunk);
            }
        }

        await prisma.workspace.delete({ where: { id: workspaceId } });
        res.json({ message: "Workspace deleted successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
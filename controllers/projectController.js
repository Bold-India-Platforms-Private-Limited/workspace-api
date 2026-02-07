import prisma from "../configs/prisma.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import sendEmail from "../configs/nodemailer.js";

// Create project
export const createProject = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, description, name, status, start_date, end_date, progress, priority, groupIds } = req.body;

        //check if user has admin role for workspace
        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: true } } },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        if (!workspace.members.some((member) => member.userId === userId && member.role === "ADMIN")) {
            return res.status(403).json({ message: "You don't have permission to create projects in this workspace" });
        }

        const project = await prisma.project.create({
            data: {
                workspaceId,
                name,
                description,
                status,
                priority,
                progress,
                team_lead: userId,
                start_date: start_date ? new Date(start_date) : null,
                end_date: end_date ? new Date(end_date) : null,
            }
        });

        if (Array.isArray(groupIds) && groupIds.length > 0) {
            const validGroups = await prisma.group.findMany({
                where: { id: { in: groupIds }, workspaceId },
                select: { id: true },
            });

            await prisma.projectGroup.createMany({
                data: validGroups.map((g) => ({
                    projectId: project.id,
                    groupId: g.id,
                })),
                skipDuplicates: true,
            });
        }

        const projectWithMembers = await prisma.project.findUnique({
            where: { id: project.id },
            include: {
                members: { include: { user: true } },
                tasks: { include: { assignees: { include: { user: true } }, comments: { include: { user: true } }, groups: { include: { group: { include: { members: { include: { user: true } } } } } } } },
                owner: true,
                groups: { include: { group: { include: { members: { include: { user: true } } } } } }
            }
        });

        res.json({ project: projectWithMembers, message: "Project created successfully" });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Update project
export const updateProject = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { id, workspaceId, description, name, status, start_date, end_date, progress, priority, groupIds } = req.body;

        // check if user has admin role for workspace
        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: true } } },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        // check if user has admin role for project
        if (!workspace.members.some((member) => member.userId === userId && member.role === "ADMIN")) {

            const project = await prisma.project.findUnique({
                where: { id }
            });

            if (!project) {
                return res.status(404).json({ message: "Project not found" });
            } else if (project.team_lead !== userId) {
                return res.status(403).json({ message: "You don't have permission to update projects in this workspace" });
            }
        }

        const project = await prisma.project.update({
            where: { id },
            data: {
                workspaceId,
                description,
                name,
                status,
                priority,
                progress,
                start_date: start_date ? new Date(start_date) : null,
                end_date: end_date ? new Date(end_date) : null,
            }
        });

        if (Array.isArray(groupIds)) {
            await prisma.projectGroup.deleteMany({ where: { projectId: id } });
            if (groupIds.length > 0) {
                const validGroups = await prisma.group.findMany({
                    where: { id: { in: groupIds }, workspaceId },
                    select: { id: true },
                });
                await prisma.projectGroup.createMany({
                    data: validGroups.map((g) => ({ projectId: id, groupId: g.id })),
                    skipDuplicates: true,
                });
            }
        }
        
        res.json({ project, message: "Project updated successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};


// Add Member to Project
export const addMember = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId } = req.params;
        const { email } = req.body;
        const origin = req.get('origin');

        // Check if user is project lead
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { members: { include: { user: true } } },
        });

        if (!project ) {
            return res.status(404).json({ message: "Project not found" });
        }

        if (project.team_lead !== userId) {
            return res.status(404).json({ message: "Only project lead can add members" });
        }

        // Check if user is already a member
        const existingMember = project.members.find((member) => member.user?.email === email);

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

        const workspaceMember = await prisma.workspaceMember.findUnique({
            where: {
                userId_workspaceId: {
                    userId: user.id,
                    workspaceId: project.workspaceId,
                },
            },
        });

        if (!workspaceMember) {
            await prisma.workspaceMember.create({
                data: {
                    userId: user.id,
                    workspaceId: project.workspaceId,
                    role: "MEMBER",
                },
            });
        }

        const member = await prisma.projectMember.create({
            data: {
                userId: user.id,
                projectId,
            },
        });

        if (tempPassword) {
            await sendEmail({
                to: email,
                subject: "You have been invited",
                body: `
                    <div style="max-width: 600px;">
                        <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                            Go To Workspace
                        </a>
                        <h2>You have been added to a project</h2>
                        <p>Your login credentials:</p>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Password:</strong> ${tempPassword}</p>
                        <p>Please login and change your password after first login.</p>
                    </div>
                `,
            });
        }

        res.json({ member, message: "Member added successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Delete project
export const deleteProject = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId } = req.params;

        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { workspace: { include: { members: true } } },
        });

        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }

        const isAdmin = project.workspace.members.some(
            (member) => member.userId === userId && member.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "You don't have permission to delete this project" });
        }

        await prisma.project.delete({ where: { id: projectId } });
        res.json({ message: "Project deleted successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
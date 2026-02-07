import prisma from "../configs/prisma.js";
import sendEmail from "../configs/nodemailer.js";

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Only admin can manage groups" });
        return false;
    }
    return true;
};

export const listGroups = async (req, res) => {
    try {
        const { workspaceId } = req.query;

        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const groups = await prisma.group.findMany({
            where: { workspaceId },
            include: { members: { include: { user: true } } },
            orderBy: { createdAt: "desc" },
        });

        res.json({ groups });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const getGroup = async (req, res) => {
    try {
        const { id } = req.params;
        const group = await prisma.group.findUnique({
            where: { id },
            include: { members: { include: { user: true } } },
        });

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        res.json({ group });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const createGroup = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { workspaceId, name, memberIds } = req.body;
        const origin = req.get('origin');

        if (!workspaceId || !name) {
            return res.status(400).json({ message: "workspaceId and name are required" });
        }

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: true },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const existing = await prisma.group.findUnique({
            where: { workspaceId_name: { workspaceId, name } },
        });

        if (existing) {
            return res.status(409).json({ message: "Group name already exists" });
        }

        const group = await prisma.group.create({
            data: { workspaceId, name },
        });

        const workspaceMemberIds = new Set(workspace.members.map((m) => m.userId));
        const validMemberIds = Array.isArray(memberIds)
            ? memberIds.filter((id) => workspaceMemberIds.has(id))
            : [];

        if (validMemberIds.length > 0) {
            await prisma.groupMember.createMany({
                data: validMemberIds.map((userId) => ({ groupId: group.id, userId })),
                skipDuplicates: true,
            });

            const users = await prisma.user.findMany({ where: { id: { in: validMemberIds } } });
            await Promise.all(users.map((user) =>
                sendEmail({
                    to: user.email,
                    subject: `Added to group ${name}`,
                    body: `
                        <div style="max-width: 600px;">
                            <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                                Go To Workspace
                            </a>
                            <p>You have been added to group <strong>${name}</strong>.</p>
                        </div>
                    `,
                })
            ));
        }

        const groupWithMembers = await prisma.group.findUnique({
            where: { id: group.id },
            include: { members: { include: { user: true } } },
        });

        res.json({ group: groupWithMembers, message: "Group created successfully" });
    } catch (error) {
        console.log(error);
        if (error.code === "P2002") {
            return res.status(409).json({ message: "Group name already exists" });
        }
        res.status(500).json({ message: error.code || error.message });
    }
};

export const updateGroupMembers = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { id } = req.params;
        const { addUserIds, removeUserIds } = req.body;
        const origin = req.get('origin');

        const group = await prisma.group.findUnique({
            where: { id },
            include: { workspace: { include: { members: true } } },
        });

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        const workspaceMemberIds = new Set(group.workspace.members.map((m) => m.userId));
        const validAddIds = Array.isArray(addUserIds)
            ? addUserIds.filter((userId) => workspaceMemberIds.has(userId))
            : [];

        if (validAddIds.length > 0) {
            await prisma.groupMember.createMany({
                data: validAddIds.map((userId) => ({ groupId: id, userId })),
                skipDuplicates: true,
            });

            const users = await prisma.user.findMany({ where: { id: { in: validAddIds } } });
            await Promise.all(users.map((user) =>
                sendEmail({
                    to: user.email,
                    subject: `Added to group ${group.name}`,
                    body: `
                        <div style="max-width: 600px;">
                            <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                                Go To Workspace
                            </a>
                            <p>You have been added to group <strong>${group.name}</strong>.</p>
                        </div>
                    `,
                })
            ));
        }

        if (Array.isArray(removeUserIds) && removeUserIds.length > 0) {
            await prisma.groupMember.deleteMany({
                where: { groupId: id, userId: { in: removeUserIds } },
            });
        }

        const updatedGroup = await prisma.group.findUnique({
            where: { id },
            include: { members: { include: { user: true } } },
        });

        res.json({ group: updatedGroup, message: "Group updated successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const deleteGroup = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { id } = req.params;
        await prisma.groupMessage.deleteMany({ where: { groupId: id } });
        await prisma.groupMember.deleteMany({ where: { groupId: id } });
        await prisma.group.delete({ where: { id } });
        res.json({ message: "Group deleted successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const clearGroupMessages = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const { id } = req.params;

        const group = await prisma.group.findUnique({ where: { id } });
        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        await prisma.groupMessage.deleteMany({ where: { groupId: id } });
        res.json({ message: "Group chat cleared" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

const canAccessGroup = (group, userId, role) => {
    if (role === "ADMIN") return true;
    return group.members?.some((m) => m.userId === userId);
};

export const listGroupMessages = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const role = req.user?.role;

        const group = await prisma.group.findUnique({
            where: { id },
            include: { members: true },
        });

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        if (!canAccessGroup(group, userId, role)) {
            return res.status(403).json({ message: "You don't have access to this group" });
        }

        const messages = await prisma.groupMessage.findMany({
            where: { groupId: id },
            include: { user: true },
            orderBy: { createdAt: "asc" },
        });

        res.json({ messages });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const createGroupMessage = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user?.id;
        const role = req.user?.role;
        const { content } = req.body;

        if (!content || !String(content).trim()) {
            return res.status(400).json({ message: "Message content is required" });
        }

        const group = await prisma.group.findUnique({
            where: { id },
            include: { members: true },
        });

        if (!group) {
            return res.status(404).json({ message: "Group not found" });
        }

        if (!canAccessGroup(group, userId, role)) {
            return res.status(403).json({ message: "You don't have access to this group" });
        }

        const message = await prisma.groupMessage.create({
            data: {
                groupId: id,
                userId,
                content: String(content).trim(),
            },
            include: { user: true },
        });

        res.json({ message });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
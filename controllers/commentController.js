import { prisma, pool } from "../configs/prisma.js";

// Add comment
export const addComment = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { content,taskId } = req.body;

        // check if user is projectmember
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { groups: { include: { group: { include: { members: true } } } } },
        });
        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }
        
        const project = await prisma.project.findUnique({
            where: { id: task.projectId },
            include: { members: { include: { user: true } } },
        });

        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }
        if (req.user?.role !== "ADMIN") {
            const taskGroupMembers = task.groups.flatMap((g) => g.group.members.map((m) => m.userId));
            if (taskGroupMembers.length > 0) {
                const isGroupMember = taskGroupMembers.includes(userId);
                if (!isGroupMember) {
                    return res.status(403).json({ message: "You are not allowed to comment on this task" });
                }
            } else {
                const member = project.members.find((member) => member.userId === userId);
                if (!member) {
                    return res.status(403).json({ message: "You are not member of this project" });
                }
            }
        }

        const comment = await prisma.comment.create({ data: { taskId, content, userId }, include: { user: true } });
        
        res.json({comment});
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Get comments for task
export const getTaskComments = async (req, res) => {
    try {
        const { taskId } = req.params;
        const task = await prisma.task.findUnique({
            where: { id: taskId },
            include: { groups: { include: { group: { include: { members: true } } } } },
        });

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        if (req.user?.role !== "ADMIN") {
            const taskGroupMembers = task.groups.flatMap((g) => g.group.members.map((m) => m.userId));
            if (taskGroupMembers.length > 0 && !taskGroupMembers.includes(req.user?.id)) {
                return res.status(403).json({ message: "You are not allowed to view comments for this task" });
            }
        }

        const comments = await prisma.comment.findMany({ where: { taskId }, include: { user: true } });
        res.json({ comments });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

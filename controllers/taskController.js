import { prisma, pool } from "../configs/prisma.js";
import sendEmail from "../configs/nodemailer.js";

// Create task
export const createTask = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { projectId, title, description, type, status, priority, due_date, groupIds, assigneeIds } = req.body;
        const origin = req.get('origin');

        // Check if user has admin role for project
        const project = await prisma.project.findUnique({
            where: { id: projectId },
            include: { members: { include: { user: true } } },
        });

        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        }
        else if (project.team_lead !== userId && req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "You don't have admin privileges for this project" });
        }

        const task = await prisma.task.create({
            data: {
                projectId,
                title,
                description,
                type,
                priority,
                status,
                due_date: new Date(due_date),
            }
        });

        let groupsWithMembers = [];

        if (Array.isArray(groupIds) && groupIds.length > 0) {
            groupsWithMembers = await prisma.group.findMany({
                where: { id: { in: groupIds }, workspaceId: project.workspaceId },
                include: { members: true },
            });

            await prisma.taskGroup.createMany({
                data: groupsWithMembers.map((g) => ({ taskId: task.id, groupId: g.id })),
                skipDuplicates: true,
            });
        }

        const allowedUserIds = new Set(
            groupsWithMembers.flatMap((g) => g.members.map((m) => m.userId))
        );

        const validAssigneeIds = Array.isArray(assigneeIds)
            ? assigneeIds.filter((id) => allowedUserIds.has(id))
            : [];

        if (validAssigneeIds.length > 0) {
            await prisma.taskAssignee.createMany({
                data: validAssigneeIds.map((userId) => ({ taskId: task.id, userId })),
                skipDuplicates: true,
            });
        }

        const taskWithAssignees = await prisma.task.findUnique({
            where: { id: task.id },
            include: {
                assignees: { include: { user: true } },
                groups: { include: { group: { include: { members: { include: { user: true } } } } } },
            },
        });

        const uniqueEmails = Array.from(
            new Set(
                (taskWithAssignees?.assignees || [])
                    .map((a) => a.user?.email)
                    .filter(Boolean)
            )
        );

        if (uniqueEmails.length > 0) {
            await Promise.all(uniqueEmails.map((email) =>
                sendEmail({
                    to: email,
                    subject: `New Task Assignment`,
                    body: `
                        <div style="max-width: 600px;">
                        <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                            Go To Workspace
                        </a>
                        <h2>Hello 👋</h2>
                        
                        <p style="font-size: 16px;">A new task has been assigned to you:</p>
                        <p style="font-size: 18px; font-weight: bold; color: #007bff; margin: 8px 0;">${taskWithAssignees.title}</p>
                        
                        <div style="border: 1px solid #ddd; padding: 12px 16px; border-radius: 6px; margin-bottom: 30px;">
                            <p style="margin: 6px 0;"><strong>Description:</strong> ${taskWithAssignees.description || ""}</p>
                            <p style="margin: 6px 0;"><strong>Due Date:</strong> ${new Date(taskWithAssignees.due_date).toLocaleDateString()}</p>
                        </div>

                        <p style="margin-top: 20px; font-size: 14px; color: #6c757d;">
                            Please make sure to review and complete it before the due date.
                        </p>
                        </div>
                        `,
                })
            ));
        }

        res.json({ task: taskWithAssignees, message: "Task created successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};


// Update task
export const updateTask = async (req, res) => {
    try {

        const task = await prisma.task.findUnique({
            where: { id: req.params.id },
        });

        if (!task) {
            return res.status(404).json({ message: "Task not found" });
        }

        const userId = req.user?.id;

        const project = await prisma.project.findUnique({
            where: { id: task.projectId },
            include: { members: { include: { user: true } } },
        });

        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        } else if (project.team_lead !== userId && req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "You don't have admin privileges for this project" });
        }

        const { title, description, status, type, priority, due_date, groupIds, assigneeIds } = req.body;

        const updatedTask = await prisma.task.update({
            where: { id: req.params.id },
            data: {
                title,
                description,
                status,
                type,
                priority,
                due_date: due_date ? new Date(due_date) : task.due_date,
            },
        });

        let groupsWithMembers = [];

        if (Array.isArray(groupIds)) {
            await prisma.taskGroup.deleteMany({ where: { taskId: task.id } });
            if (groupIds.length > 0) {
                groupsWithMembers = await prisma.group.findMany({
                    where: { id: { in: groupIds }, workspaceId: project.workspaceId },
                    include: { members: true },
                });
                await prisma.taskGroup.createMany({
                    data: groupsWithMembers.map((g) => ({ taskId: task.id, groupId: g.id })),
                    skipDuplicates: true,
                });
            }
        } else {
            const existingGroups = await prisma.taskGroup.findMany({
                where: { taskId: task.id },
                include: { group: { include: { members: true } } },
            });
            groupsWithMembers = existingGroups.map((g) => g.group);
        }

        if (Array.isArray(assigneeIds)) {
            const allowedUserIds = new Set(
                groupsWithMembers.flatMap((g) => g.members.map((m) => m.userId))
            );
            const validAssigneeIds = assigneeIds.filter((id) => allowedUserIds.has(id));

            await prisma.taskAssignee.deleteMany({ where: { taskId: task.id } });

            if (validAssigneeIds.length > 0) {
                await prisma.taskAssignee.createMany({
                    data: validAssigneeIds.map((userId) => ({ taskId: task.id, userId })),
                    skipDuplicates: true,
                });
            }
        }

        const updatedWithGroups = await prisma.task.findUnique({
            where: { id: task.id },
            include: { assignees: { include: { user: true } }, groups: { include: { group: { include: { members: { include: { user: true } } } } } } },
        });

        res.json({ message: "Task updated successfully", task: updatedWithGroups });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Delete task
export const deleteTask = async (req, res) => {
    try {
        const userId = req.user?.id;
        const { tasksIds } = req.body;

        const tasks = await prisma.task.findMany({
            where: { id: { in: tasksIds } },
        });

        if (tasks.length === 0) {
            return res.status(404).json({ message: "Task not found" });
        }

        const project = await prisma.project.findUnique({
            where: { id: tasks[0].projectId },
            include: { members: { include: { user: true } } },
        });

        if (!project) {
            return res.status(404).json({ message: "Project not found" });
        } else if (project.team_lead !== userId && req.user?.role !== "ADMIN") {
            return res.status(403).json({ message: "You don't have admin privileges for this project" });
        }

        await prisma.task.deleteMany({
            where: { id: { in: tasksIds } },
        });

        res.json({ message: "Task deleted successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
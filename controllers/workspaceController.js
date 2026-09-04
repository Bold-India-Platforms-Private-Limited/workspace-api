import { prisma, pool } from "../configs/prisma.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import sendEmail from "../configs/nodemailer.js";
import { deleteManyFromR2, extractKeyFromUrl } from "../configs/r2.js";
import { cacheGet, cacheSet, cacheDel, invalidateWorkspaceCache } from "../configs/redis.js";

// Safe user select — never exposes mobile, passwordHash, or lastLoginAt to non-admin responses
const safeUser = { select: { id: true, name: true, email: true, image: true } };

// Restricts a workspace's cross-cutting rosters to what a MEMBER (non-admin)
// is allowed to see: their own group(s), fellow members of those groups, and
// projects assigned to those groups. This mirrors — exactly — the filtering
// every member-facing page already does client-side (Projects.jsx, StatsGrid,
// ProjectOverview, TasksSummary, MyTasksSidebar, ProjectsSidebar, RecentActivity,
// ProjectCalendar, ProjectTasks, TaskDetails all independently filter
// `group.members?.some(m => m.userId === user.id)` before use). Enforcing it
// here too means a member's full workspace roster / other groups' membership
// / other groups' projects never reach the browser at all, not just hidden
// from the UI. Admins are unaffected — they still get everything.
function scopeWorkspaceForMember(workspace, userId) {
    const myGroups = (workspace.groups || []).filter((g) =>
        g.members?.some((m) => m.userId === userId)
    );
    const myGroupIds = new Set(myGroups.map((g) => g.id));

    const myGroupmateIds = new Set([userId]);
    myGroups.forEach((g) => (g.members || []).forEach((m) => myGroupmateIds.add(m.userId)));

    const scopedProjects = (workspace.projects || []).filter((project) =>
        (project.groups || []).some((pg) => myGroupIds.has(pg.groupId || pg.group?.id))
    );

    return {
        ...workspace,
        members: (workspace.members || []).filter((m) => myGroupmateIds.has(m.userId)),
        groups: myGroups,
        projects: scopedProjects,
    };
}

// The heavy project/task/group graph for a single workspace. Kept in one
// place so getWorkspaceById and createWorkspace stay in sync.
const workspaceDetailInclude = {
    members: { include: { user: safeUser } },
    // group.members is only ever read as `m.userId` by the frontend
    // (group visibility filtering) — the group roster UI fetches its own
    // /api/groups. Keep this to bare ids so a workspace with hundreds of
    // groups doesn't ship hundreds of user blobs.
    groups: { include: { members: { select: { userId: true } } } },
    projects: {
        include: {
            tasks: {
                include: {
                    assignees: { include: { user: safeUser } },
                    groups: { select: { groupId: true } }
                }
            },
            members: { include: { user: safeUser } },
            groups: {
                include: {
                    group: {
                        select: {
                            id: true,
                            members: { select: { userId: true } }
                        }
                    }
                }
            },
            // Lightweight document list — powers the count badge on the Documents
            // tab and the Datasets section on the Dashboard. datasetFolder is only
            // populated for kind = "dataset".
            documents: {
                select: {
                    id: true,
                    kind: true,
                    title: true,
                    createdAt: true,
                    datasetFolder: { select: { id: true, name: true, _count: { select: { files: true } } } },
                },
            }
        }
    },
    owner: safeUser
};

// Lightweight shape for the workspace list — id/name/image + a bare membership
// roster (userId/role only, NO user join). NO projects / tasks / groups, and
// NO member profile blobs: the full graph (members-with-user included) is
// fetched one workspace at a time via getWorkspaceById.
const workspaceListSelect = {
    id: true,
    name: true,
    slug: true,
    description: true,
    settings: true,
    image_url: true,
    ownerId: true,
    createdAt: true,
    updatedAt: true,
    members: { select: { userId: true, role: true } },
    owner: safeUser,
};

// Get all workspaces for user (lightweight list — no project/task graph)
export const getUserWorkspaces = async (req, res) => {
    try {
        const userId = req.user?.id;

        // Serve from Redis when available
        const cacheKey = `ws:user:${userId}`;
        const cached = await cacheGet(cacheKey);
        if (cached) {
            // Same response shape as the cache-miss path below — identical data
            // must serialize identically so Express's auto ETag matches across
            // hit/miss and the client's conditional GET (If-None-Match) actually
            // gets a 304 instead of a full re-transfer.
            return res.json({ workspaces: cached });
        }

        const workspaces = await prisma.workspace.findMany({
            where: {
                members: { some: { userId: userId } }
            },
            select: workspaceListSelect,
            orderBy: { createdAt: "asc" },
        });

        // Cache before responding so concurrent requests also benefit
        await cacheSet(cacheKey, workspaces);
        res.json({ workspaces });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Get a single workspace with its full project/task/group graph.
// This is the only place that materialises the heavy join, and only ever
// for one workspace — never the whole DB.
export const getWorkspaceById = async (req, res) => {
    try {
        const userId = req.user?.id;
        const role = req.user?.role;
        const { workspaceId } = req.params;

        // Full unscoped graph is cached per workspace; member scoping is
        // applied after the cache read so one blob serves everyone.
        const cacheKey = `ws:detail:${workspaceId}`;
        let workspace = await cacheGet(cacheKey);

        if (!workspace) {
            workspace = await prisma.workspace.findUnique({
                where: { id: workspaceId },
                include: workspaceDetailInclude,
            });

            if (!workspace) {
                return res.status(404).json({ message: "Workspace not found" });
            }

            await cacheSet(cacheKey, workspace);
        }

        const isMember = (workspace.members || []).some((m) => m.userId === userId);
        if (role !== "ADMIN" && !isMember) {
            return res.status(403).json({ message: "You don't have access to this workspace" });
        }

        // Non-admins only ever see their own group(s) + groupmates + those
        // groups' projects. Admins keep the full workspace graph, unchanged.
        const scoped = role === "ADMIN"
            ? workspace
            : scopeWorkspaceForMember(workspace, userId);

        res.json({ workspace: scoped });
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
            select: workspaceListSelect,
        });

        // A brand-new workspace has no projects/groups yet — give the client
        // the same shape a detail fetch would so it can render immediately.
        const workspaceForClient = { ...workspaceWithMembers, projects: [], groups: [] };

        // New workspace — invalidate the creator's cached list
        await cacheDel([`ws:user:${userId}`]);
        res.json({ workspace: workspaceForClient, message: "Workspace created successfully" });
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
            include: { members: { include: { user: safeUser } } },
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

        // Invalidate the whole workspace so all existing members see the new member
        await invalidateWorkspaceCache(workspaceId, prisma);
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
            include: { members: { include: { user: safeUser } } },
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

        await invalidateWorkspaceCache(workspaceId, prisma);
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

        await invalidateWorkspaceCache(workspaceId, prisma);
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

        await invalidateWorkspaceCache(workspaceId, prisma);
        res.json({ message: "Projects imported successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Regenerate login credentials for a workspace member
export const regenerateCredentials = async (req, res) => {
    try {
        const requesterId = req.user?.id;
        const { workspaceId, userId } = req.params;
        const origin = req.get('origin');

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: safeUser } } },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const isAdmin = workspace.members.some(
            (m) => m.userId === requesterId && m.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "Only admins can regenerate credentials" });
        }

        const member = workspace.members.find((m) => m.userId === userId);
        if (!member) {
            return res.status(404).json({ message: "Member not found in this workspace" });
        }

        const tempPassword = crypto.randomBytes(3).toString("hex");
        const passwordHash = await bcrypt.hash(tempPassword, 10);

        await prisma.user.update({
            where: { id: userId },
            data: { passwordHash },
        });

        await sendEmail({
            to: member.user.email,
            subject: "Your Login Credentials Have Been Reset",
            body: `
                <div style="max-width: 600px;">
                    <a href="${origin || ""}" style="background-color: #007bff; padding: 12px 24px; border-radius: 5px; color: #fff; font-weight: 600; font-size: 16px; text-decoration: none; display: inline-block; margin-bottom: 16px;">
                        Go To Workspace
                    </a>
                    <h2>Your credentials for ${workspace.name} have been reset</h2>
                    <p>Your new login credentials:</p>
                    <p><strong>Email:</strong> ${member.user.email}</p>
                    <p><strong>New Password:</strong> ${tempPassword}</p>
                    <p>Please login and change your password after first login.</p>
                </div>
            `,
        });

        await invalidateWorkspaceCache(workspaceId, prisma);
        res.json({ message: "Credentials regenerated and sent to user's email" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// Search workspace member by email
export const searchMemberByEmail = async (req, res) => {
    try {
        const requesterId = req.user?.id;
        const { workspaceId } = req.params;
        const { email } = req.query;

        if (!email) {
            return res.status(400).json({ message: "email query param is required" });
        }

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: safeUser } } },
        });

        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        const isAdmin = workspace.members.some(
            (m) => m.userId === requesterId && m.role === "ADMIN"
        );

        if (!isAdmin) {
            return res.status(403).json({ message: "Only admins can search members" });
        }

        const match = workspace.members.find(
            (m) => m.user?.email?.toLowerCase() === String(email).trim().toLowerCase()
        );

        if (!match) {
            return res.status(404).json({ message: "No member found with that email" });
        }

        res.json({ member: match });
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

        const attendanceImages = await prisma.attendance.findMany({
            where: { workspaceId },
            select: { imageUrl: true },
        });

        const keys = attendanceImages
            .map((entry) => extractKeyFromUrl(entry.imageUrl))
            .filter(Boolean);

        if (keys.length > 0) {
            await deleteManyFromR2(keys);
        }

        // Invalidate before delete so member list is still queryable
        await invalidateWorkspaceCache(workspaceId, prisma);
        await prisma.workspace.delete({ where: { id: workspaceId } });
        res.json({ message: "Workspace deleted successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};
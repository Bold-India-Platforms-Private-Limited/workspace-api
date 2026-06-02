import { prisma } from "../configs/prisma.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import sendEmail from "../configs/nodemailer.js";
import { sendEmailLogged } from "../configs/emailQueue.js";

// GET /api/users/me — return own profile (mobile, lastLoginAt etc.)
export const getMe = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { id: true, name: true, email: true, image: true, mobile: true, lastLoginAt: true, createdAt: true },
        });
        if (!user) return res.status(404).json({ message: "User not found" });
        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PUT /api/users/me/mobile — intern sets/updates their WhatsApp number
export const updateMobile = async (req, res) => {
    try {
        const { mobile } = req.body;
        if (!mobile) return res.status(400).json({ message: "mobile is required" });

        const cleaned = String(mobile).replace(/\D/g, "");
        if (cleaned.length < 7 || cleaned.length > 15) {
            return res.status(400).json({ message: "Enter a valid mobile number" });
        }

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { mobile: cleaned },
            select: { id: true, name: true, email: true, mobile: true },
        });

        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// PUT /api/users/me/name — user updates their own display name
export const updateName = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: "name is required" });
        if (name.trim().length > 60) return res.status(400).json({ message: "Name must be 60 characters or fewer" });

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { name: name.trim() },
            select: { id: true, name: true, email: true, mobile: true },
        });

        res.json({ user });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /api/users/never-logged-in?workspaceId=xxx — admin: members who never logged in
export const neverLoggedIn = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: {
                user: {
                    select: { id: true, name: true, email: true, mobile: true, lastLoginAt: true, createdAt: true },
                },
            },
        });

        // Exclude ADMIN-role workspace members — only flag interns (MEMBER role)
        const users = members
            .filter((m) => m.role !== "ADMIN" && !m.user.lastLoginAt)
            .map((m) => m.user);
        res.json({ count: users.length, users });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /api/users/team?workspaceId=xxx — admin: all members with mobile, login status, groups
export const getTeam = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const [members, groups, workspace] = await Promise.all([
            prisma.workspaceMember.findMany({
                where: { workspaceId },
                include: {
                    user: {
                        select: { id: true, name: true, email: true, mobile: true, image: true, lastLoginAt: true, createdAt: true },
                    },
                },
                orderBy: { user: { name: "asc" } },
            }),
            prisma.group.findMany({
                where: { workspaceId },
                select: { id: true, name: true, members: { select: { userId: true } } },
            }),
            prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
        ]);

        const userGroupMap = new Map();
        for (const group of groups) {
            for (const { userId } of group.members) {
                if (!userGroupMap.has(userId)) userGroupMap.set(userId, []);
                userGroupMap.get(userId).push({ id: group.id, name: group.name });
            }
        }

        const workspaceName = workspace?.name || "Admin";
        const WHATSAPP_MSG = encodeURIComponent(
            `Hi! This is a reminder from your workspace admin at ${workspaceName}. Please log in and check your tasks.`
        );

        const users = members.map((m) => ({
            id: m.user.id,
            name: m.user.name,
            email: m.user.email,
            image: m.user.image,
            mobile: m.user.mobile || null,
            role: m.role,
            memberSince: m.user.createdAt,
            lastLoginAt: m.user.lastLoginAt || null,
            // Admins are always considered "logged in" — they use env credentials
            hasLoggedIn: m.role === "ADMIN" ? true : !!m.user.lastLoginAt,
            hasMobile: !!m.user.mobile,
            groups: userGroupMap.get(m.user.id) || [],
            whatsappLink: m.user.mobile ? `https://wa.me/${m.user.mobile}?text=${WHATSAPP_MSG}` : null,
        }));

        res.json({ total: users.length, users });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST /api/users/reset-password — admin resets a member's password
// Body: { userId, newPassword? }
//   - if newPassword provided → set that password (manual mode)
//   - if newPassword omitted  → auto-generate 10-char password and email it
export const resetMemberPassword = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });
        const { userId, workspaceId, newPassword } = req.body;
        if (!userId) return res.status(400).json({ message: "userId is required" });

        const [member, workspace] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
            workspaceId ? prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }) : null,
        ]);
        if (!member) return res.status(404).json({ message: "User not found" });

        const workspaceName = workspace?.name || "Admin";

        // Determine password
        const isAuto = !newPassword;
        const password = isAuto
            ? crypto.randomBytes(5).toString("hex") // 10-char hex
            : newPassword;

        if (!isAuto && password.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        const hash = await bcrypt.hash(password, 10);
        await prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });

        if (isAuto) {
            await sendEmail({
                to: member.email,
                subject: "Your Workspace Password Has Been Reset",
                body: `
                    <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
                        <h2 style="color:#1d4ed8;margin-bottom:8px;">Password Reset</h2>
                        <p>Hi <strong>${member.name}</strong>,</p>
                        <p>Your workspace login password has been reset by the admin.</p>
                        <div style="background:#f3f4f6;border-radius:6px;padding:16px;margin:16px 0;text-align:center;">
                            <p style="margin:0;font-size:12px;color:#6b7280;">New Password</p>
                            <p style="margin:4px 0 0;font-size:22px;font-weight:700;letter-spacing:2px;color:#111827;">${password}</p>
                        </div>
                        <p style="color:#6b7280;font-size:13px;">Please log in and change your password immediately.</p>
                        <p style="color:#6b7280;font-size:13px;">— ${workspaceName}</p>
                    </div>
                `,
            });
            return res.json({ message: `Password reset and emailed to ${member.email}` });
        }

        res.json({ message: "Password reset successfully" });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// POST /api/users/send-login-reminder
// Sends a "please log in" email to one specific user (userId) OR all never-logged-in users in the workspace.
export const sendLoginReminder = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

        const { workspaceId, userId } = req.body;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            select: { name: true },
        });
        const workspaceName = workspace?.name || "your workspace";

        let targets = [];

        if (userId) {
            // Single user reminder
            const member = await prisma.workspaceMember.findFirst({
                where: { workspaceId, userId },
                include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
            });
            if (!member) return res.status(404).json({ message: "Member not found in workspace" });
            if (member.user.lastLoginAt) return res.status(400).json({ message: "This user has already logged in." });
            targets = [member.user];
        } else {
            // All never-logged-in members
            const members = await prisma.workspaceMember.findMany({
                where: { workspaceId },
                include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
            });
            targets = members.filter(m => !m.user.lastLoginAt).map(m => m.user);
        }

        if (targets.length === 0) {
            return res.json({ sent: 0, message: "No users to remind — everyone has already logged in." });
        }

        // Send emails in parallel (fire-and-forget per user, await all)
        await Promise.all(targets.map(u =>
            sendEmailLogged({
                to: u.email,
                subject: `Action Required: Please log in to ${workspaceName}`,
                body: `
                    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:28px;">
                        <h2 style="color:#1d4ed8;margin-bottom:8px;">👋 Welcome to ${workspaceName}</h2>
                        <p>Hi <strong>${u.name || u.email}</strong>,</p>
                        <p>You have been added to the <strong>${workspaceName}</strong> internship workspace, but we noticed you haven't logged in yet.</p>
                        <div style="margin:20px 0;padding:16px 20px;background:#eff6ff;border-radius:8px;border-left:4px solid #3b82f6;">
                            <p style="margin:0;font-size:14px;color:#1e40af;font-weight:600;">Please log in as soon as possible</p>
                            <p style="margin:8px 0 0;font-size:13px;color:#3b82f6;">
                                Your attendance, tasks, standups, and project assignments are waiting for you. Missing days cannot be recovered.
                            </p>
                        </div>
                        <p style="font-size:13px;color:#6b7280;">
                            If you don't have your login credentials, please contact your workspace admin or use the <strong>Forgot Password</strong> option on the login page.
                        </p>
                        <p style="margin-top:24px;font-size:12px;color:#9ca3af;">— ${workspaceName} Team</p>
                    </div>`,
                workspaceId,
            })
        ));

        res.json({
            sent: targets.length,
            message: `Login reminder sent to ${targets.length} user${targets.length !== 1 ? "s" : ""}.`,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: error.message });
    }
};

import { prisma } from "../configs/prisma.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import sendEmail from "../configs/nodemailer.js";

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

        const users = members.filter((m) => !m.user.lastLoginAt).map((m) => m.user);
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
            hasLoggedIn: !!m.user.lastLoginAt,
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

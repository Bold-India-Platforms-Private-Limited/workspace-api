import { prisma } from "../configs/prisma.js";

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

        const [members, groups] = await Promise.all([
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
        ]);

        const userGroupMap = new Map();
        for (const group of groups) {
            for (const { userId } of group.members) {
                if (!userGroupMap.has(userId)) userGroupMap.set(userId, []);
                userGroupMap.get(userId).push({ id: group.id, name: group.name });
            }
        }

        const WHATSAPP_MSG = encodeURIComponent(
            "Hi! This is a reminder from your workspace admin at Bluestock Fintech. Please log in and check your tasks."
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

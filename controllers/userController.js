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

        // Basic sanity: digits only, 7–15 chars (E.164 without +)
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

        const never = members
            .filter((m) => !m.user.lastLoginAt)
            .map((m) => m.user);

        res.json({ count: never.length, users: never });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// GET /api/users/team?workspaceId=xxx — admin: all members with mobile + login status
export const getTeam = async (req, res) => {
    try {
        if (req.user?.role !== "ADMIN") return res.status(403).json({ message: "Admin only" });

        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId is required" });

        const members = await prisma.workspaceMember.findMany({
            where: { workspaceId },
            include: {
                user: {
                    select: { id: true, name: true, email: true, mobile: true, image: true, lastLoginAt: true, createdAt: true },
                },
            },
            orderBy: { createdAt: "asc" },
        });

        const team = members.map((m) => ({
            ...m.user,
            role: m.role,
            memberSince: m.createdAt,
            hasLoggedIn: !!m.user.lastLoginAt,
            hasMobile: !!m.user.mobile,
            // WhatsApp prefilled link — opens chat with admin message
            whatsappLink: m.user.mobile
                ? `https://wa.me/${m.user.mobile}?text=Hi%20${encodeURIComponent(m.user.name)}%2C%20this%20is%20a%20message%20from%20your%20workspace%20admin.`
                : null,
        }));

        res.json({ total: team.length, team });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

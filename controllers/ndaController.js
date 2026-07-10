import { prisma } from "../configs/prisma.js";

// GET /api/nda/status?workspaceId=
export const getNdaStatus = async (req, res) => {
    try {
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId required" });

        const signature = await prisma.ndaSignature.findUnique({
            where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
        });

        res.json({ signed: Boolean(signature), signature: signature || null });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/nda/sign
export const signNda = async (req, res) => {
    try {
        const { workspaceId } = req.body;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId required" });

        const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
            || req.socket?.remoteAddress
            || null;
        const ua = req.headers["user-agent"] || null;

        const signature = await prisma.ndaSignature.upsert({
            where: { userId_workspaceId: { userId: req.user.id, workspaceId } },
            create: { userId: req.user.id, workspaceId, ipAddress: ip, userAgent: ua },
            update: {},   // don't overwrite an existing signature
        });

        res.json({ signed: true, signature });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/nda/all?workspaceId=   (admin only — see who signed)
export const getAllSignatures = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admins only" });
        const { workspaceId } = req.query;
        if (!workspaceId) return res.status(400).json({ message: "workspaceId required" });

        const sigs = await prisma.ndaSignature.findMany({
            where: { workspaceId },
            orderBy: { signedAt: "desc" },
            include: { user: { select: { id: true, name: true, email: true, image: true } } },
            take: 3000, // defensive cap — bounded by workspace member count, well above today's scale
        });
        res.json({ signatures: sigs });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

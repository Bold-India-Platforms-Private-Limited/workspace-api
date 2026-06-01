import { prisma } from "../configs/prisma.js";

// GET /api/projects/:projectId/documents
export const listDocuments = async (req, res) => {
    try {
        const { projectId } = req.params;
        const docs = await prisma.projectDocument.findMany({
            where: { projectId },
            orderBy: { createdAt: "desc" },
            include: { addedBy: { select: { id: true, name: true, image: true } } },
        });
        res.json({ documents: docs });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/projects/:projectId/documents  (admin only)
export const addDocument = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admins only" });
        const { projectId } = req.params;
        const { title, driveLink, description, tags } = req.body;

        if (!title?.trim()) return res.status(400).json({ message: "Title is required" });
        if (!driveLink?.trim()) return res.status(400).json({ message: "Drive link is required" });

        // Basic URL validation
        try { new URL(driveLink); } catch {
            return res.status(400).json({ message: "Invalid URL" });
        }

        const safeTags = Array.isArray(tags)
            ? tags.filter(t => typeof t === "string" && t.trim()).map(t => t.trim()).slice(0, 5)
            : [];

        const doc = await prisma.projectDocument.create({
            data: {
                projectId,
                title:       title.trim(),
                driveLink:   driveLink.trim(),
                description: description?.trim() || null,
                tags:        safeTags,
                addedById:   req.user.id,
            },
            include: { addedBy: { select: { id: true, name: true, image: true } } },
        });
        res.status(201).json({ document: doc });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// DELETE /api/projects/:projectId/documents/:docId  (admin only)
export const deleteDocument = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admins only" });
        const { docId } = req.params;
        await prisma.projectDocument.delete({ where: { id: docId } });
        res.json({ message: "Deleted" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

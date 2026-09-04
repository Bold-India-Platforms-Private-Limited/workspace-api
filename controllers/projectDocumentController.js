import { prisma } from "../configs/prisma.js";
import { invalidateWorkspaceCacheForProject } from "../configs/redis.js";

// A non-admin may see a project's documents (Drive links AND the files inside any
// dataset folder allocated to it) only if the project is actually allocated to
// them — as team lead, a direct project member, or a member of a group assigned
// to the project. This mirrors the project-visibility rule in
// workspaceController.scopeWorkspaceForMember.
const memberCanSeeProject = async (projectId, userId) => {
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
            team_lead: true,
            members: { select: { userId: true } },
            groups: { select: { group: { select: { members: { select: { userId: true } } } } } },
        },
    });
    if (!project) return null;
    const allowed =
        project.team_lead === userId ||
        project.members.some((m) => m.userId === userId) ||
        project.groups.some((pg) => pg.group.members.some((m) => m.userId === userId));
    return allowed;
};

// GET /api/projects/:projectId/documents
export const listDocuments = async (req, res) => {
    try {
        const { projectId } = req.params;

        if (req.user?.role !== "ADMIN") {
            const allowed = await memberCanSeeProject(projectId, req.user?.id);
            if (allowed === null) return res.status(404).json({ message: "Project not found" });
            if (!allowed) return res.status(403).json({ message: "You don't have access to this project" });
        }

        const docs = await prisma.projectDocument.findMany({
            where: { projectId },
            orderBy: { createdAt: "desc" },
            include: {
                addedBy: { select: { id: true, name: true, image: true } },
                datasetFolder: {
                    include: {
                        files: {
                            orderBy: { createdAt: "desc" },
                            include: { uploadedBy: { select: { id: true, name: true, image: true } } },
                        },
                    },
                },
            },
        });
        res.json({ documents: docs });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// POST /api/projects/:projectId/documents  (admin only)
// kind: "link"    → driveLink (Google Drive / any URL, iframe-previewed)
// kind: "dataset" → datasetFolderId (a Dataset Storage folder in the same workspace)
export const addDocument = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admins only" });
        const { projectId } = req.params;
        const { title, driveLink, description, tags, datasetFolderId } = req.body;
        const kind = req.body.kind === "dataset" ? "dataset" : "link";

        if (!title?.trim()) return res.status(400).json({ message: "Title is required" });

        const safeTags = Array.isArray(tags)
            ? tags.filter(t => typeof t === "string" && t.trim()).map(t => t.trim()).slice(0, 5)
            : [];

        const data = {
            projectId,
            title:       title.trim(),
            kind,
            description: description?.trim() || null,
            tags:        safeTags,
            addedById:   req.user.id,
            driveLink:   "",
            datasetFolderId: null,
        };

        if (kind === "dataset") {
            if (!datasetFolderId) return res.status(400).json({ message: "Select a dataset folder" });
            // Dataset folders are a global pool — any folder can be attached to any project.
            const folder = await prisma.datasetFolder.findUnique({ where: { id: datasetFolderId }, select: { id: true } });
            if (!folder) return res.status(404).json({ message: "Dataset folder not found" });
            data.datasetFolderId = datasetFolderId;
        } else {
            if (!driveLink?.trim()) return res.status(400).json({ message: "Drive link is required" });
            try { new URL(driveLink); } catch {
                return res.status(400).json({ message: "Invalid URL" });
            }
            data.driveLink = driveLink.trim();
        }

        const doc = await prisma.projectDocument.create({
            data,
            include: {
                addedBy: { select: { id: true, name: true, image: true } },
                datasetFolder: {
                    include: {
                        files: {
                            orderBy: { createdAt: "desc" },
                            include: { uploadedBy: { select: { id: true, name: true, image: true } } },
                        },
                    },
                },
            },
        });
        // Refresh the cached workspace graph so the Documents-tab "datasets" badge updates.
        await invalidateWorkspaceCacheForProject(projectId, prisma).catch(() => {});
        res.status(201).json({ document: doc });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// DELETE /api/projects/:projectId/documents/:docId  (admin only)
export const deleteDocument = async (req, res) => {
    try {
        if (req.user.role !== "ADMIN") return res.status(403).json({ message: "Admins only" });
        const { projectId, docId } = req.params;
        await prisma.projectDocument.delete({ where: { id: docId } });
        await invalidateWorkspaceCacheForProject(projectId, prisma).catch(() => {});
        res.json({ message: "Deleted" });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

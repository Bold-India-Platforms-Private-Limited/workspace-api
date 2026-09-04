import crypto from "crypto";
import { prisma } from "../configs/prisma.js";
import { uploadBufferToR2, deleteFromR2, deleteManyFromR2, extractKeyFromUrl } from "../configs/r2.js";

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Admin only" });
        return false;
    }
    return true;
};

const safeName = (name = "file") =>
    String(name).replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_").slice(0, 120) || "file";

const folderWithMeta = (folder) => ({
    id: folder.id,
    workspaceId: folder.workspaceId,
    name: folder.name,
    description: folder.description,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
    fileCount: folder._count?.files ?? folder.files?.length ?? 0,
    createdBy: folder.createdBy,
    files: folder.files,
});

// GET /api/datasets  — global pool of dataset folders (shared across workspaces)
export const listFolders = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;

        const folders = await prisma.datasetFolder.findMany({
            orderBy: { createdAt: "desc" },
            include: {
                _count: { select: { files: true } },
                createdBy: { select: { id: true, name: true, image: true } },
            },
        });
        res.json({ folders: folders.map(folderWithMeta) });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// GET /api/datasets/:folderId
export const getFolder = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const folder = await prisma.datasetFolder.findUnique({
            where: { id: req.params.folderId },
            include: {
                createdBy: { select: { id: true, name: true, image: true } },
                files: {
                    orderBy: { createdAt: "desc" },
                    include: { uploadedBy: { select: { id: true, name: true, image: true } } },
                },
            },
        });
        if (!folder) return res.status(404).json({ message: "Folder not found" });
        res.json({ folder: folderWithMeta(folder) });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// POST /api/datasets  { name, description }
export const createFolder = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { name, description } = req.body;
        if (!name?.trim()) return res.status(400).json({ message: "Folder name is required" });

        const folder = await prisma.datasetFolder.create({
            data: {
                id: crypto.randomUUID(),
                name: name.trim().slice(0, 120),
                description: description?.trim()?.slice(0, 500) || null,
                createdById: req.user.id,
            },
            include: { _count: { select: { files: true } }, createdBy: { select: { id: true, name: true, image: true } } },
        });
        res.status(201).json({ folder: folderWithMeta(folder) });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// PATCH /api/datasets/:folderId  { name, description }
export const renameFolder = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { name, description } = req.body;
        const data = {};
        if (typeof name === "string" && name.trim()) data.name = name.trim().slice(0, 120);
        if (typeof description === "string") data.description = description.trim().slice(0, 500) || null;
        if (Object.keys(data).length === 0) return res.status(400).json({ message: "Nothing to update" });

        const folder = await prisma.datasetFolder.update({
            where: { id: req.params.folderId },
            data,
            include: { _count: { select: { files: true } }, createdBy: { select: { id: true, name: true, image: true } } },
        });
        res.json({ folder: folderWithMeta(folder) });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/datasets/:folderId  — removes the folder, its files, and all R2 objects.
export const deleteFolder = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const folder = await prisma.datasetFolder.findUnique({
            where: { id: req.params.folderId },
            include: { files: { select: { key: true, url: true } } },
        });
        if (!folder) return res.status(404).json({ message: "Folder not found" });

        const keys = folder.files.map((f) => f.key || extractKeyFromUrl(f.url)).filter(Boolean);
        if (keys.length) await deleteManyFromR2(keys).catch(() => {});

        await prisma.datasetFolder.delete({ where: { id: folder.id } });
        res.json({ message: "Folder deleted" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// POST /api/datasets/:folderId/files  — multipart, field "files" (multer .array)
export const uploadFiles = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { folderId } = req.params;
        const files = req.files || [];
        if (files.length === 0) return res.status(400).json({ message: "No files uploaded" });

        const folder = await prisma.datasetFolder.findUnique({ where: { id: folderId }, select: { id: true } });
        if (!folder) return res.status(404).json({ message: "Folder not found" });

        const created = [];
        for (const file of files) {
            const rand = crypto.randomBytes(4).toString("hex");
            const key = `workspace/shared-datasets/${folder.id}/${Date.now()}-${rand}-${safeName(file.originalname)}`;
            const { url } = await uploadBufferToR2(file.buffer, file.mimetype, key);
            created.push({
                id: crypto.randomUUID(),
                folderId: folder.id,
                name: file.originalname?.slice(0, 200) || "file",
                key,
                url,
                size: file.size || file.buffer.length,
                contentType: file.mimetype || "application/octet-stream",
                uploadedById: req.user.id,
            });
        }

        await prisma.datasetFile.createMany({ data: created });
        await prisma.datasetFolder.update({ where: { id: folder.id }, data: { updatedAt: new Date() } });

        const saved = await prisma.datasetFile.findMany({
            where: { id: { in: created.map((c) => c.id) } },
            orderBy: { createdAt: "desc" },
            include: { uploadedBy: { select: { id: true, name: true, image: true } } },
        });
        res.status(201).json({ files: saved });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

// DELETE /api/datasets/:folderId/files/:fileId
export const deleteFile = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { folderId, fileId } = req.params;
        const file = await prisma.datasetFile.findFirst({ where: { id: fileId, folderId } });
        if (!file) return res.status(404).json({ message: "File not found" });

        const key = file.key || extractKeyFromUrl(file.url);
        if (key) await deleteFromR2(key).catch(() => {});

        await prisma.datasetFile.delete({ where: { id: file.id } });
        res.json({ message: "File deleted" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

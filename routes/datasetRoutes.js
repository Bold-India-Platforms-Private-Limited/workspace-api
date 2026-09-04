import express from "express";
import multer from "multer";
import {
    listFolders,
    getFolder,
    createFolder,
    renameFolder,
    deleteFolder,
    uploadFiles,
    deleteFile,
} from "../controllers/datasetController.js";

const datasetRouter = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 20 },
});

datasetRouter.get("/", listFolders);
datasetRouter.post("/", createFolder);
datasetRouter.get("/:folderId", getFolder);
datasetRouter.patch("/:folderId", renameFolder);
datasetRouter.delete("/:folderId", deleteFolder);
datasetRouter.post("/:folderId/files", upload.array("files", 20), uploadFiles);
datasetRouter.delete("/:folderId/files/:fileId", deleteFile);

export default datasetRouter;

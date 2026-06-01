import express from "express";
import { addMember, createProject, updateProject, deleteProject } from "../controllers/projectController.js";
import { listDocuments, addDocument, deleteDocument } from "../controllers/projectDocumentController.js";

const projectRouter = express.Router();

projectRouter.post("/", createProject);
projectRouter.put("/", updateProject);
projectRouter.delete("/:projectId", deleteProject);
projectRouter.post("/:projectId/addMember", addMember);

// Documents
projectRouter.get("/:projectId/documents", listDocuments);
projectRouter.post("/:projectId/documents", addDocument);
projectRouter.delete("/:projectId/documents/:docId", deleteDocument);

export default projectRouter;

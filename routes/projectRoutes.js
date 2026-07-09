import express from "express";
import { addMember, createProject, updateProject, deleteProject } from "../controllers/projectController.js";
import { listDocuments, addDocument, deleteDocument } from "../controllers/projectDocumentController.js";
import { sendProjectMessage, listCandidateTeamMessages } from "../controllers/projectMessageController.js";

const projectRouter = express.Router();

projectRouter.post("/", createProject);
projectRouter.put("/", updateProject);
projectRouter.delete("/:projectId", deleteProject);
projectRouter.post("/:projectId/addMember", addMember);

// Documents
projectRouter.get("/:projectId/documents", listDocuments);
projectRouter.post("/:projectId/documents", addDocument);
projectRouter.delete("/:projectId/documents/:docId", deleteDocument);

// Candidate Teams — messages to the Project Manager
projectRouter.get("/candidate-teams", listCandidateTeamMessages);
projectRouter.post("/:projectId/messages", sendProjectMessage);

export default projectRouter;

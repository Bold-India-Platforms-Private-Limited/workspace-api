import express from "express";
import { addMember, createProject, updateProject, deleteProject } from "../controllers/projectController.js";

const projectRouter = express.Router();

projectRouter.post("/", createProject);
projectRouter.put("/", updateProject);
projectRouter.delete("/:projectId", deleteProject);
projectRouter.post("/:projectId/addMember", addMember);

export default projectRouter;

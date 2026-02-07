import express from "express";
import { createWorkspace, getUserWorkspaces, importProjects, inviteWorkspaceMember, inviteWorkspaceMembersBulk, removeWorkspaceMembersBulk, deleteWorkspace } from "../controllers/workspaceController.js";

const workspaceRouter = express.Router();

workspaceRouter.get("/", getUserWorkspaces);
workspaceRouter.post("/", createWorkspace);
workspaceRouter.post("/:workspaceId/invite", inviteWorkspaceMember);
workspaceRouter.post("/:workspaceId/invite-bulk", inviteWorkspaceMembersBulk);
workspaceRouter.delete("/:workspaceId/members", removeWorkspaceMembersBulk);
workspaceRouter.delete("/:workspaceId", deleteWorkspace);
workspaceRouter.post("/:workspaceId/import-projects", importProjects);

export default workspaceRouter;

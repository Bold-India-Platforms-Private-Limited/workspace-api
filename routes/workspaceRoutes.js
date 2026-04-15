import express from "express";
import {
    createWorkspace,
    getUserWorkspaces,
    importProjects,
    inviteWorkspaceMember,
    inviteWorkspaceMembersBulk,
    removeWorkspaceMembersBulk,
    deleteWorkspace,
    regenerateCredentials,
    searchMemberByEmail,
} from "../controllers/workspaceController.js";

const workspaceRouter = express.Router();

workspaceRouter.get("/", getUserWorkspaces);
workspaceRouter.post("/", createWorkspace);
workspaceRouter.post("/:workspaceId/invite", inviteWorkspaceMember);
workspaceRouter.post("/:workspaceId/invite-bulk", inviteWorkspaceMembersBulk);
workspaceRouter.delete("/:workspaceId/members", removeWorkspaceMembersBulk);
workspaceRouter.delete("/:workspaceId", deleteWorkspace);
workspaceRouter.post("/:workspaceId/import-projects", importProjects);
workspaceRouter.post("/:workspaceId/members/:userId/regenerate-credentials", regenerateCredentials);
workspaceRouter.get("/:workspaceId/members/search", searchMemberByEmail);

export default workspaceRouter;

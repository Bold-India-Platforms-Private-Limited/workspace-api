import express from "express";
import { createGroup, deleteGroup, getGroup, listGroups, updateGroupMembers, listGroupMessages, createGroupMessage, clearGroupMessages } from "../controllers/groupController.js";

const groupRouter = express.Router();

groupRouter.get("/", listGroups);
groupRouter.get("/:id", getGroup);
groupRouter.get("/:id/messages", listGroupMessages);
groupRouter.post("/", createGroup);
groupRouter.post("/:id/messages", createGroupMessage);
groupRouter.delete("/:id/messages", clearGroupMessages);
groupRouter.put("/:id/members", updateGroupMembers);
groupRouter.delete("/:id", deleteGroup);

export default groupRouter;
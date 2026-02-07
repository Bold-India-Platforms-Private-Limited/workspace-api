import express from "express";
import { listNotifications, createNotification, updateNotification, deleteNotification } from "../controllers/notificationController.js";

const notificationRouter = express.Router();

notificationRouter.get("/", listNotifications);
notificationRouter.post("/", createNotification);
notificationRouter.put("/:id", updateNotification);
notificationRouter.delete("/:id", deleteNotification);

export default notificationRouter;

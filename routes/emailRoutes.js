import express from "express";
import { getEmailLogs, deleteEmailLog, bulkDeleteEmailLogs, sendBroadcastEmail } from "../controllers/emailController.js";

const emailRouter = express.Router();

emailRouter.get("/", getEmailLogs);
emailRouter.post("/broadcast", sendBroadcastEmail);
emailRouter.delete("/bulk", bulkDeleteEmailLogs);
emailRouter.delete("/:id", deleteEmailLog);

export default emailRouter;

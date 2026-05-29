import express from "express";
import { getEmailLogs, deleteEmailLog, bulkDeleteEmailLogs } from "../controllers/emailController.js";

const emailRouter = express.Router();

emailRouter.get("/", getEmailLogs);
emailRouter.delete("/bulk", bulkDeleteEmailLogs);
emailRouter.delete("/:id", deleteEmailLog);

export default emailRouter;

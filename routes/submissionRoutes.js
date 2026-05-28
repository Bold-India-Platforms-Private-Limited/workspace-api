import express from "express";
import {
    submitLink,
    getMySubmission,
    getAllSubmissions,
    addAdminNote,
    deleteSubmission,
} from "../controllers/submissionController.js";

const submissionRouter = express.Router();

submissionRouter.get("/me", getMySubmission);
submissionRouter.get("/", getAllSubmissions);
submissionRouter.post("/", submitLink);
submissionRouter.put("/:id/note", addAdminNote);
submissionRouter.delete("/:id", deleteSubmission);

export default submissionRouter;

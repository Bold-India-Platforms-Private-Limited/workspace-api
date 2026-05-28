import express from "express";
import {
    submitStandup,
    updateStandup,
    deleteStandup,
    getMyStandups,
    getStandupsByDate,
    getStandupSummary,
} from "../controllers/standupController.js";

const standupRouter = express.Router();

// Static routes must come before /:id
standupRouter.get("/me", getMyStandups);           // intern: own history by month
standupRouter.get("/summary", getStandupSummary);  // admin: monthly submission summary
standupRouter.get("/", getStandupsByDate);         // admin: all entries for a date

standupRouter.post("/", submitStandup);            // intern: submit entry
standupRouter.put("/:id", updateStandup);          // intern: edit own (same day only)
standupRouter.delete("/:id", deleteStandup);       // intern/admin: delete

export default standupRouter;

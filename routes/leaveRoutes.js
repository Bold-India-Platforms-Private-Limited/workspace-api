import express from "express";
import { submitLeave, getMyLeaves, getAllLeaves, reviewLeave, cancelLeave, checkLeaveForDate } from "../controllers/leaveController.js";

const leaveRouter = express.Router();

leaveRouter.get("/check", checkLeaveForDate);       // attendance: approved leaves for a date
leaveRouter.get("/me", getMyLeaves);                // intern: own requests
leaveRouter.get("/", getAllLeaves);                 // admin: all requests
leaveRouter.post("/", submitLeave);                 // intern: submit
leaveRouter.put("/:id/review", reviewLeave);        // admin: approve/reject
leaveRouter.delete("/:id", cancelLeave);            // intern/admin: cancel

export default leaveRouter;

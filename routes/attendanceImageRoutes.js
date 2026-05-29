import express from "express";
import {
    listAttendanceImages,
    deleteAttendanceImage,
    listOrphanedImages,
    purgeOrphanedImages,
} from "../controllers/attendanceImageController.js";

const attendanceImageRouter = express.Router();

attendanceImageRouter.get("/", listAttendanceImages);
attendanceImageRouter.get("/orphaned", listOrphanedImages);
attendanceImageRouter.post("/orphaned/purge", purgeOrphanedImages);
attendanceImageRouter.delete("/:id", deleteAttendanceImage);

export default attendanceImageRouter;

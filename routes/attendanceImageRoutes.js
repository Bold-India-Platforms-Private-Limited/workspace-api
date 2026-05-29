import express from "express";
import {
    listAttendanceImages,
    deleteAttendanceImage,
    bulkDeleteAttendanceImages,
    listOrphanedImages,
    purgeOrphanedImages,
} from "../controllers/attendanceImageController.js";

const attendanceImageRouter = express.Router();

attendanceImageRouter.get("/", listAttendanceImages);
attendanceImageRouter.post("/bulk-delete", bulkDeleteAttendanceImages);
attendanceImageRouter.get("/orphaned", listOrphanedImages);
attendanceImageRouter.post("/orphaned/purge", purgeOrphanedImages);
attendanceImageRouter.delete("/:id", deleteAttendanceImage);

export default attendanceImageRouter;

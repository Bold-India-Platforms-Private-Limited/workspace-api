import express from "express";
import { markAttendance, getMyAttendance, getMyAttendanceStatus, getAttendanceByDate, deleteAttendanceByDates, getAbsentLists, sendAttendanceReminder } from "../controllers/attendanceController.js";

const attendanceRouter = express.Router();

attendanceRouter.post("/", markAttendance);
attendanceRouter.post("/send-reminder", sendAttendanceReminder);
attendanceRouter.get("/me", getMyAttendance);
attendanceRouter.get("/my-status", getMyAttendanceStatus);
attendanceRouter.get("/date", getAttendanceByDate);
attendanceRouter.get("/absent-lists", getAbsentLists);
attendanceRouter.delete("/batch", deleteAttendanceByDates);

export default attendanceRouter;

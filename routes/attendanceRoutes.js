import express from "express";
import { markAttendance, getMyAttendance, getAttendanceByDate, deleteAttendanceByDates } from "../controllers/attendanceController.js";

const attendanceRouter = express.Router();

attendanceRouter.post("/", markAttendance);
attendanceRouter.get("/me", getMyAttendance);
attendanceRouter.get("/date", getAttendanceByDate);
attendanceRouter.delete("/batch", deleteAttendanceByDates);

export default attendanceRouter;

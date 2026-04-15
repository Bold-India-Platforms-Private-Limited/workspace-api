import express from "express";
import { markAttendance, getMyAttendance, getAttendanceByDate, deleteAttendanceByDates, getAbsentLists } from "../controllers/attendanceController.js";

const attendanceRouter = express.Router();

attendanceRouter.post("/", markAttendance);
attendanceRouter.get("/me", getMyAttendance);
attendanceRouter.get("/date", getAttendanceByDate);
attendanceRouter.get("/absent-lists", getAbsentLists);
attendanceRouter.delete("/batch", deleteAttendanceByDates);

export default attendanceRouter;

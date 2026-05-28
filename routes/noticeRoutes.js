import express from "express";
import { listNotices, createNotice, updateNotice, deleteNotice } from "../controllers/noticeController.js";

const noticeRouter = express.Router();

noticeRouter.get("/", listNotices);
noticeRouter.post("/", createNotice);
noticeRouter.patch("/:id", updateNotice);
noticeRouter.delete("/:id", deleteNotice);

export default noticeRouter;

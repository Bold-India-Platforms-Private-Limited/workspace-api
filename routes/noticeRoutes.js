import express from "express";
import { listNotices, createNotice, updateNotice, deleteNotice, publishNotice } from "../controllers/noticeController.js";

const noticeRouter = express.Router();

noticeRouter.get("/", listNotices);
noticeRouter.post("/", createNotice);
noticeRouter.patch("/:id", updateNotice);
noticeRouter.patch("/:id/publish", publishNotice);
noticeRouter.delete("/:id", deleteNotice);

export default noticeRouter;

import express from "express";
import { getNdaStatus, signNda, getAllSignatures } from "../controllers/ndaController.js";

const ndaRouter = express.Router();

ndaRouter.get("/status",  getNdaStatus);
ndaRouter.post("/sign",   signNda);
ndaRouter.get("/all",     getAllSignatures);

export default ndaRouter;

import express from "express";
import { login, requestNewPassword } from "../controllers/authController.js";
import { getCaptcha } from "../controllers/captchaController.js";

const authRouter = express.Router();

authRouter.get("/captcha", getCaptcha);
authRouter.post("/login", login);
authRouter.post("/request-password", requestNewPassword);

export default authRouter;
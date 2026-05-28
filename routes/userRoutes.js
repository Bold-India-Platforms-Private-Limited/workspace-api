import express from "express";
import { getMe, updateMobile, neverLoggedIn, getTeam, resetMemberPassword } from "../controllers/userController.js";

const userRouter = express.Router();

userRouter.get("/me", getMe);                          // intern: own profile
userRouter.put("/me/mobile", updateMobile);            // intern: set WhatsApp number
userRouter.get("/never-logged-in", neverLoggedIn);     // admin: who never logged in
userRouter.get("/team", getTeam);                      // admin: full team list with mobile + login status
userRouter.post("/reset-password", resetMemberPassword); // admin: reset a member's password

export default userRouter;

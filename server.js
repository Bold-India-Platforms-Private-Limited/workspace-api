import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import workspaceRouter from "./routes/workspaceRoutes.js";
import projectRouter from "./routes/projectRoutes.js";
import taskRouter from "./routes/taskRoutes.js";
import commentRouter from "./routes/commentRoutes.js";
import authRouter from "./routes/authRoutes.js";
import groupRouter from "./routes/groupRoutes.js";
import notificationRouter from "./routes/notificationRoutes.js";
import attendanceRouter from "./routes/attendanceRoutes.js";
import { protect } from "./middlewares/authMiddleware.js";

const app = express();

app.use(express.json({ limit: "10mb" }));
app.use(cors());

app.get('/', (req, res) => res.send('Server is live!'));

// Routes
app.use("/api/auth", authRouter);
app.use("/api/workspaces", protect, workspaceRouter);
app.use("/api/projects", protect, projectRouter);
app.use("/api/tasks", protect, taskRouter);
app.use("/api/comments", protect, commentRouter);
app.use("/api/groups", protect, groupRouter);
app.use("/api/notifications", protect, notificationRouter);
app.use("/api/attendance", protect, attendanceRouter);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
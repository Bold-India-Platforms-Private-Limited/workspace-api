import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
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
const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});

// Track active users per workspace: Map<workspaceId, Map<userId, userInfo>>
const activeUsers = new Map();

io.on('connection', (socket) => {
    socket.on('join_workspace', ({ workspaceId, userId, name, email }) => {
        if (!workspaceId || !userId) return;

        socket.workspaceId = workspaceId;
        socket.userId = userId;
        socket.join(workspaceId);

        if (!activeUsers.has(workspaceId)) {
            activeUsers.set(workspaceId, new Map());
        }
        activeUsers.get(workspaceId).set(userId, {
            userId,
            name: name || email,
            email,
            joinedAt: new Date().toISOString(),
        });

        // Broadcast updated list to everyone in this workspace
        io.to(workspaceId).emit('active_users', Array.from(activeUsers.get(workspaceId).values()));
    });

    socket.on('disconnect', () => {
        const { workspaceId, userId } = socket;
        if (workspaceId && userId && activeUsers.has(workspaceId)) {
            activeUsers.get(workspaceId).delete(userId);
            io.to(workspaceId).emit('active_users', Array.from(activeUsers.get(workspaceId).values()));
            if (activeUsers.get(workspaceId).size === 0) {
                activeUsers.delete(workspaceId);
            }
        }
    });
});

// Export io for use in controllers if needed
export { io };

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

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));

import { prisma, pool } from "../configs/prisma.js";
import { sendEmailsWithProgress } from "../configs/emailQueue.js";
import { cacheGet, cacheSet, cacheDel } from "../configs/redis.js";

const NOTIF_CACHE_TTL = 60; // seconds
const notifCacheKey = (workspaceId) => `notif:ws:${workspaceId}`;

// Safe user select — never exposes mobile, passwordHash, or lastLoginAt
const safeUser = { select: { id: true, name: true, email: true, image: true } };

const ensureAdmin = (req, res) => {
    if (req.user?.role !== "ADMIN") {
        res.status(403).json({ message: "Only admin can manage notifications" });
        return false;
    }
    return true;
};

const getDayBounds = (date) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
};

export const listNotifications = async (req, res) => {
    try {
        const { workspaceId } = req.query;
        if (!workspaceId) {
            return res.status(400).json({ message: "workspaceId is required" });
        }

        const cacheKey = notifCacheKey(workspaceId);
        let notifications = await cacheGet(cacheKey);
        if (!notifications) {
            notifications = await prisma.notification.findMany({
                where: { workspaceId },
                orderBy: { createdAt: "desc" },
                take: 200, // defensive cap — admin-authored content, low write rate
            });
            await cacheSet(cacheKey, notifications, NOTIF_CACHE_TTL);
        }

        if (req.user?.role === "MEMBER") {
            const { start, end } = getDayBounds(new Date());
            const hasAttendance = await prisma.attendance.findFirst({
                where: {
                    workspaceId,
                    userId: req.user?.id,
                    date: { gte: start, lte: end },
                },
            });

            if (!hasAttendance) {
                notifications.unshift({
                    id: "attendance_reminder",
                    title: "Mark attendance",
                    subtitle: "Please mark your attendance for today.",
                    buttonName: "Mark now",
                    buttonUrl: "/attendance",
                    openInNewTab: false,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            }
        }

        res.json({ notifications });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const createNotification = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { workspaceId, title, subtitle, buttonName, buttonUrl, openInNewTab } = req.body;
        const origin = req.get('origin');

        if (!workspaceId || !title) {
            return res.status(400).json({ message: "workspaceId and title are required" });
        }

        const notification = await prisma.notification.create({
            data: {
                workspaceId,
                title,
                subtitle: subtitle || null,
                buttonName: buttonName || null,
                buttonUrl: buttonUrl || null,
                openInNewTab: Boolean(openInNewTab),
            },
        });

        const workspace = await prisma.workspace.findUnique({
            where: { id: workspaceId },
            include: { members: { include: { user: safeUser } } },
        });
        await cacheDel([notifCacheKey(workspaceId)]);

        if (workspace?.members?.length) {
            const linkHtml = buttonName && buttonUrl
                ? `<p><a href="${buttonUrl}" target="${openInNewTab ? "_blank" : "_self"}">${buttonName}</a></p>`
                : "";

            const recipientEmails = workspace.members.map((m) => m.user?.email).filter(Boolean);

            sendEmailsWithProgress({
                adminUserId: req.user?.id,
                workspaceId,
                label: `Notification: ${title}`,
                emails: recipientEmails.map((email) => ({
                    to: email,
                    subject: `New notification: ${title}`,
                    body: `
                        <div style="max-width:600px;">
                            <a href="${origin || ""}" style="background-color:#007bff;padding:12px 24px;border-radius:5px;color:#fff;font-weight:600;font-size:16px;text-decoration:none;display:inline-block;margin-bottom:16px;">Go To Workspace</a>
                            <h2>${title}</h2>
                            ${subtitle ? `<p>${subtitle}</p>` : ""}
                            ${linkHtml}
                        </div>`,
                })),
            }).catch(() => {});
        }

        res.json({ notification, message: "Notification created" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const updateNotification = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { id } = req.params;
        const { title, subtitle, buttonName, buttonUrl, openInNewTab } = req.body;

        const notification = await prisma.notification.update({
            where: { id },
            data: {
                title,
                subtitle: subtitle || null,
                buttonName: buttonName || null,
                buttonUrl: buttonUrl || null,
                openInNewTab: Boolean(openInNewTab),
            },
        });
        await cacheDel([notifCacheKey(notification.workspaceId)]);

        res.json({ notification, message: "Notification updated" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

export const deleteNotification = async (req, res) => {
    try {
        if (!ensureAdmin(req, res)) return;
        const { id } = req.params;
        const deleted = await prisma.notification.delete({ where: { id } });
        await cacheDel([notifCacheKey(deleted.workspaceId)]);
        res.json({ message: "Notification deleted" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: error.code || error.message });
    }
};

import { randomUUID } from "crypto";
import sendEmail from "./nodemailer.js";
import { prisma } from "./prisma.js";
import { io } from "../server.js";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send an array of emails with:
 *  - A random per-minute rate cap (100–250 emails/min)
 *  - Real-time progress emitted via Socket.io to the triggering admin
 *  - Every send (success or failure) logged to EmailLog in DB
 *
 * Runs in the background — callers should NOT await this.
 *
 * @param {Array<{ to, subject, body }>} emails
 * @param {string}  adminUserId   socket room "user:<id>" receives progress events
 * @param {string}  workspaceId   used for DB logging
 * @param {string}  [label]       human-readable label shown in progress bar
 */
export async function sendEmailsWithProgress({ emails, adminUserId, workspaceId, label = "Email" }) {
    const jobId = randomUUID();
    const total = emails.length;

    if (total === 0) return { jobId, total: 0, sent: 0, failed: 0, rateLimit: 0 };

    // Random rate: 100–250 per minute
    const rateLimit = Math.floor(Math.random() * 151) + 100; // 100..250
    const delayMs = Math.floor(60_000 / rateLimit);

    const emit = (payload) => {
        try {
            if (io && adminUserId) io.to(`user:${adminUserId}`).emit("email_job_progress", payload);
        } catch { /* socket may be gone */ }
    };

    // Announce job start
    emit({ jobId, label, total, sent: 0, failed: 0, rateLimit, done: false });

    let sent = 0;
    let failed = 0;

    for (const email of emails) {
        let status = "sent";
        let errorMessage = null;

        try {
            await sendEmail(email);
            sent++;
        } catch (err) {
            failed++;
            status = "failed";
            errorMessage = err?.message || "Unknown error";
        }

        // Log to DB (best-effort)
        if (workspaceId) {
            prisma.emailLog.create({
                data: {
                    workspaceId,
                    recipientEmail: email.to,
                    subject: email.subject,
                    htmlContent: email.body,
                    status,
                    errorMessage,
                },
            }).catch(() => {});
        }

        const done = sent + failed >= total;
        emit({ jobId, label, total, sent, failed, rateLimit, done });

        if (!done) await delay(delayMs);
    }

    return { jobId, total, sent, failed, rateLimit };
}

/**
 * Send a single email and log it to EmailLog.
 * Drop-in wrapper around sendEmail for one-off sends.
 */
export async function sendEmailLogged({ to, subject, body, workspaceId }) {
    let status = "sent";
    let errorMessage = null;

    try {
        await sendEmail({ to, subject, body });
    } catch (err) {
        status = "failed";
        errorMessage = err?.message || "Unknown error";
        // re-throw so callers can handle it
        throw err;
    } finally {
        if (workspaceId) {
            prisma.emailLog.create({
                data: { workspaceId, recipientEmail: to, subject, htmlContent: body, status, errorMessage },
            }).catch(() => {});
        }
    }
}

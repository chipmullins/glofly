import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { requireAuth } from "../auth/sessions";
import { emailSchema, passwordSchema, PASSWORD_MAX } from "../auth/validation";
import { cancelTokens, pendingEmailFor } from "../email/tokens";
import {
  cancelEmailChange,
  notifyPasswordChanged,
  requestEmailChange,
  resendVerification,
} from "./email";
import { connectedSessionIds, disconnectSession, disconnectSessions, emitToUser } from "../realtime";
import { scheduleDeletion } from "./deletion";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { isTimeOfDay } from "@glofly/shared";

// Settings → Account: email (confirm, change), where you're signed in, change password, delete account.
export const accountRouter = Router();
accountRouter.use(requireAuth);

type Me = { id: string; username: string };
const me = (res: Response): Me => res.locals.user as Me;

// Wrong current passwords count against this, so a borrowed computer can't be used to guess.
const passwordCheckLimiter = rateLimit("account:password-check", {
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    message: "Too many tries. Wait a few minutes and try again.",
  },
});

const WRONG_PASSWORD = "That isn't your current password.";

// Amazon didn't accept an email (it's logged on the server). Nothing was changed.
const EMAIL_FAILED = {
  error: "email_failed",
  message: "We couldn't send the email right now. Try again in a few minutes.",
};

async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return !!row && (await verifyPassword(row.passwordHash, password));
}

// GET /account — the private details only you see on the Account page.
// emailVerified / pendingEmail were added later; older app versions just ignore them.
accountRouter.get("/", async (_req, res) => {
  const myId = me(res).id;
  const [row] = await db
    .select({
      username: users.username,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      restricted: users.restricted,
    })
    .from(users)
    .where(eq(users.id, myId));
  res.json({
    ...(row.restricted ? { restricted: true } : {}),
    username: row.username,
    email: row.email,
    emailVerified: !!row.emailVerifiedAt,
    pendingEmail: await pendingEmailFor(myId),
    createdAt: row.createdAt,
  });
});

// POST /account/email/verify — send the "Confirm your email" link again.
accountRouter.post("/email/verify", async (_req, res) => {
  const result = await resendVerification(me(res).id);
  if (result === "already_verified") {
    res.status(409).json({ error: "already_verified", message: "Your email is already confirmed." });
    return;
  }
  if (result === "too_many") {
    res.status(429).json({
      error: "too_many_requests",
      message: "We've sent a few already. Check your spam folder, or try again in an hour.",
    });
    return;
  }
  if (result === "send_failed") {
    res.status(503).json(EMAIL_FAILED);
    return;
  }
  res.json({ ok: true });
});

const changeEmailSchema = z.object({
  newEmail: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX),
});

// POST /account/email  { newEmail, password }
// Sends a confirm link to the new address. The email only changes once that link is used;
// until then the old one keeps working (and gets a heads-up).
accountRouter.post("/email", passwordCheckLimiter, async (req, res) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  const parsed = changeEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0].path[0] ?? "newEmail");
    res.status(400).json({
      error: "invalid",
      fields: {
        [field]: field === "password" ? "Enter your password." : parsed.error.issues[0].message,
      },
    });
    return;
  }
  const { newEmail, password } = parsed.data;
  const myId = me(res).id;
  if (!(await passwordMatches(myId, password))) {
    res.status(400).json({ error: "wrong_password", fields: { password: "That password isn't right." } });
    return;
  }
  const result = await requestEmailChange(myId, newEmail);
  if (result === "same") {
    res.status(400).json({ error: "invalid", fields: { newEmail: "That's already your email." } });
    return;
  }
  if (result === "taken") {
    res.status(409).json({
      error: "taken",
      fields: { newEmail: "An account with this email already exists." },
    });
    return;
  }
  if (result === "too_many") {
    res.status(429).json({
      error: "too_many_requests",
      message: "Too many email changes. Try again in an hour.",
    });
    return;
  }
  if (result === "send_failed") {
    res.status(503).json(EMAIL_FAILED);
    return;
  }
  res.json({ ok: true, pendingEmail: newEmail });
});

// DELETE /account/email/pending — cancel a change that hasn't been confirmed.
accountRouter.delete("/email/pending", async (_req, res) => {
  await cancelEmailChange(me(res).id);
  res.json({ ok: true });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: passwordSchema,
  signOutOthers: z.boolean().default(true),
});

// POST /account/password  { currentPassword, newPassword, signOutOthers }
// This device stays signed in. With signOutOthers, every other device is signed out.
accountRouter.post("/password", passwordCheckLimiter, async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "newPassword");
    res.status(400).json({
      error: "invalid",
      fields: { [field]: field === "currentPassword" ? "Enter your current password." : issue.message },
    });
    return;
  }
  const { currentPassword, newPassword, signOutOthers } = parsed.data;
  const myId = me(res).id;

  if (!(await passwordMatches(myId, currentPassword))) {
    res.status(400).json({ error: "wrong_password", fields: { currentPassword: WRONG_PASSWORD } });
    return;
  }
  if (newPassword === currentPassword) {
    res.status(400).json({
      error: "invalid",
      fields: { newPassword: "That's your current password. Choose a new one." },
    });
    return;
  }

  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, myId));
  // A reset link sent before the change can't be used to undo it.
  await cancelTokens(myId, ["reset_password"]);

  let signedOut = 0;
  if (signOutOthers) {
    const thisSession = res.locals.sessionId as string;
    const removed = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, myId), ne(sessions.id, thisSession)))
      .returning({ id: sessions.id });
    signedOut = removed.length;
    await disconnectSessions(myId, thisSession);
  }
  await notifyPasswordChanged(myId);
  res.json({ ok: true, signedOut });
});

// POST /account/delete  { password }
// Hides the account and signs out everywhere. It's removed for good after 30 days,
// unless they log in again and choose to restore it.
accountRouter.post("/delete", passwordCheckLimiter, async (req, res) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  const parsed = z.object({ password: z.string().min(1).max(PASSWORD_MAX) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", fields: { password: "Enter your password." } });
    return;
  }
  const myId = me(res).id;
  if (!(await passwordMatches(myId, parsed.data.password))) {
    res.status(400).json({ error: "wrong_password", fields: { password: "That password isn't right." } });
    return;
  }
  const deleteAfter = await scheduleDeletion(myId);
  res.json({ ok: true, deleteAfter: deleteAfter.toISOString() });
});

// ───────────── Where you're signed in ─────────────

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /account/sessions — every device signed in to this account (this one first).
accountRouter.get("/sessions", async (_req, res) => {
  const myId = me(res).id;
  const thisSession = res.locals.sessionId as string;
  const rows = await db
    .select({
      id: sessions.id,
      deviceName: sessions.deviceName,
      persistent: sessions.persistent,
      createdAt: sessions.createdAt,
      lastUsedAt: sessions.lastUsedAt,
      // 0.7.3: which app and version (older apps ignore these)
      platform: sessions.platform,
      appVersion: sessions.appVersion,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, myId), gt(sessions.expiresAt, new Date())))
    .orderBy(desc(sessions.lastUsedAt));
  const online = await connectedSessionIds(myId);
  const list = rows.map((r) => ({
    ...r,
    current: r.id === thisSession,
    // The app is open and connected on that device right now.
    online: online.has(r.id),
  }));
  list.sort((a, b) => Number(b.current) - Number(a.current));
  res.json({ sessions: list });
});

// DELETE /account/sessions/:id — sign one other device out. (This device: use Log out.)
accountRouter.delete("/sessions/:id", async (req, res) => {
  const myId = me(res).id;
  const id = String(req.params.id);
  if (!SESSION_ID.test(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (id === res.locals.sessionId) {
    res.status(400).json({ error: "current_session", message: "To sign out of this device, use Log out." });
    return;
  }
  const removed = await db
    .delete(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, myId)))
    .returning({ id: sessions.id });
  if (!removed.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await disconnectSession(myId, id);
  emitToUser(myId, "account:changed", {});
  res.json({ ok: true });
});

// DELETE /account/sessions — sign out every device except this one.
accountRouter.delete("/sessions", async (_req, res) => {
  const myId = me(res).id;
  const thisSession = res.locals.sessionId as string;
  const removed = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, myId), ne(sessions.id, thisSession)))
    .returning({ id: sessions.id });
  await disconnectSessions(myId, thisSession);
  emitToUser(myId, "account:changed", {});
  res.json({ ok: true, signedOut: removed.length });
});

// ---- 0.7.3 Quiet hours (Settings → Notifications) ----

// GET /account/quiet-hours → { quietHours: QuietHours | null }
accountRouter.get("/quiet-hours", async (_req, res) => {
  const [row] = await db.select({ q: users.quietHours }).from(users).where(eq(users.id, me(res).id));
  res.json({ quietHours: row?.q ?? null });
});

const quietBody = z
  .object({
    from: z.string().refine(isTimeOfDay, "Pick a start time."),
    to: z.string().refine(isTimeOfDay, "Pick an end time."),
    tz: z.string().min(1).max(64).refine(knownTimeZone, "Unknown time zone."),
    calls: z.boolean().default(false),
  })
  .nullable();

function knownTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// PUT /account/quiet-hours  { from: "22:00", to: "08:00", tz, calls } or null (off)
accountRouter.put("/quiet-hours", async (req, res) => {
  const parsed = quietBody.safeParse(req.body?.quietHours ?? null);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Pick the hours." });
    return;
  }
  await db.update(users).set({ quietHours: parsed.data }).where(eq(users.id, me(res).id));
  // Your other devices follow at once (desktop sounds, phone notifications).
  emitToUser(me(res).id, "account:changed", {});
  res.json({ quietHours: parsed.data });
});

import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { requireAuth } from "../auth/sessions";
import { passwordSchema, PASSWORD_MAX } from "../auth/validation";
import { disconnectSessions } from "../realtime";
import { scheduleDeletion } from "./deletion";

// Settings → Account: change password, delete account.
export const accountRouter = Router();
accountRouter.use(requireAuth);

type Me = { id: string; username: string };
const me = (res: Response): Me => res.locals.user as Me;

// Wrong current passwords count against this, so a borrowed computer can't be used to guess.
const passwordCheckLimiter = rateLimit({
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

async function passwordMatches(userId: string, password: string): Promise<boolean> {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return !!row && (await verifyPassword(row.passwordHash, password));
}

// GET /account — the private details only you see on the Account page.
accountRouter.get("/", async (_req, res) => {
  const [row] = await db
    .select({ username: users.username, email: users.email, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, me(res).id));
  res.json(row);
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
  res.json({ ok: true, signedOut });
});

// POST /account/delete  { password }
// Hides the account and signs out everywhere. It's removed for good after 30 days,
// unless they log in again and choose to restore it.
accountRouter.post("/delete", passwordCheckLimiter, async (req, res) => {
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

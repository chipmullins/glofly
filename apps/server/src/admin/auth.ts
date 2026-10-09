import { createHash, randomBytes } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { admins, adminSessions, users } from "../db/schema";
import { redis } from "../redis";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { bearerToken } from "../auth/sessions";
import { verifyTotp } from "./totp";
import { decryptSecret, hashBackupCode, normalizeBackupCode } from "./secrets";
import { logAction, logInBackground } from "./audit";

// Signing in to Control: two steps, every time.
//   1. POST /admin/auth/password  { username, password }  (the admin password, not the Glofly one)
//      → a short-lived "challenge" (5 minutes, 5 tries)
//   2. POST /admin/auth/code      { challenge, code }  (authenticator app) or { challenge, backupCode }
//      → an admin session: 60 minutes, then sign in again. Tied to the network it started on.

export const adminAuthRouter = Router();

export const ADMIN_SESSION_MINUTES = 60;
const CHALLENGE_SECONDS = 5 * 60;
const CHALLENGE_TRIES = 5;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
const challengeKey = (token: string) => `admin:challenge:${hash(token)}`;

// Wrong passwords and wrong codes count separately; right ones don't count at all.
const limiter = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message: "Too many tries. Wait 15 minutes and try again." },
  });
const passwordLimiter = limiter(5);
const codeLimiter = limiter(10);

const deviceNameSchema = z.string().trim().max(60).optional();

let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("glofly-control-timing-placeholder-1"));

const WRONG = { error: "wrong_details", message: "That username or password isn't right." };

type Challenge = { adminId: string; tries: number; deviceName: string | null };

adminAuthRouter.post("/password", passwordLimiter, async (req, res) => {
  const parsed = z
    .object({
      username: z.string().trim().min(1).max(254),
      password: z.string().min(1).max(256),
      deviceName: deviceNameSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Enter your username and admin password." });
    return;
  }
  const { username, password, deviceName } = parsed.data;
  const name = username.replace(/^@/, "").toLowerCase();

  const [row] = await db
    .select({
      adminId: admins.id,
      passwordHash: admins.passwordHash,
      deleteAfter: users.deleteAfter,
      suspendedAt: users.suspendedAt,
      displayName: users.displayName,
      username: users.username,
    })
    .from(admins)
    .innerJoin(users, eq(users.id, admins.userId))
    .where(eq(sql`lower(${users.username})`, name))
    .limit(1);

  const ok = row
    ? await verifyPassword(row.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  if (!row || !ok || row.deleteAfter || row.suspendedAt) {
    logInBackground({
      adminId: row?.adminId ?? null,
      action: "Sign-in refused",
      targetLabel: `@${name}`.slice(0, 40),
      note: "Wrong username or admin password",
      ip: res.locals.adminIp,
    });
    res.status(401).json(WRONG);
    return;
  }

  const challenge = randomBytes(32).toString("base64url");
  const value: Challenge = { adminId: row.adminId, tries: 0, deviceName: deviceName || null };
  await redis.set(challengeKey(challenge), JSON.stringify(value), { EX: CHALLENGE_SECONDS });
  res.json({ challenge, username: row.username, displayName: row.displayName, expiresIn: CHALLENGE_SECONDS });
});

adminAuthRouter.post("/code", codeLimiter, async (req, res) => {
  const parsed = z
    .object({
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      code: z.string().max(20).optional(),
      backupCode: z.string().max(40).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success || (!parsed.data.code && !parsed.data.backupCode)) {
    res.status(400).json({ error: "invalid", message: "Enter the 6-digit code from your authenticator app." });
    return;
  }
  const { challenge, code, backupCode } = parsed.data;
  const key = challengeKey(challenge);
  const raw = await redis.get(key);
  const state = raw ? (JSON.parse(raw) as Challenge) : null;
  if (!state || state.tries >= CHALLENGE_TRIES) {
    await redis.del(key);
    res.status(401).json({ error: "start_over", message: "That took too long or too many tries. Start over." });
    return;
  }

  const [admin] = await db.select().from(admins).where(eq(admins.id, state.adminId)).limit(1);
  if (!admin) {
    await redis.del(key);
    res.status(401).json({ error: "start_over", message: "Start over." });
    return;
  }

  let accepted = false;
  let usedBackup = false;
  if (code) {
    const step = verifyTotp(decryptSecret(admin.totpSecret), code, admin.lastTotpStep);
    if (step !== null) {
      // Only one request can claim a step, so a code can't be used twice even at the same instant.
      const claimed = await db
        .update(admins)
        .set({ lastTotpStep: step })
        .where(and(eq(admins.id, admin.id), lt(admins.lastTotpStep, step)))
        .returning({ id: admins.id });
      accepted = claimed.length === 1;
    }
  } else if (backupCode && normalizeBackupCode(backupCode).length === 10) {
    const codeHash = hashBackupCode(backupCode);
    const claimed = await db
      .update(admins)
      .set({ backupCodes: sql`${admins.backupCodes} - ${codeHash}::text` })
      .where(and(eq(admins.id, admin.id), sql`${admins.backupCodes} ? ${codeHash}::text`))
      .returning({ left: sql<number>`jsonb_array_length(${admins.backupCodes})` });
    accepted = claimed.length === 1;
    usedBackup = accepted;
  }

  if (!accepted) {
    state.tries += 1;
    const ttl = await redis.ttl(key);
    await redis.set(key, JSON.stringify(state), { EX: Math.max(ttl, 1) });
    logInBackground({
      adminId: admin.id,
      action: "Sign-in refused",
      note: backupCode ? "Wrong backup code" : "Wrong authenticator code",
      ip: res.locals.adminIp,
    });
    res.status(401).json({
      error: "wrong_code",
      message: backupCode ? "That backup code isn't right." : "That code isn't right. Check your authenticator app and try again.",
      triesLeft: CHALLENGE_TRIES - state.tries,
    });
    return;
  }

  await redis.del(key);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_MINUTES * 60 * 1000);
  await db.insert(adminSessions).values({
    adminId: admin.id,
    tokenHash: hash(token),
    ip: res.locals.adminIp,
    deviceName: state.deviceName,
    expiresAt,
  });
  // Expired admin sessions are tidied up whenever someone signs in.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));

  const [after] = await db.select({ backupCodes: admins.backupCodes }).from(admins).where(eq(admins.id, admin.id));
  const left = after?.backupCodes.length ?? 0;
  await logAction({
    adminId: admin.id,
    action: "Signed in",
    note: [state.deviceName, usedBackup ? `with a backup code (${left} left)` : null].filter(Boolean).join(" · "),
    ip: res.locals.adminIp,
  });
  res.json({ token, expiresAt: expiresAt.toISOString(), ...(await adminProfile(admin.id)) });
});

async function adminProfile(adminId: string) {
  const [row] = await db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      backupCodes: admins.backupCodes,
    })
    .from(admins)
    .innerJoin(users, eq(users.id, admins.userId))
    .where(eq(admins.id, adminId));
  return {
    admin: { userId: row.userId, username: row.username, displayName: row.displayName, avatarVersion: row.avatarVersion },
    backupCodesLeft: row.backupCodes.length,
  };
}

export type AdminLocals = { id: string; userId: string; username: string; displayName: string };

/** Every Control route after sign-in goes through this. */
export const requireAdmin: RequestHandler = async (req, res, next) => {
  const token = bearerToken(req.headers.authorization);
  if (!token) {
    res.status(401).json({ error: "unauthorized", message: "Sign in to Glofly Control." });
    return;
  }
  const [row] = await db
    .select({
      sessionId: adminSessions.id,
      ip: adminSessions.ip,
      expiresAt: adminSessions.expiresAt,
      adminId: admins.id,
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      deleteAfter: users.deleteAfter,
      suspendedAt: users.suspendedAt,
    })
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .innerJoin(users, eq(users.id, admins.userId))
    .where(and(eq(adminSessions.tokenHash, hash(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  // A session only works from the network it was started on.
  if (!row || row.ip !== res.locals.adminIp || row.deleteAfter || row.suspendedAt) {
    res.status(401).json({ error: "unauthorized", message: "Your Control session ended. Sign in again." });
    return;
  }
  res.locals.admin = {
    id: row.adminId,
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
  } satisfies AdminLocals;
  res.locals.adminSessionId = row.sessionId;
  res.locals.adminExpiresAt = row.expiresAt;
  void db.update(adminSessions).set({ lastUsedAt: new Date() }).where(eq(adminSessions.id, row.sessionId)).catch(() => {});
  next();
};

adminAuthRouter.get("/me", requireAdmin, async (_req, res) => {
  const admin = res.locals.admin as AdminLocals;
  res.json({ expiresAt: (res.locals.adminExpiresAt as Date).toISOString(), ...(await adminProfile(admin.id)) });
});

adminAuthRouter.post("/logout", requireAdmin, async (_req, res) => {
  const admin = res.locals.admin as AdminLocals;
  await db.delete(adminSessions).where(eq(adminSessions.id, res.locals.adminSessionId as string));
  await logAction({ adminId: admin.id, action: "Signed out", ip: res.locals.adminIp });
  res.status(204).end();
});

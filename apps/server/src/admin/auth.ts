import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { rateLimit } from "../rateLimit";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { adminDevices, admins, adminSessions, users } from "../db/schema";
import { redis } from "../redis";
import { hashPassword, verifyPassword } from "../auth/passwords";
import { bearerToken } from "../auth/sessions";
import { verifyTotp } from "./totp";
import { decryptSecret, hashBackupCode, normalizeBackupCode } from "./secrets";
import { logAction, logInBackground } from "./audit";
import { PHONE_SESSION_MINUTES, type SignedDevice } from "./devices";
import { noteRefusedCode, noteSignIn } from "./alerts";

// Signing in to Control: two steps, every time.
//   1. POST /admin/auth/password  { username, password }  (the admin password, not the Glofly one)
//      → a short-lived "challenge" (5 minutes, 5 tries)
//   2. POST /admin/auth/code      { challenge, code }  (authenticator app) or { challenge, backupCode }
//      → an admin session: 60 minutes, then sign in again. Tied to the network it started on.
//   Oct 28, 2026, approved phones only: step 2 with { remember: true } also answers a "remember"
//   secret. POST /admin/auth/resume { remember } (signed with the phone's key, which the phone only
//   unlocks with Face ID) then starts a new phone session without the password and code, for 14
//   days after that sign-in. Signing out on the phone or removing it ends that.

export const adminAuthRouter = Router();

export const ADMIN_SESSION_MINUTES = 60;
const CHALLENGE_SECONDS = 5 * 60;
const CHALLENGE_TRIES = 5;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
const challengeKey = (token: string) => `admin:challenge:${hash(token)}`;

// Wrong passwords and wrong codes count separately; right ones don't count at all.
const limiter = (name: string, limit: number) =>
  rateLimit(name, {
    windowMs: 15 * 60 * 1000,
    limit,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message: "Too many tries. Wait 15 minutes and try again." },
  });
const passwordLimiter = limiter("admin:password", 5);
const codeLimiter = limiter("admin:code", 10);
const resumeLimiter = limiter("admin:resume", 10);

/** How long Face ID can sign a phone back in after a password + code sign-in. */
export const REMEMBER_DAYS = 14;

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
      remember: z.boolean().optional(),
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
    noteRefusedCode(res.locals.adminIp as string);
    res.status(401).json({
      error: "wrong_code",
      message: backupCode ? "That backup code isn't right." : "That code isn't right. Check your authenticator app and try again.",
      triesLeft: CHALLENGE_TRIES - state.tries,
    });
    return;
  }

  await redis.del(key);
  // 0.8.2: on an approved phone the session is shorter and belongs to that phone, not a network.
  const device = res.locals.adminDevice as SignedDevice | undefined;
  if (device && device.adminId !== admin.id) {
    res.status(401).json({ error: "start_over", message: "This phone is approved for someone else." });
    return;
  }
  const session = await startSession(admin.id, device, state.deviceName, res.locals.adminIp as string);

  const [after] = await db.select({ backupCodes: admins.backupCodes }).from(admins).where(eq(admins.id, admin.id));
  const left = after?.backupCodes.length ?? 0;
  const where = device ? `${device.name} (phone)` : state.deviceName;
  await logAction({
    adminId: admin.id,
    action: "Signed in",
    note: [where, usedBackup ? `with a backup code (${left} left)` : null].filter(Boolean).join(" · "),
    ip: res.locals.adminIp,
  });
  noteSignIn({ adminId: admin.id, where: where ?? "Control", ip: res.locals.adminIp as string, backup: usedBackup });
  // Face ID next time (phones only): a fresh secret replaces any older one.
  let remember: { remember: string; rememberUntil: string } | null = null;
  if (device && parsed.data.remember) {
    const secret = randomBytes(32).toString("base64url");
    const until = new Date(Date.now() + REMEMBER_DAYS * 24 * 60 * 60 * 1000);
    await db.update(adminDevices).set({ rememberHash: hash(secret), rememberUntil: until }).where(eq(adminDevices.id, device.id));
    remember = { remember: secret, rememberUntil: until.toISOString() };
  }
  res.json({ ...session, ...(remember ?? {}), ...(await adminProfile(admin.id)) });
});

/** A new admin session: 0.8.2, on an approved phone it's shorter and belongs to that phone. */
async function startSession(
  adminId: string,
  device: SignedDevice | undefined,
  deviceName: string | null,
  ip: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const minutes = device ? PHONE_SESSION_MINUTES : ADMIN_SESSION_MINUTES;
  const expiresAt = new Date(Date.now() + minutes * 60 * 1000);
  await db.insert(adminSessions).values({
    adminId,
    tokenHash: hash(token),
    ip,
    deviceName: device ? device.name : deviceName,
    deviceId: device?.id ?? null,
    expiresAt,
  });
  // Expired admin sessions are tidied up whenever someone signs in.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
  return { token, expiresAt: expiresAt.toISOString() };
}

const REMEMBER_OVER = {
  error: "remember_expired",
  message: "Sign in with your password and code (Face ID sign-in lasts 14 days).",
};

// POST /admin/auth/resume { remember } — Face ID sign-in on an approved phone (see the top).
adminAuthRouter.post("/resume", resumeLimiter, async (req, res) => {
  const device = res.locals.adminDevice as SignedDevice | undefined;
  const parsed = z.object({ remember: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).safeParse(req.body);
  if (!device || !parsed.success) {
    res.status(401).json(REMEMBER_OVER);
    return;
  }
  const [row] = await db
    .select({
      rememberHash: adminDevices.rememberHash,
      rememberUntil: adminDevices.rememberUntil,
      deleteAfter: users.deleteAfter,
      suspendedAt: users.suspendedAt,
    })
    .from(adminDevices)
    .innerJoin(admins, eq(admins.id, adminDevices.adminId))
    .innerJoin(users, eq(users.id, admins.userId))
    .where(and(eq(adminDevices.id, device.id), eq(adminDevices.adminId, device.adminId)));
  const valid =
    row?.rememberHash &&
    row.rememberUntil &&
    row.rememberUntil.getTime() > Date.now() &&
    timingSafeEqual(Buffer.from(row.rememberHash), Buffer.from(hash(parsed.data.remember))) &&
    !row.deleteAfter &&
    !row.suspendedAt;
  if (!valid) {
    if (row?.rememberUntil && row.rememberUntil.getTime() <= Date.now()) {
      await db.update(adminDevices).set({ rememberHash: null, rememberUntil: null }).where(eq(adminDevices.id, device.id));
    }
    res.status(401).json(REMEMBER_OVER);
    return;
  }
  const session = await startSession(device.adminId, device, null, res.locals.adminIp as string);
  const where = `${device.name} (phone)`;
  await logAction({ adminId: device.adminId, action: "Signed in", note: `${where} · Face ID`, ip: res.locals.adminIp });
  noteSignIn({ adminId: device.adminId, where, ip: res.locals.adminIp as string, backup: false });
  res.json({ ...session, rememberUntil: row.rememberUntil!.toISOString(), ...(await adminProfile(device.adminId)) });
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
      deviceId: adminSessions.deviceId,
    })
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .innerJoin(users, eq(users.id, admins.userId))
    .where(and(eq(adminSessions.tokenHash, hash(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  // A session only works from the network it was started on; 0.8.2: a phone's session only with
  // that phone's signature (from anywhere), and a desktop session never from a phone.
  const device = res.locals.adminDevice as SignedDevice | undefined;
  const placeOk = row ? (row.deviceId ? device?.id === row.deviceId : !device && row.ip === res.locals.adminIp) : false;
  if (!row || !placeOk || row.deleteAfter || row.suspendedAt) {
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
  const device = res.locals.adminDevice as SignedDevice | undefined;
  res.json({
    expiresAt: (res.locals.adminExpiresAt as Date).toISOString(),
    device: device ? { id: device.id, name: device.name } : null,
    ...(await adminProfile(admin.id)),
  });
});

adminAuthRouter.post("/logout", requireAdmin, async (_req, res) => {
  const admin = res.locals.admin as AdminLocals;
  await db.delete(adminSessions).where(eq(adminSessions.id, res.locals.adminSessionId as string));
  // Signing out on a phone also ends Face ID sign-in there (the password and code next time).
  const device = res.locals.adminDevice as SignedDevice | undefined;
  if (device) await db.update(adminDevices).set({ rememberHash: null, rememberUntil: null }).where(eq(adminDevices.id, device.id));
  await logAction({ adminId: admin.id, action: "Signed out", ip: res.locals.adminIp });
  res.status(204).end();
});

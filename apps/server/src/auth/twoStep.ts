import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  cleanCode,
  maskPhone,
  phoneE164,
  TWO_STEP_CODE_LENGTH,
  type LoginTwoStep,
  type TwoStepMethod,
  type TwoStepStatus,
} from "@glofly/shared";
import { db } from "../db";
import { twoStepBackupCodes, users } from "../db/schema";
import { redis } from "../redis";
import { sendEmail } from "../email/send";
import { maskEmail, twoStepCodeEmail } from "../email/templates";
import { verifyPassword } from "./passwords";
import { requireAuth } from "./sessions";
import { sendText, smsAvailable } from "./sms";
import { PASSWORD_MAX } from "./validation";

// Two-step sign-in (0.7.3, Chip: "instead of an Authenticator, can we do texts and emails?").
//
// Signing in: the right password for an account with two-step on doesn't sign in yet. A 6-digit
// code goes by text (if a phone is confirmed and texts are set up) or email, and the app answers
// with it (POST /auth/login/code). Codes live 10 minutes in Redis (only a hash), 5 wrong tries end
// the attempt. Ten one-time backup codes (hashed in Postgres) work when neither can be reached.
//
// Older apps don't know any of this: they get a 401 asking to update (they show any 401's message).

const CODE_SECONDS = 10 * 60;
const MAX_TRIES = 5;
const MAX_SENDS = 5;
const RESEND_AFTER_MS = 30 * 1000;
const BACKUP_CODES = 10;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (salt: string, code: string) => sha(`${salt}:${code}`);
const newCode = () => String(randomInt(0, 10 ** TWO_STEP_CODE_LENGTH)).padStart(TWO_STEP_CODE_LENGTH, "0");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type Person = { id: string; email: string; displayName: string; username: string; twoStepPhone: string | null };

async function personById(userId: string): Promise<Person | null> {
  const [p] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      twoStepPhone: users.twoStepPhone,
    })
    .from(users)
    .where(eq(users.id, userId));
  return p ?? null;
}

/** Ways this person can get a code right now (texts first: that's what they set up). */
function methodsFor(p: Person): TwoStepMethod[] {
  return p.twoStepPhone && smsAvailable ? ["sms", "email"] : ["email"];
}

async function deliver(p: Person, method: TwoStepMethod, code: string, purpose: "sign-in" | "setup", phone?: string) {
  if (method === "sms") {
    const to = phone ?? p.twoStepPhone;
    if (!to) throw new Error("no phone");
    await sendText(
      to,
      purpose === "sign-in"
        ? `${code} is your Glofly sign-in code. It works for 10 minutes. Don't share it with anyone.`
        : `${code} is your Glofly code to turn on two-step sign-in. Don't share it with anyone.`,
    );
  } else {
    await sendEmail(twoStepCodeEmail(p, code, purpose));
  }
}

const sentTo = (p: Person, method: TwoStepMethod, phone?: string) =>
  method === "sms" ? maskPhone(phone ?? p.twoStepPhone ?? "") : maskEmail(p.email);

// ---------------------------------------------------------------------------------------------
// Signing in

/** What finishing the sign-in needs (the same as the password step had). */
export type PendingLogin = {
  keepSignedIn: boolean;
  deviceName: string | null;
  appVersion: string | null;
  platform: string | null;
  web: "web" | null;
};

type Challenge = {
  userId: string;
  hash: string;
  salt: string;
  method: TwoStepMethod;
  tries: number;
  sends: number;
  sentAt: number;
  login: PendingLogin;
};

const challengeKey = (id: string) => `twostep:login:${id}`;

async function saveChallenge(id: string, c: Challenge, keepTtl = false) {
  await redis.set(challengeKey(id), JSON.stringify(c), keepTtl ? { KEEPTTL: true } : { EX: CODE_SECONDS });
}
async function loadChallenge(id: string): Promise<Challenge | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return null;
  const raw = await redis.get(challengeKey(id));
  return raw ? (JSON.parse(raw) as Challenge) : null;
}

export const TWO_STEP_NEEDS_UPDATE = {
  error: "two_step_update",
  message: "Your account uses two-step sign-in. Update Glofly to sign in.",
};

export const CODE_NOT_SENT = {
  error: "code_not_sent",
  message: "We couldn't send your code right now. Try again in a minute.",
};

/** The password was right and two-step is on: sends a code and returns what the app shows. */
export async function startLoginChallenge(userId: string, login: PendingLogin): Promise<LoginTwoStep | null> {
  const p = await personById(userId);
  if (!p) return null;
  const methods = methodsFor(p);
  const method = methods[0];
  const id = randomBytes(24).toString("base64url");
  const salt = randomBytes(8).toString("hex");
  const code = newCode();
  await deliver(p, method, code, "sign-in"); // throws if it can't be sent: nothing saved
  await saveChallenge(id, { userId, hash: codeHash(salt, code), salt, method, tries: 0, sends: 1, sentAt: Date.now(), login });
  return { twoStep: { challenge: id, method, sentTo: sentTo(p, method), alternatives: methods.filter((m) => m !== method) } };
}

/** Sends a new code (optionally the other way). */
export async function resendLoginCode(
  id: string,
  method: TwoStepMethod | undefined,
): Promise<{ ok: true; result: LoginTwoStep } | { ok: false; status: number; error: string; message: string }> {
  const c = await loadChallenge(id);
  if (!c) return { ok: false, status: 410, error: "expired", message: "That took too long. Sign in again." };
  const p = await personById(c.userId);
  if (!p) return { ok: false, status: 410, error: "expired", message: "That took too long. Sign in again." };
  const methods = methodsFor(p);
  const use = method && methods.includes(method) ? method : c.method;
  if (c.sends >= MAX_SENDS) return { ok: false, status: 429, error: "too_many_requests", message: "That's a lot of codes. Sign in again in a few minutes." };
  if (Date.now() - c.sentAt < RESEND_AFTER_MS && use === c.method)
    return { ok: false, status: 429, error: "too_many_requests", message: "Wait a few seconds before asking for another code." };
  const code = newCode();
  try {
    await deliver(p, use, code, "sign-in");
  } catch (err) {
    console.error("Two-step code couldn't be sent", err);
    return { ok: false, status: 502, ...CODE_NOT_SENT };
  }
  await saveChallenge(id, { ...c, hash: codeHash(c.salt, code), method: use, sends: c.sends + 1, sentAt: Date.now() }, true);
  return { ok: true, result: { twoStep: { challenge: id, method: use, sentTo: sentTo(p, use), alternatives: methods.filter((m) => m !== use) } } };
}

/** Checks a sign-in code (or a backup code). Right: the challenge is used up and the sign-in goes ahead. */
export async function checkLoginCode(
  id: string,
  typed: string,
): Promise<{ ok: true; userId: string; login: PendingLogin; usedBackup: boolean } | { ok: false; status: number; error: string; message: string }> {
  const c = await loadChallenge(id);
  if (!c) return { ok: false, status: 410, error: "expired", message: "That took too long. Sign in again." };
  const code = cleanCode(typed);
  let right = false;
  let usedBackup = false;
  if (code.length === TWO_STEP_CODE_LENGTH && /^\d+$/.test(code)) right = sameHash(codeHash(c.salt, code), c.hash);
  else if (code.length >= 8) {
    usedBackup = right = await useBackupCode(c.userId, code);
  }
  if (!right) {
    const tries = c.tries + 1;
    if (tries >= MAX_TRIES) {
      await redis.del(challengeKey(id));
      return { ok: false, status: 401, error: "expired", message: "Too many wrong codes. Sign in again." };
    }
    await saveChallenge(id, { ...c, tries }, true);
    return { ok: false, status: 401, error: "wrong_code", message: "That code isn't right. Check it and try again." };
  }
  // Used once: a second try with the same code fails.
  const gone = await redis.del(challengeKey(id));
  if (!gone) return { ok: false, status: 410, error: "expired", message: "That took too long. Sign in again." };
  return { ok: true, userId: c.userId, login: c.login, usedBackup };
}

// ---------------------------------------------------------------------------------------------
// Backup codes

async function useBackupCode(userId: string, typed: string): Promise<boolean> {
  const code = typed.replace(/-/g, "").toLowerCase();
  const rows = await db
    .select({ id: twoStepBackupCodes.id, codeHash: twoStepBackupCodes.codeHash })
    .from(twoStepBackupCodes)
    .where(and(eq(twoStepBackupCodes.userId, userId), isNull(twoStepBackupCodes.usedAt)));
  const want = sha(`backup:${userId}:${code}`);
  const hit = rows.find((r) => sameHash(r.codeHash, want));
  if (!hit) return false;
  const used = await db
    .update(twoStepBackupCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(twoStepBackupCodes.id, hit.id), isNull(twoStepBackupCodes.usedAt)))
    .returning({ id: twoStepBackupCodes.id });
  return used.length === 1;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o, 1/l/i

/** A new set of backup codes (the old ones stop working). Shown once. */
async function newBackupCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: BACKUP_CODES }, () => {
    const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(0, ALPHABET.length)]).join("");
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
  await db.transaction(async (tx) => {
    await tx.delete(twoStepBackupCodes).where(eq(twoStepBackupCodes.userId, userId));
    await tx.insert(twoStepBackupCodes).values(codes.map((c) => ({ userId, codeHash: sha(`backup:${userId}:${c.replace(/-/g, "")}`) })));
  });
  return codes;
}

// ---------------------------------------------------------------------------------------------
// Settings → Account → Two-step sign-in

export const twoStepRouter = Router();
twoStepRouter.use(requireAuth);

const me = (res: Response) => (res.locals.user as { id: string }).id;

const settingsLimiter = rateLimit("two-step:settings", {
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: (_req, res) => me(res),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many tries. Wait a few minutes and try again." },
});

async function status(userId: string): Promise<TwoStepStatus> {
  const [u] = await db
    .select({ twoStep: users.twoStep, email: users.email, phone: users.twoStepPhone, verified: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId));
  const left = await db.$count(twoStepBackupCodes, and(eq(twoStepBackupCodes.userId, userId), isNull(twoStepBackupCodes.usedAt)));
  return {
    enabled: u.twoStep,
    email: maskEmail(u.email),
    phone: u.phone ? maskPhone(u.phone) : null,
    smsAvailable,
    backupCodesLeft: u.twoStep ? left : 0,
    emailVerified: !!u.verified,
  };
}

async function passwordOk(userId: string, password: unknown): Promise<boolean> {
  if (typeof password !== "string" || !password || password.length > PASSWORD_MAX) return false;
  const [row] = await db.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId));
  return !!row && (await verifyPassword(row.h, password));
}
const WRONG_PASSWORD = { error: "wrong_password", message: "That isn't your current password." };

// GET /account/two-step
twoStepRouter.get("/", async (_req, res) => {
  res.json(await status(me(res)));
});

type Setup = { method: TwoStepMethod; phone: string | null; hash: string; salt: string; tries: number };
const setupKey = (userId: string) => `twostep:setup:${userId}`;

// POST /account/two-step/start  { method: "email" | "sms", phone?, password }
// Sends a code to prove the email (or the phone) gets it. Turning it on, or adding a phone.
twoStepRouter.post("/start", settingsLimiter, async (req, res) => {
  const userId = me(res);
  const parsed = z.object({ method: z.enum(["email", "sms"]), phone: z.string().max(40).optional(), password: z.string() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Pick email or a phone number." });
    return;
  }
  if (!(await passwordOk(userId, parsed.data.password))) {
    res.status(401).json(WRONG_PASSWORD);
    return;
  }
  const p = await personById(userId);
  const s = await status(userId);
  if (!p) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!s.emailVerified) {
    res.status(400).json({ error: "email_unverified", message: "Confirm your email first (Settings → Account), so codes can reach you." });
    return;
  }
  let phone: string | null = null;
  if (parsed.data.method === "sms") {
    if (!smsAvailable) {
      res.status(400).json({ error: "sms_unavailable", message: "Codes by text aren't available yet. Use email for now." });
      return;
    }
    phone = phoneE164(parsed.data.phone ?? "");
    if (!phone) {
      res.status(400).json({ error: "invalid", message: "Enter a mobile number, like (502) 555-0123." });
      return;
    }
  }
  const code = newCode();
  try {
    await deliver(p, parsed.data.method, code, "setup", phone ?? undefined);
  } catch (err) {
    console.error("Two-step setup code couldn't be sent", err);
    res.status(502).json(CODE_NOT_SENT);
    return;
  }
  const salt = randomBytes(8).toString("hex");
  const setup: Setup = { method: parsed.data.method, phone, hash: codeHash(salt, code), salt, tries: 0 };
  await redis.set(setupKey(userId), JSON.stringify(setup), { EX: CODE_SECONDS });
  res.json({ sentTo: sentTo(p, parsed.data.method, phone ?? undefined) });
});

// POST /account/two-step/confirm  { code }
// The right code: two-step is on (with that phone, if it was a phone). The first time, the answer
// has the backup codes (shown once).
twoStepRouter.post("/confirm", settingsLimiter, async (req, res) => {
  const userId = me(res);
  const raw = await redis.get(setupKey(userId));
  if (!raw) {
    res.status(410).json({ error: "expired", message: "That code has run out. Send a new one." });
    return;
  }
  const setup = JSON.parse(raw) as Setup;
  const code = cleanCode(String(req.body?.code ?? ""));
  if (!sameHash(codeHash(setup.salt, code), setup.hash)) {
    if (setup.tries + 1 >= MAX_TRIES) await redis.del(setupKey(userId));
    else await redis.set(setupKey(userId), JSON.stringify({ ...setup, tries: setup.tries + 1 }), { KEEPTTL: true });
    res.status(400).json({ error: "wrong_code", message: "That code isn't right. Check it and try again." });
    return;
  }
  await redis.del(setupKey(userId));
  const before = await status(userId);
  await db
    .update(users)
    .set({ twoStep: true, ...(setup.method === "sms" ? { twoStepPhone: setup.phone } : {}) })
    .where(eq(users.id, userId));
  const backupCodes = before.enabled && before.backupCodesLeft > 0 ? null : await newBackupCodes(userId);
  res.json({ status: await status(userId), backupCodes });
});

// POST /account/two-step/off  { password }
twoStepRouter.post("/off", settingsLimiter, async (req, res) => {
  const userId = me(res);
  if (!(await passwordOk(userId, req.body?.password))) {
    res.status(401).json(WRONG_PASSWORD);
    return;
  }
  await db.update(users).set({ twoStep: false, twoStepPhone: null }).where(eq(users.id, userId));
  await db.delete(twoStepBackupCodes).where(eq(twoStepBackupCodes.userId, userId));
  res.json(await status(userId));
});

// POST /account/two-step/remove-phone  { password }: codes go by email only again
twoStepRouter.post("/remove-phone", settingsLimiter, async (req, res) => {
  const userId = me(res);
  if (!(await passwordOk(userId, req.body?.password))) {
    res.status(401).json(WRONG_PASSWORD);
    return;
  }
  await db.update(users).set({ twoStepPhone: null }).where(eq(users.id, userId));
  res.json(await status(userId));
});

// POST /account/two-step/backup-codes  { password }: a new set (the old ones stop working)
twoStepRouter.post("/backup-codes", settingsLimiter, async (req, res) => {
  const userId = me(res);
  if (!(await passwordOk(userId, req.body?.password))) {
    res.status(401).json(WRONG_PASSWORD);
    return;
  }
  const s = await status(userId);
  if (!s.enabled) {
    res.status(400).json({ error: "invalid", message: "Turn on two-step sign-in first." });
    return;
  }
  res.json({ backupCodes: await newBackupCodes(userId), status: await status(userId) });
});

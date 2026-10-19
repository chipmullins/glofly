import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { redis } from "../redis";
import { requireCurrentApp } from "../app-version";
import { users } from "../db/schema";
import { hashPassword, verifyPassword } from "./passwords";
import { cancelDeletion } from "../account/deletion";
import { requestPasswordReset, sendVerification } from "../account/email";
import {
  appVersionFrom,
  createSession,
  deleteSession,
  platformColumn,
  renewedExpiry,
  requireAuth,
  sessionFor,
} from "./sessions";
import {
  clearSessionCookie,
  cookieRequestAllowed,
  csrfFor,
  fromWebOrigin,
  saysWeb,
  setSessionCookie,
  webEnabled,
} from "../web/session";
import {
  claimInviteCode,
  emailHeldByInvite,
  getSignupMode,
  looksLikeInviteCode,
  normalizeInviteCode,
  recordInviteUse,
  usernameHeldByInvite,
} from "../admin/signups";
import { finishSignIn, signedIn } from "./finish";
import { noteSignIn } from "./signInAlert";
import {
  checkLoginCode,
  CODE_NOT_SENT,
  resendLoginCode,
  startLoginChallenge,
  TWO_STEP_NEEDS_UPDATE,
  type PendingLogin,
} from "./twoStep";
import { inBackground } from "../push/notify";
import { fieldErrors, forgotPasswordSchema, loginSchema, registerSchema, usernameSchema } from "./validation";

export const authRouter = Router();

// Limits slow down bots that try to mass-create accounts or scan usernames.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many sign-up attempts. Try again later." },
});

const usernameCheckLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

// Only failed attempts count, so a typo-prone person isn't locked out after logging in fine.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "too_many_requests",
    message: "Too many login attempts. Wait a few minutes and try again.",
  },
});

const lower = (column: typeof users.username | typeof users.email) => sql`lower(${column})`;

/** Which unique rule a Postgres "duplicate value" error broke, if any. */
function duplicateField(err: unknown): "username" | "email" | null {
  const e = err as { code?: string; constraint?: string; cause?: unknown };
  const pgError = (e?.code ? e : e?.cause) as { code?: string; constraint?: string } | undefined;
  if (pgError?.code !== "23505") return null;
  if (pgError.constraint === "users_username_lower_idx") return "username";
  if (pgError.constraint === "users_email_lower_idx") return "email";
  return null;
}

const TAKEN = {
  username: "That username is taken.",
  email: "An account with this email already exists.",
} as const;

/**
 * The web app (X-Glofly-Platform: web) signs in with a cookie instead of a token. Only from its
 * own page, and only when the web app is on: anything else saying "web" is refused. Returns
 * null for the apps, "web" for the web app, or false after answering 403.
 */
function webSignIn(req: Request, res: Response): "web" | null | false {
  if (!saysWeb(req)) return null;
  if (!webEnabled || !fromWebOrigin(req.headers)) {
    res.status(403).json({ error: "forbidden", message: "Glofly in a browser only works at its own address." });
    return false;
  }
  return "web";
}

// GET /auth/username-available?username=chipm
// Powers the live "Available" check on the register screen.
authRouter.get("/username-available", usernameCheckLimiter, async (req, res) => {
  const parsed = usernameSchema.safeParse(req.query.username);
  if (!parsed.success) {
    res.json({ available: false, reason: parsed.error.issues[0].message });
    return;
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(lower(users.username), parsed.data.toLowerCase()))
    .limit(1);

  const taken = existing.length > 0 || (await usernameHeldByInvite(parsed.data));
  res.json(taken ? { available: false, reason: TAKEN.username } : { available: true });
});

// GET /auth/signups — who can sign up right now (Control → Sign-ups), so the register
// screen can ask for an invite code, or say sign-ups are closed, before anyone fills it in.
authRouter.get("/signups", usernameCheckLimiter, async (_req, res) => {
  res.json({ mode: await getSignupMode() });
});

const SIGNUPS_CLOSED = "Glofly isn't taking new sign-ups right now.";
const BAD_INVITE_CODE = "That invite code doesn't work. Check it, or ask for a new one.";

// POST /auth/register
// Body: { email, username, displayName, password, birthday: "YYYY-MM-DD", acceptTerms: true, deviceName? }
// Returns a session token too, so the new account is signed in right away.
authRouter.post("/register", requireCurrentApp, registerLimiter, async (req, res) => {
  const web = webSignIn(req, res);
  if (web === false) return;
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", fields: fieldErrors(parsed.error) });
    return;
  }
  const input = parsed.data;

  const mode = await getSignupMode();
  if (mode === "closed") {
    res.status(403).json({ error: "signups_closed", message: SIGNUPS_CLOSED, fields: { form: SIGNUPS_CLOSED } });
    return;
  }
  const inviteCode = mode === "invite" ? normalizeInviteCode(input.inviteCode ?? "") : null;
  if (inviteCode !== null && !looksLikeInviteCode(inviteCode)) {
    const message = input.inviteCode ? BAD_INVITE_CODE : "Enter your invite code.";
    res.status(400).json({ error: "invalid", fields: { inviteCode: message } });
    return;
  }

  // Check both at once so the screen can show every problem together.
  const clashes = await db
    .select({ username: users.username, email: users.email })
    .from(users)
    .where(
      or(
        eq(lower(users.username), input.username.toLowerCase()),
        eq(lower(users.email), input.email.toLowerCase()),
      ),
    );
  const fields: Record<string, string> = {};
  for (const row of clashes) {
    if (row.username.toLowerCase() === input.username.toLowerCase()) fields.username = TAKEN.username;
    if (row.email.toLowerCase() === input.email.toLowerCase()) fields.email = TAKEN.email;
  }
  // Usernames and emails held for someone who was invited (Control → Create account).
  if (!fields.username && (await usernameHeldByInvite(input.username))) fields.username = TAKEN.username;
  if (!fields.email && (await emailHeldByInvite(input.email))) fields.email = TAKEN.email;
  if (Object.keys(fields).length) {
    res.status(409).json({ error: "taken", fields });
    return;
  }

  const passwordHash = await hashPassword(input.password);

  try {
    // The invite code (if needed) and the account are made together: a used-up code makes no account.
    const user = await db.transaction(async (tx) => {
      const codeId = inviteCode ? await claimInviteCode(tx, inviteCode) : null;
      if (inviteCode && !codeId) return null;
      const [created] = await tx
        .insert(users)
        .values({
          email: input.email,
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          birthday: input.birthday,
          termsAcceptedAt: new Date(),
        })
        .returning({
          id: users.id,
          username: users.username,
          displayName: users.displayName,
          avatarVersion: users.avatarVersion,
        });
      if (codeId) await recordInviteUse(tx, codeId, created.id);
      return created;
    });
    if (!user) {
      res.status(400).json({ error: "invalid", fields: { inviteCode: BAD_INVITE_CODE } });
      return;
    }

    // Sign the new account straight in on this device ("Keep me signed in" on, like most
    // desktop messengers). They can log out from the settings menu.
    const session = await createSession(
      user.id,
      true,
      input.deviceName ?? null,
      appVersionFrom(req.headers["x-glofly-version"]),
      web ?? platformColumn(req.headers["x-glofly-platform"]),
    );
    // "Confirm your email": sent in the background so signing up stays quick.
    sendVerification(user.id).catch((err) => console.error("Couldn't send the confirm email", err));
    signedIn(res, web, session, true, user, 201);
    inBackground(noteSignIn(user.id, input.deviceName ?? null, web ?? platformColumn(req.headers["x-glofly-platform"])));
  } catch (err) {
    // Two people grabbing the same name at the same instant: the database still catches it.
    const field = duplicateField(err);
    if (field) {
      res.status(409).json({ error: "taken", fields: { [field]: TAKEN[field] } });
      return;
    }
    throw err;
  }
});

// Checked when nobody has the typed username, so a wrong username takes as long
// as a wrong password. Otherwise timing would reveal which usernames exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("glofly-timing-placeholder-1"));

const WRONG_DETAILS = "That username or password isn't right.";

// POST /auth/login
// Body: { identifier: username or email, password, keepSignedIn, deviceName? }
authRouter.post("/login", requireCurrentApp, loginLimiter, async (req, res) => {
  const web = webSignIn(req, res);
  if (web === false) return;
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Enter your username or email and password." });
    return;
  }
  const { identifier, password, keepSignedIn, deviceName, restore, twoStepAware } = parsed.data;

  const column = identifier.includes("@") ? users.email : users.username;
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      passwordHash: users.passwordHash,
      deleteAfter: users.deleteAfter,
      suspendedAt: users.suspendedAt,
      suspendReason: users.suspendReason,
      restricted: users.restricted,
      twoStep: users.twoStep,
    })
    .from(users)
    .where(eq(lower(column), identifier.toLowerCase()))
    .limit(1);

  const passwordOk = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  // An account whose 30 days have run out is about to be removed: it's gone.
  const removed = !!user?.deleteAfter && user.deleteAfter.getTime() <= Date.now();
  if (!user || !passwordOk || removed) {
    // Same message either way, so nobody can test which accounts exist.
    res.status(401).json({ error: "wrong_details", message: WRONG_DETAILS });
    return;
  }

  // Suspended in Control: only the right password gets this far, so it's safe to say why.
  // 401 so older app versions show this message too (they show the message of any 401).
  if (user.suspendedAt) {
    res.status(401).json({
      error: "suspended",
      message: user.suspendReason
        ? `Your Glofly account is suspended: ${user.suspendReason}`
        : "Your Glofly account is suspended.",
      reason: user.suspendReason,
    });
    return;
  }

  // Set to be deleted: only the right password gets this far, so it's safe to say so.
  if (user.deleteAfter) {
    if (!restore) {
      res.status(403).json({
        error: "deletion_scheduled",
        deleteAfter: user.deleteAfter.toISOString(),
        message: "This account is set to be deleted.",
      });
      return;
    }
  }

  const login: PendingLogin = {
    keepSignedIn,
    deviceName: deviceName ?? null,
    appVersion: appVersionFrom(req.headers["x-glofly-version"]),
    platform: web ?? platformColumn(req.headers["x-glofly-platform"]),
    web,
  };

  // 0.7.3 two-step sign-in: the password was right, now a code (sent by text or email).
  if (user.twoStep) {
    if (!twoStepAware) {
      res.status(401).json(TWO_STEP_NEEDS_UPDATE);
      return;
    }
    try {
      const challenge = await startLoginChallenge(user.id, login);
      if (!challenge) {
        res.status(401).json({ error: "wrong_details", message: WRONG_DETAILS });
        return;
      }
      // Restoring an account set to be deleted happens once the code is right.
      if (user.deleteAfter && restore) await redis.set(`twostep:restore:${challenge.twoStep.challenge}`, "1", { EX: 600 });
      res.json(challenge);
    } catch (err) {
      console.error("Two-step code couldn't be sent", err);
      res.status(502).json(CODE_NOT_SENT);
    }
    return;
  }

  if (user.deleteAfter) await cancelDeletion(user.id);
  await finishSignIn(res, user.id, login);
});

// POST /auth/login/code  { challenge, code }: the code from the text or email (or a backup code).
authRouter.post("/login/code", requireCurrentApp, loginLimiter, async (req, res) => {
  const web = webSignIn(req, res);
  if (web === false) return;
  const challenge = String(req.body?.challenge ?? "");
  const r = await checkLoginCode(challenge, String(req.body?.code ?? ""));
  if (!r.ok) {
    res.status(r.status).json({ error: r.error, message: r.message });
    return;
  }
  // The same kind of app that typed the password (a code from the browser can't sign in an app).
  if (r.login.web !== web) {
    res.status(403).json({ error: "forbidden", message: "Sign in again." });
    return;
  }
  const [u] = await db.select({ deleteAfter: users.deleteAfter, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, r.userId));
  if (!u || u.suspendedAt) {
    res.status(401).json({ error: "wrong_details", message: WRONG_DETAILS });
    return;
  }
  if (u.deleteAfter) {
    if (!(await redis.getDel(`twostep:restore:${challenge}`))) {
      res.status(403).json({ error: "deletion_scheduled", deleteAfter: u.deleteAfter.toISOString(), message: "This account is set to be deleted." });
      return;
    }
    await cancelDeletion(r.userId);
  }
  await finishSignIn(res, r.userId, r.login);
});

// POST /auth/login/resend  { challenge, method? }: another code, or the other way ("by email instead").
authRouter.post("/login/resend", requireCurrentApp, loginLimiter, async (req, res) => {
  const method = req.body?.method === "sms" || req.body?.method === "email" ? (req.body.method as "sms" | "email") : undefined;
  const r = await resendLoginCode(String(req.body?.challenge ?? ""), method);
  if (!r.ok) {
    res.status(r.status).json({ error: r.error, message: r.message });
    return;
  }
  res.json(r.result);
});

// Forgot password: a handful per IP. Each account also gets at most a few reset emails an hour.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many tries. Wait a few minutes and try again." },
});

// POST /auth/forgot-password  { identifier: username or email }
// Always the same answer, sent before any lookup happens, so neither the reply nor how long it
// takes says whether an account exists. The email goes out in the background.
authRouter.post("/forgot-password", forgotLimiter, (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Enter your username or email." });
    return;
  }
  res.json({ ok: true });
  requestPasswordReset(parsed.data.identifier).catch((err) =>
    console.error("Forgot password failed", err),
  );
});

// GET /auth/me — who is this token signed in as?
authRouter.get("/me", requireAuth, async (_req, res) => {
  const me = res.locals.user as { id: string };
  const [row] = await db.select({ restricted: users.restricted }).from(users).where(eq(users.id, me.id));
  // 0.4.0: a family-managed account (the apps hide Add friend). Older apps ignore it.
  const user = { ...res.locals.user, ...(row?.restricted ? { restricted: true } : {}) };
  // The web app: its CSRF value (it can't read the cookie), and the cookie renewed like the session.
  if (res.locals.viaCookie) {
    const token = res.locals.sessionToken as string;
    if (res.locals.persistent) setSessionCookie(res, token, true, renewedExpiry());
    res.set("Cache-Control", "no-store");
    res.json({ user, csrf: csrfFor(token) });
    return;
  }
  res.json({ user });
});

// POST /auth/logout — signs this device out.
authRouter.post("/logout", async (req, res) => {
  const { token, viaCookie } = await sessionFor(req);
  if (viaCookie) {
    // The browser: from the web app's page only (with its CSRF value), and the cookie goes too.
    if (!cookieRequestAllowed(req, res, token!)) return;
    clearSessionCookie(res);
  }
  if (token) await deleteSession(token);
  res.status(204).end();
});

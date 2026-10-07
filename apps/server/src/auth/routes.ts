import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { hashPassword, verifyPassword } from "./passwords";
import { bearerToken, createSession, deleteSession, requireAuth } from "./sessions";
import { fieldErrors, loginSchema, registerSchema, usernameSchema } from "./validation";

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

  res.json(existing.length ? { available: false, reason: TAKEN.username } : { available: true });
});

// POST /auth/register
// Body: { email, username, displayName, password, birthday: "YYYY-MM-DD", acceptTerms: true, deviceName? }
// Returns a session token too, so the new account is signed in right away.
authRouter.post("/register", registerLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", fields: fieldErrors(parsed.error) });
    return;
  }
  const input = parsed.data;

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
  if (Object.keys(fields).length) {
    res.status(409).json({ error: "taken", fields });
    return;
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const [user] = await db
      .insert(users)
      .values({
        email: input.email,
        username: input.username,
        displayName: input.displayName,
        passwordHash,
        birthday: input.birthday,
        termsAcceptedAt: new Date(),
      })
      .returning({ id: users.id, username: users.username, displayName: users.displayName });

    // Sign the new account straight in on this device ("Keep me signed in" on, like most
    // desktop messengers). They can log out from the settings menu.
    const session = await createSession(user.id, true, input.deviceName ?? null);
    res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user,
    });
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
authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Enter your username or email and password." });
    return;
  }
  const { identifier, password, keepSignedIn, deviceName } = parsed.data;

  const column = identifier.includes("@") ? users.email : users.username;
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(lower(column), identifier.toLowerCase()))
    .limit(1);

  const passwordOk = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  if (!user || !passwordOk) {
    // Same message either way, so nobody can test which accounts exist.
    res.status(401).json({ error: "wrong_details", message: WRONG_DETAILS });
    return;
  }

  const session = await createSession(user.id, keepSignedIn, deviceName ?? null);
  res.json({
    token: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: { id: user.id, username: user.username, displayName: user.displayName },
  });
});

// GET /auth/me — who is this token signed in as?
authRouter.get("/me", requireAuth, (_req, res) => {
  res.json({ user: res.locals.user });
});

// POST /auth/logout — signs this device out.
authRouter.post("/logout", async (req, res) => {
  const token = bearerToken(req.headers.authorization);
  if (token) await deleteSession(token);
  res.status(204).end();
});

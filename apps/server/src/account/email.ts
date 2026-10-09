import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { sessions, users } from "../db/schema";
import { hashPassword } from "../auth/passwords";
import { disconnectSessions, emitToUser } from "../realtime";
import { sendInBackground, sendNow } from "../email/send";
import {
  changeEmailConfirm,
  changeEmailRequested,
  emailChangedNotice,
  passwordChangedNotice,
  resetPasswordEmail,
  SITE_URL,
  verifyEmail,
} from "../email/templates";
import { cancelTokens, consumeToken, discardToken, type EmailToken, issueToken, sentRecently } from "../email/tokens";

// Everything email-related about an account: Forgot password, confirming the email,
// and changing it. The routes (auth/routes.ts, account/routes.ts) and the pages people
// open from emails (web/pages.ts) all come through here.

const HOUR = 60 * 60 * 1000;

const linkFor = (path: "reset" | "confirm", token: string): string => `${SITE_URL}/${path}?t=${token}`;

const lowerEmail = sql`lower(${users.email})`;

type Person = { id: string; email: string; displayName: string; username: string };

async function person(
  userId: string,
): Promise<(Person & { deleteAfter: Date | null; emailVerifiedAt: Date | null }) | null> {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      deleteAfter: users.deleteAfter,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

/** Tells this person's devices to refresh their account details (Settings, the reminder). */
const announceAccount = (userId: string): void => emitToUser(userId, "account:changed", {});

// ───────────── Confirming the email ─────────────

/**
 * Sends the "Confirm your email" link to the address on the account. With wait, it waits for
 * Amazon's answer and returns whether the email went out (a link that didn't is thrown away).
 */
export async function sendVerification(userId: string, wait = false): Promise<boolean> {
  const user = await person(userId);
  if (!user || user.emailVerifiedAt) return true;
  const token = await issueToken(user.id, "verify_email", user.email);
  const email = verifyEmail(user, linkFor("confirm", token));
  if (!wait) {
    sendInBackground(email);
    return true;
  }
  if (await sendNow(email)) return true;
  await discardToken(token);
  return false;
}

export const VERIFY_RESENDS_PER_HOUR = 3;

/** Settings → Account / the reminder: "Resend link". */
export async function resendVerification(
  userId: string,
): Promise<"sent" | "already_verified" | "too_many" | "send_failed"> {
  const user = await person(userId);
  if (!user || user.emailVerifiedAt) return "already_verified";
  if ((await sentRecently(userId, "verify_email", HOUR)) >= VERIFY_RESENDS_PER_HOUR) return "too_many";
  return (await sendVerification(userId, true)) ? "sent" : "send_failed";
}

// ───────────── Forgot password ─────────────

export const RESETS_PER_HOUR = 3;

/**
 * Forgot password: emails a reset link if the username or email belongs to an account.
 * The caller always answers the same way, so this never reveals whether an account exists.
 */
export async function requestPasswordReset(identifier: string): Promise<void> {
  const column = identifier.includes("@") ? users.email : users.username;
  const [found] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${column})`, identifier.toLowerCase()))
    .limit(1);
  if (!found) return;
  const user = await person(found.id);
  // Removed for good soon (its 30 days are up): nothing to reset. Still in the 30 days: allowed,
  // so they can log in with the new password and restore it.
  if (!user || (user.deleteAfter && user.deleteAfter.getTime() <= Date.now())) return;
  if ((await sentRecently(user.id, "reset_password", HOUR)) >= RESETS_PER_HOUR) return;
  const token = await issueToken(user.id, "reset_password", user.email);
  sendInBackground(resetPasswordEmail(user, linkFor("reset", token)));
}

/**
 * Uses a reset link: new password, every device signed out. A reset link also proves they
 * own the email it was sent to, so that address counts as confirmed.
 */
export async function resetPassword(link: EmailToken, newPassword: string): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);
  if (!(await consumeToken(link.id))) return false;
  const user = await person(link.userId);
  if (!user) return false;

  const confirmsEmail = !user.emailVerifiedAt && user.email.toLowerCase() === link.email.toLowerCase();
  await db
    .update(users)
    .set({ passwordHash, ...(confirmsEmail ? { emailVerifiedAt: new Date() } : {}) })
    .where(eq(users.id, user.id));
  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await disconnectSessions(user.id);
  await cancelTokens(user.id, ["reset_password"]);
  sendInBackground(passwordChangedNotice(user));
  return true;
}

/** Changing the password in Settings → Account also gets a heads-up email. */
export async function notifyPasswordChanged(userId: string): Promise<void> {
  const user = await person(userId);
  if (user) sendInBackground(passwordChangedNotice(user));
}

// ───────────── Changing the email ─────────────

export const EMAIL_CHANGES_PER_HOUR = 5;

export type ChangeRequest = "sent" | "same" | "taken" | "too_many" | "send_failed";

/** Settings → Account → Change email: sends a confirm link to the new address. */
export async function requestEmailChange(userId: string, newEmail: string): Promise<ChangeRequest> {
  const user = await person(userId);
  if (!user) return "too_many";
  if (user.email.toLowerCase() === newEmail.toLowerCase()) return "same";
  if (await emailInUse(newEmail, userId)) return "taken";
  if ((await sentRecently(userId, "change_email", HOUR)) >= EMAIL_CHANGES_PER_HOUR) return "too_many";

  const token = await issueToken(userId, "change_email", newEmail);
  // Wait for this one: if the new address can't be emailed, there's no change to wait for.
  if (!(await sendNow(changeEmailConfirm(user, newEmail, linkFor("confirm", token))))) {
    await discardToken(token);
    return "send_failed";
  }
  sendInBackground(changeEmailRequested(user, newEmail));
  announceAccount(userId);
  return "sent";
}

export async function cancelEmailChange(userId: string): Promise<void> {
  await cancelTokens(userId, ["change_email"]);
  announceAccount(userId);
}

async function emailInUse(email: string, exceptUserId: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(lowerEmail, email.toLowerCase()), ne(users.id, exceptUserId)))
    .limit(1);
  return rows.length > 0;
}

/** Postgres "duplicate value" on the email index: someone took the address in the meantime. */
function isEmailClash(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = e?.code ? e : e?.cause;
  return pg?.code === "23505" && pg.constraint === "users_email_lower_idx";
}

export type ConfirmResult =
  { ok: true; kind: "verified" | "changed"; email: string } | { ok: false; reason: "expired" | "taken" };

/** Uses a confirm link from an email: confirms the address, or switches to the new one. */
export async function confirmEmail(link: EmailToken): Promise<ConfirmResult> {
  const user = await person(link.userId);
  if (!user || user.deleteAfter) return { ok: false, reason: "expired" };

  if (link.kind === "verify_email") {
    // A link for an address they've since changed away from no longer means anything.
    if (user.email.toLowerCase() !== link.email.toLowerCase()) return { ok: false, reason: "expired" };
    if (!(await consumeToken(link.id))) return { ok: false, reason: "expired" };
    if (!user.emailVerifiedAt) {
      await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, user.id));
    }
    announceAccount(user.id);
    return { ok: true, kind: "verified", email: user.email };
  }

  // change_email
  if (await emailInUse(link.email, user.id)) return { ok: false, reason: "taken" };
  if (!(await consumeToken(link.id))) return { ok: false, reason: "expired" };
  try {
    await db
      .update(users)
      .set({ email: link.email, emailVerifiedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (err) {
    if (isEmailClash(err)) return { ok: false, reason: "taken" };
    throw err;
  }
  // Links sent to the old address stop working.
  await cancelTokens(user.id, ["verify_email", "change_email", "reset_password"]);
  sendInBackground(emailChangedNotice(user, user.email, link.email));
  announceAccount(user.id);
  return { ok: true, kind: "changed", email: link.email };
}

// ───────────── Glofly Control ─────────────

/** Control → Send password reset. Waits for Amazon, so Control can say if it didn't go out. */
export async function adminSendPasswordReset(userId: string): Promise<"sent" | "send_failed" | "not_found"> {
  const user = await person(userId);
  if (!user) return "not_found";
  const token = await issueToken(user.id, "reset_password", user.email);
  if (await sendNow(resetPasswordEmail(user, linkFor("reset", token)))) return "sent";
  await discardToken(token);
  return "send_failed";
}

/** Control → Resend confirm email (no hourly limit: the admin decides). */
export async function adminResendVerification(userId: string): Promise<"sent" | "already_verified" | "send_failed"> {
  const user = await person(userId);
  if (!user || user.emailVerifiedAt) return "already_verified";
  return (await sendVerification(userId, true)) ? "sent" : "send_failed";
}

/**
 * Control → Change email: switches it straight away (no confirm step: the admin checked it
 * with them). The new address isn't confirmed yet, so a confirm link goes to it; the old
 * address gets "Your email was changed". Links sent to the old address stop working.
 */
export async function adminChangeEmail(userId: string, newEmail: string): Promise<"changed" | "same" | "taken" | "not_found"> {
  const user = await person(userId);
  if (!user) return "not_found";
  if (user.email.toLowerCase() === newEmail.toLowerCase()) return "same";
  if (await emailInUse(newEmail, userId)) return "taken";
  try {
    await db.update(users).set({ email: newEmail, emailVerifiedAt: null }).where(eq(users.id, userId));
  } catch (err) {
    if (isEmailClash(err)) return "taken";
    throw err;
  }
  await cancelTokens(userId, ["verify_email", "change_email", "reset_password"]);
  sendInBackground(emailChangedNotice(user, user.email, newEmail));
  await sendVerification(userId);
  announceAccount(userId);
  return "changed";
}

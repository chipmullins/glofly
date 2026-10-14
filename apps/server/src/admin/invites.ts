import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { accountInvites, friendships, users } from "../db/schema";
import { hashPassword } from "../auth/passwords";
import { pair } from "../friends/rules";
import { emitToUser } from "../realtime";
import { sendNow } from "../email/send";
import { inviteEmail, SITE_URL } from "../email/templates";
import { emailHeldByInvite, usernameHeldByInvite } from "./signups";
import { logInBackground } from "./audit";

// "Create an account for someone" (Control). The admin enters email, username and display
// name; the person gets "<Admin> invited you to Glofly" with a link to glofly.app/welcome,
// where they choose their own password, enter their birthday and agree to the Terms. Only
// then is the account made (and its email counts as confirmed: they opened the link).

export const INVITE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
const newToken = (): string => randomBytes(32).toString("base64url");
const welcomeLink = (token: string): string => `${SITE_URL}/welcome?t=${token}`;

export type Invite = typeof accountInvites.$inferSelect;

export type InviteStatus = "pending" | "expired" | "accepted" | "cancelled";
export function inviteStatus(invite: Invite): InviteStatus {
  if (invite.acceptedAt) return "accepted";
  if (invite.cancelledAt) return "cancelled";
  return invite.expiresAt.getTime() > Date.now() ? "pending" : "expired";
}

/** Who's sending: the admin's display name goes in the email ("Chip invited you"). */
export async function inviterName(userId: string | null): Promise<string> {
  if (!userId) return "Glofly";
  const [row] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId));
  return row?.name ?? "Glofly";
}

export async function usernameTaken(username: string, exceptInviteId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
    .limit(1);
  return rows.length > 0 || (await usernameHeldByInvite(username, exceptInviteId));
}

export async function emailTaken(email: string, exceptInviteId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);
  return rows.length > 0 || (await emailHeldByInvite(email, exceptInviteId));
}

export type CreateResult =
  | { ok: true; invite: Invite }
  | { ok: false; fields: Record<string, string> }
  | { ok: false; sendFailed: true };

export async function createInvite(input: {
  email: string;
  username: string;
  displayName: string;
  addFriend: boolean;
  invitedBy: string;
  /** 0.4.0: a restricted (family-managed) account, set up with a parent's consent. */
  restricted?: boolean;
}): Promise<CreateResult> {
  const fields: Record<string, string> = {};
  if (await usernameTaken(input.username)) fields.username = "That username is taken.";
  if (await emailTaken(input.email)) fields.email = "An account (or invite) already uses this email.";
  if (Object.keys(fields).length) return { ok: false, fields };

  const token = newToken();
  const [invite] = await db
    .insert(accountInvites)
    .values({
      email: input.email,
      username: input.username,
      displayName: input.displayName,
      tokenHash: hash(token),
      invitedBy: input.invitedBy,
      addFriend: input.addFriend,
      restricted: input.restricted ?? false,
      expiresAt: new Date(Date.now() + INVITE_DAYS * DAY),
    })
    .returning();

  if (!(await sendNow(inviteEmail(invite, await inviterName(input.invitedBy), welcomeLink(token))))) {
    // Never went out: don't leave a username held by an invite nobody received.
    await db.delete(accountInvites).where(eq(accountInvites.id, invite.id));
    return { ok: false, sendFailed: true };
  }
  return { ok: true, invite };
}

/** A new link (the old one stops working) and 7 more days. Also revives an expired invite. */
export async function resendInvite(inviteId: string): Promise<"sent" | "not_found" | "taken" | "send_failed"> {
  const [invite] = await db.select().from(accountInvites).where(eq(accountInvites.id, inviteId));
  if (!invite || invite.acceptedAt || invite.cancelledAt) return "not_found";
  // An expired invite no longer holds its username: someone may have taken it meanwhile.
  if ((await usernameTaken(invite.username, invite.id)) || (await emailTaken(invite.email, invite.id))) {
    return "taken";
  }
  const token = newToken();
  const previous = { tokenHash: invite.tokenHash, expiresAt: invite.expiresAt, sentAt: invite.sentAt };
  await db
    .update(accountInvites)
    .set({ tokenHash: hash(token), expiresAt: new Date(Date.now() + INVITE_DAYS * DAY), sentAt: new Date() })
    .where(eq(accountInvites.id, invite.id));
  if (!(await sendNow(inviteEmail(invite, await inviterName(invite.invitedBy), welcomeLink(token))))) {
    await db.update(accountInvites).set(previous).where(eq(accountInvites.id, invite.id));
    return "send_failed";
  }
  return "sent";
}

export async function cancelInvite(inviteId: string): Promise<boolean> {
  const done = await db
    .update(accountInvites)
    .set({ cancelledAt: new Date() })
    .where(and(eq(accountInvites.id, inviteId), isNull(accountInvites.acceptedAt), isNull(accountInvites.cancelledAt)))
    .returning({ id: accountInvites.id });
  return done.length === 1;
}

/** The invite behind a welcome link, if it still works. Opening the page doesn't use it up. */
export async function findInvite(token: string): Promise<Invite | null> {
  const [row] = await db
    .select()
    .from(accountInvites)
    .where(
      and(
        eq(accountInvites.tokenHash, hash(token)),
        isNull(accountInvites.acceptedAt),
        isNull(accountInvites.cancelledAt),
        gt(accountInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Postgres "duplicate value" on a users unique index. */
function isClash(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === "23505";
}

export type AcceptResult = { ok: true; username: string } | { ok: false; reason: "expired" | "taken" };

/** The person pressed "Finish setting up": the account is made, ready to log in. */
export async function acceptInvite(
  invite: Invite,
  details: { password: string; birthday: string },
): Promise<AcceptResult> {
  const passwordHash = await hashPassword(details.password);
  try {
    const result = await db.transaction(async (tx) => {
      // Only one press can use the link.
      const claimed = await tx
        .update(accountInvites)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(accountInvites.id, invite.id),
            isNull(accountInvites.acceptedAt),
            isNull(accountInvites.cancelledAt),
            gt(accountInvites.expiresAt, new Date()),
          ),
        )
        .returning({ id: accountInvites.id });
      if (claimed.length !== 1) return null;

      const now = new Date();
      const [user] = await tx
        .insert(users)
        .values({
          email: invite.email,
          username: invite.username,
          displayName: invite.displayName,
          passwordHash,
          birthday: details.birthday,
          termsAcceptedAt: now,
          // They opened the link we emailed, so the address is theirs.
          emailVerifiedAt: now,
          restricted: invite.restricted,
        })
        .returning({ id: users.id, username: users.username });
      await tx.update(accountInvites).set({ acceptedUserId: user.id }).where(eq(accountInvites.id, invite.id));

      let befriended: string | null = null;
      if (invite.addFriend && invite.invitedBy) {
        const [inviter] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, invite.invitedBy), isNull(users.deleteAfter)));
        if (inviter) {
          await tx
            .insert(friendships)
            .values({ ...pair(inviter.id, user.id), requesterId: inviter.id, status: "accepted", acceptedAt: now })
            .onConflictDoNothing();
          befriended = inviter.id;
        }
      }
      return { user, befriended };
    });
    if (!result) return { ok: false, reason: "expired" };
    if (result.befriended) emitToUser(result.befriended, "friends:changed", {});
    logInBackground({
      adminId: null,
      action: "Finished setting up",
      targetUserId: result.user.id,
      targetLabel: `@${result.user.username}`,
      note: "Accepted the invite on glofly.app/welcome",
    });
    return { ok: true, username: result.user.username };
  } catch (err) {
    if (isClash(err)) return { ok: false, reason: "taken" };
    throw err;
  }
}

/** Pending or expired (not yet accepted or cancelled) invites, newest first. */
export async function openInvites(search?: string): Promise<Invite[]> {
  const like = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  return db
    .select()
    .from(accountInvites)
    .where(
      and(
        isNull(accountInvites.acceptedAt),
        isNull(accountInvites.cancelledAt),
        like
          ? or(
              sql`${accountInvites.username} ilike ${like}`,
              sql`${accountInvites.email} ilike ${like}`,
              sql`${accountInvites.displayName} ilike ${like}`,
            )
          : undefined,
      ),
    )
    .orderBy(sql`${accountInvites.createdAt} desc`)
    .limit(200);
}

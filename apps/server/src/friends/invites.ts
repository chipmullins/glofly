import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { friendInvites, friendships, users } from "../db/schema";
import { hashPassword } from "../auth/passwords";
import { sendNow } from "../email/send";
import { friendInviteEmail, friendInviteExistingEmail, SITE_URL } from "../email/templates";
import { emailHeldByInvite, usernameHeldByInvite } from "../admin/signups";
import { emitToUser } from "../realtime";
import { inBackground, notifyFriendJoined } from "../push/notify";
import { blockedEitherWay, pair } from "./rules";

// "Invite your friends" (0.3.0, under Add friend): enter an email and Glofly sends a branded
// email saying who invited them, with a link to glofly.app/join. Making an account from that link
// works even when sign-ups are invite-only, counts the email as confirmed (they opened our link),
// and makes them friends with everyone who invited that address.
//
// Privacy: an address that already has an account is never revealed to the inviter. They see
// "Invite sent" either way; the account holder gets a different email ("<Name> wants to be friends,
// search for @username") unless they blocked each other or turned off friend requests.

export const FRIEND_INVITE_DAYS = 14;
export const FRIEND_INVITES_PER_DAY = 10;
/** One address can't be flooded by many people inviting it. */
const INVITES_PER_ADDRESS_PER_DAY = 3;
const DAY = 24 * 60 * 60 * 1000;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
const newToken = (): string => randomBytes(32).toString("base64url");
const joinLink = (token: string): string => `${SITE_URL}/join?t=${token}`;
const lower = (email: string) => email.trim().toLowerCase();

export type FriendInvite = typeof friendInvites.$inferSelect;

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "own_email" | "too_many" | "already_invited" | "send_failed" };

type Inviter = { id: string; displayName: string; username: string };

export async function sendFriendInvite(inviter: Inviter, emailTyped: string): Promise<SendResult> {
  const email = emailTyped.trim();
  const since = new Date(Date.now() - DAY);

  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, inviter.id));
  if (me && lower(me.email) === lower(email)) return { ok: false, reason: "own_email" };

  const [{ sent }] = await db
    .select({ sent: count() })
    .from(friendInvites)
    .where(and(eq(friendInvites.inviterId, inviter.id), gt(friendInvites.createdAt, since)));
  if (sent >= FRIEND_INVITES_PER_DAY) return { ok: false, reason: "too_many" };

  // Already invited them and the link still works: no second email.
  const [pending] = await db
    .select({ id: friendInvites.id })
    .from(friendInvites)
    .where(
      and(
        eq(friendInvites.inviterId, inviter.id),
        sql`lower(${friendInvites.email}) = ${lower(email)}`,
        isNull(friendInvites.acceptedAt),
        gt(friendInvites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (pending) return { ok: false, reason: "already_invited" };

  // An address that already has an account: never say so (see the top of this file).
  const [existing] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      friendRequests: users.friendRequests,
      deleteAfter: users.deleteAfter,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${lower(email)}`)
    .limit(1);

  // Recorded either way, so the daily limits count it and repeats look the same.
  const [{ toAddress }] = await db
    .select({ toAddress: count() })
    .from(friendInvites)
    .where(and(sql`lower(${friendInvites.email}) = ${lower(email)}`, gt(friendInvites.createdAt, since)));
  const token = newToken();
  const [invite] = await db
    .insert(friendInvites)
    .values({
      inviterId: inviter.id,
      email,
      tokenHash: hash(token),
      expiresAt: new Date(Date.now() + FRIEND_INVITE_DAYS * DAY),
      // An existing account can't sign up again: the invite is born used up.
      ...(existing ? { acceptedAt: new Date() } : {}),
    })
    .returning({ id: friendInvites.id });

  if (toAddress >= INVITES_PER_ADDRESS_PER_DAY) return { ok: true }; // quietly: enough emails today

  if (existing) {
    const quiet =
      !!existing.deleteAfter ||
      !!existing.suspendedAt ||
      existing.friendRequests === "nobody" ||
      existing.id === inviter.id ||
      (await blockedEitherWay(existing.id, inviter.id)) ||
      (await alreadyFriendsOrPending(existing.id, inviter.id));
    if (!quiet) inBackground(sendNow(friendInviteExistingEmail(existing, inviter)));
    return { ok: true };
  }

  if (!(await sendNow(friendInviteEmail(email, inviter, joinLink(token), FRIEND_INVITE_DAYS)))) {
    await db.delete(friendInvites).where(eq(friendInvites.id, invite.id));
    return { ok: false, reason: "send_failed" };
  }
  return { ok: true };
}

async function alreadyFriendsOrPending(a: string, b: string): Promise<boolean> {
  const p = pair(a, b);
  const [row] = await db
    .select({ low: friendships.userLow })
    .from(friendships)
    .where(and(eq(friendships.userLow, p.userLow), eq(friendships.userHigh, p.userHigh)))
    .limit(1);
  return !!row;
}

/** The invite behind a join link, if it still works. Opening the page doesn't use it up. */
export async function findFriendInvite(token: string): Promise<(FriendInvite & { inviterName: string; inviterUsername: string }) | null> {
  const [row] = await db
    .select({ invite: friendInvites, inviterName: users.displayName, inviterUsername: users.username })
    .from(friendInvites)
    .innerJoin(users, eq(users.id, friendInvites.inviterId))
    .where(
      and(
        eq(friendInvites.tokenHash, hash(token)),
        isNull(friendInvites.acceptedAt),
        gt(friendInvites.expiresAt, new Date()),
        isNull(users.deleteAfter),
      ),
    )
    .limit(1);
  return row ? { ...row.invite, inviterName: row.inviterName, inviterUsername: row.inviterUsername } : null;
}

export type JoinDetails = { username: string; displayName: string; password: string; birthday: string };
export type JoinResult =
  | { ok: true; username: string }
  | { ok: false; reason: "expired" }
  | { ok: false; reason: "taken"; fields: Record<string, string> };

function isClash(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === "23505";
}

/** They pressed "Join Glofly" on glofly.app/join: the account is made and the friendships too. */
export async function acceptFriendInvite(invite: FriendInvite, details: JoinDetails): Promise<JoinResult> {
  // Taken names and addresses (including ones held by an invite from Glofly Control).
  const fields: Record<string, string> = {};
  const [nameClash] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${details.username.toLowerCase()}`)
    .limit(1);
  if (nameClash || (await usernameHeldByInvite(details.username))) fields.username = "That username is taken.";
  const [emailClash] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${lower(invite.email)}`)
    .limit(1);
  if (emailClash || (await emailHeldByInvite(invite.email))) {
    fields.email = "This email already has a Glofly account. Just log in.";
  }
  if (Object.keys(fields).length) return { ok: false, reason: "taken", fields };

  const passwordHash = await hashPassword(details.password);
  try {
    const result = await db.transaction(async (tx) => {
      const now = new Date();
      // Only one press can use the link.
      const claimed = await tx
        .update(friendInvites)
        .set({ acceptedAt: now })
        .where(and(eq(friendInvites.id, invite.id), isNull(friendInvites.acceptedAt), gt(friendInvites.expiresAt, now)))
        .returning({ id: friendInvites.id });
      if (claimed.length !== 1) return null;

      const [user] = await tx
        .insert(users)
        .values({
          email: invite.email,
          username: details.username,
          displayName: details.displayName,
          passwordHash,
          birthday: details.birthday,
          termsAcceptedAt: now,
          // They opened the link we emailed, so the address is theirs.
          emailVerifiedAt: now,
        })
        .returning({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion });

      // Everyone with a working invite to this address becomes a friend (this link's inviter first).
      const others = await tx
        .select({ id: friendInvites.id, inviterId: friendInvites.inviterId })
        .from(friendInvites)
        .where(
          and(
            sql`lower(${friendInvites.email}) = ${lower(invite.email)}`,
            isNull(friendInvites.acceptedAt),
            gt(friendInvites.expiresAt, now),
          ),
        );
      const inviterIds = [...new Set([invite.inviterId, ...others.map((o) => o.inviterId)])];
      const befriended: string[] = [];
      for (const inviterId of inviterIds) {
        const [inviter] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, inviterId), isNull(users.deleteAfter)));
        if (!inviter) continue;
        await tx
          .insert(friendships)
          .values({ ...pair(inviter.id, user.id), requesterId: inviter.id, status: "accepted", acceptedAt: now })
          .onConflictDoNothing();
        befriended.push(inviter.id);
      }
      await tx
        .update(friendInvites)
        .set({ acceptedAt: now, acceptedBy: user.id })
        .where(
          and(
            sql`lower(${friendInvites.email}) = ${lower(invite.email)}`,
            isNull(friendInvites.acceptedBy),
            or(isNull(friendInvites.acceptedAt), eq(friendInvites.id, invite.id)),
          ),
        );
      return { user, befriended };
    });
    if (!result) return { ok: false, reason: "expired" };
    const joined = {
      id: result.user.id,
      username: result.user.username,
      displayName: result.user.displayName,
      avatarVersion: result.user.avatarVersion,
    };
    for (const inviterId of result.befriended) {
      emitToUser(inviterId, "friends:changed", {});
      emitToUser(inviterId, "friend:joined", { user: joined });
      inBackground(notifyFriendJoined(inviterId, joined));
    }
    return { ok: true, username: result.user.username };
  } catch (err) {
    if (isClash(err)) return { ok: false, reason: "taken", fields: { username: "That username is taken." } };
    throw err;
  }
}

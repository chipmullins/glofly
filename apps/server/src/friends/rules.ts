import { and, eq, inArray, isNotNull, ne, or } from "drizzle-orm";
import { db } from "../db";
import { blocks, conversationMembers, conversations, friendships, users } from "../db/schema";

/** Pairs are stored lower id first, so each pair of people has exactly one row. */
export function pair(a: string, b: string): { userLow: string; userHigh: string } {
  return a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
}

export const pairIs = (a: string, b: string) => {
  const p = pair(a, b);
  return and(eq(friendships.userLow, p.userLow), eq(friendships.userHigh, p.userHigh));
};

/** True if either person has blocked the other. */
export async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Everyone this person has blocked or been blocked by (2.0: typing in nebulas). */
export async function blockedWith(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ id: friendships.id })
    .from(friendships)
    .where(and(pairIs(a, b), eq(friendships.status, "accepted")))
    .limit(1);
  return rows.length > 0;
}

/** True if either account is set to be deleted (hidden until it's restored or removed). */
export async function deletionPending(...userIds: string[]): Promise<boolean> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), isNotNull(users.deleteAfter)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Glofly's rule: you can message friends, unless either of you has blocked the other
 * (or one of you is deleting their account).
 */
export async function canMessage(a: string, b: string): Promise<boolean> {
  return (
    (await areFriends(a, b)) && !(await blockedEitherWay(a, b)) && !(await deletionPending(a, b))
  );
}

/**
 * Which of these people I can message (canMessage for each), in three queries however many there
 * are. Used by the chat list, so it doesn't cost three queries per DM.
 */
export async function messageableAmong(myId: string, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)].filter((id) => id !== myId);
  if (!ids.length || (await deletionPending(myId))) return new Set();
  const friendRows = await db
    .select({ low: friendships.userLow, high: friendships.userHigh })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(
          and(eq(friendships.userLow, myId), inArray(friendships.userHigh, ids)),
          and(eq(friendships.userHigh, myId), inArray(friendships.userLow, ids)),
        ),
      ),
    );
  const friends = new Set(friendRows.map((r) => (r.low === myId ? r.high : r.low)));
  if (!friends.size) return friends;
  const blocked = await blockedWith(myId);
  const leaving = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...friends]), isNotNull(users.deleteAfter)));
  for (const r of leaving) friends.delete(r.id);
  for (const id of blocked) friends.delete(id);
  return friends;
}

/** Everyone I have a chat with (DMs and groups; not nebulas). */
export async function chatPartnersOf(userId: string): Promise<string[]> {
  // Not nebulas (2.0): being in the same constellation doesn't make someone a chat partner.
  const mine = db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, userId), ne(conversations.kind, "nebula")));
  const rows = await db
    .selectDistinct({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(inArray(conversationMembers.conversationId, mine), ne(conversationMembers.userId, userId)));
  return rows.map((r) => r.userId);
}

// ───────────── Restricted (family-managed) accounts, 0.4.0 ─────────────

/** Is this a restricted account (Control → Accounts → Restricted)? */
export async function isRestricted(userId: string): Promise<boolean> {
  const [row] = await db.select({ restricted: users.restricted }).from(users).where(eq(users.id, userId));
  return row?.restricted === true;
}

/** Which of these people have restricted accounts. */
export async function restrictedAmong(userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, userIds), eq(users.restricted, true)));
  return rows.map((r) => r.id);
}

/**
 * A restricted account can only be in a group where everyone else is their friend. True if a
 * group of exactly these people would break that.
 */
export async function groupBreaksRestriction(memberIds: string[]): Promise<boolean> {
  const members = [...new Set(memberIds)];
  for (const kid of await restrictedAmong(members)) {
    for (const other of members) {
      if (other !== kid && !(await areFriends(kid, other))) return true;
    }
  }
  return false;
}

/** What a restricted account sees when trying something only their family can do. */
export const MANAGED_BY_FAMILY = {
  error: "restricted",
  message: "Your account is managed by your family, so they take care of this for you.",
} as const;

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "../db";
import { blocks, friendships, users } from "../db/schema";

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

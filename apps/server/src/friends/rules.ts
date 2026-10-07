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

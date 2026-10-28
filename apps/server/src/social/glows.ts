import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { TIME_ZONE } from "../timeZone";
import { dayIn, glowNow, lightGlow, type Glow } from "@glofly/shared";
import { db } from "../db";
import { friendships, glows, users } from "../db/schema";
import { pair } from "../friends/rules";
import { emitToUser } from "../realtime";

// Glows (0.5.0): a streak between two friends. Each day you both write in your 1-on-1 chat it
// gets brighter (up to 5); each day missed dims it by one instead of starting over.
//
// "A day" is Glofly's day: midnight to midnight in GLOFLY_TIME_ZONE (US Central by default),
// the same for everyone so both people always agree on what "today" is.

export { TIME_ZONE };

/** Today in Glofly's time zone (YYYY-MM-DD). */
export const today = (now = new Date()) => dayIn(now, TIME_ZONE);

/** Someone wrote to a friend in their 1-on-1 chat: count it toward today's glow. */
export async function noteGlow(senderId: string, partnerId: string): Promise<void> {
  const p = pair(senderId, partnerId);
  const day = today();
  const senderIsLow = senderId === p.userLow;
  const lit = await db.transaction(async (tx) => {
    await tx.insert(glows).values({ ...p }).onConflictDoNothing();
    const [row] = await tx
      .select()
      .from(glows)
      .where(and(eq(glows.userLow, p.userLow), eq(glows.userHigh, p.userHigh)))
      .for("update");
    if (!row) return false;
    const lowWroteOn = senderIsLow ? day : row.lowWroteOn;
    const highWroteOn = senderIsLow ? row.highWroteOn : day;
    if (lowWroteOn === row.lowWroteOn && highWroteOn === row.highWroteOn) return false; // already counted
    const both = lowWroteOn === day && highWroteOn === day && row.lastDay !== day;
    const next = both ? lightGlow({ level: row.level, days: row.days, best: row.best, lastDay: row.lastDay }, day) : null;
    await tx
      .update(glows)
      .set({ lowWroteOn, highWroteOn, ...(next ? { level: next.level, days: next.days, best: next.best, lastDay: next.lastDay } : {}) })
      .where(and(eq(glows.userLow, p.userLow), eq(glows.userHigh, p.userHigh)));
    return both;
  });
  // Both wrote today: the firefly by each other's name brightens (apps fetch /social again).
  if (lit) {
    emitToUser(senderId, "social:changed", {});
    emitToUser(partnerId, "social:changed", {});
  }
}

/** My glows with friends right now: friend id → glow (friends with no glow left out). */
export async function glowsOf(userId: string): Promise<Record<string, Glow>> {
  const rows = await db
    .select()
    .from(glows)
    .where(or(eq(glows.userLow, userId), eq(glows.userHigh, userId)));
  if (!rows.length) return {};
  // Only current friends (a glow sleeps while you're not friends, and wakes if you are again).
  const otherIds = rows.map((r) => (r.userLow === userId ? r.userHigh : r.userLow));
  const friends = await db
    .select({ low: friendships.userLow, high: friendships.userHigh })
    .from(friendships)
    .innerJoin(users, eq(users.id, sql`case when ${friendships.userLow} = ${userId} then ${friendships.userHigh} else ${friendships.userLow} end`))
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(and(eq(friendships.userLow, userId), inArray(friendships.userHigh, otherIds)), and(eq(friendships.userHigh, userId), inArray(friendships.userLow, otherIds))),
        isNull(users.deleteAfter),
      ),
    );
  const friendIds = new Set(friends.map((f) => (f.low === userId ? f.high : f.low)));
  const day = today();
  const out: Record<string, Glow> = {};
  for (const r of rows) {
    const other = r.userLow === userId ? r.userHigh : r.userLow;
    if (!friendIds.has(other)) continue;
    const g = glowNow({ level: r.level, days: r.days, best: r.best, lastDay: r.lastDay }, day);
    if (g) out[other] = g;
  }
  return out;
}

/** The longest glow someone has had (best days), with whom: for Year in Glow. */
export async function longestGlowOf(userId: string): Promise<{ userId: string; days: number } | null> {
  const rows = await db
    .select({ low: glows.userLow, high: glows.userHigh, best: glows.best })
    .from(glows)
    .where(or(eq(glows.userLow, userId), eq(glows.userHigh, userId)));
  let top: { userId: string; days: number } | null = null;
  for (const r of rows) {
    if (r.best > (top?.days ?? 0)) top = { userId: r.low === userId ? r.high : r.low, days: r.best };
  }
  return top;
}

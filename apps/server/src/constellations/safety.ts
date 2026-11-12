import { and, eq, inArray, sql } from "drizzle-orm";
import {
  cleanSafety,
  verificationProblem,
  type ConstellationPermission,
  type SafetySettings,
} from "@glofly/shared";
import { db } from "../db";
import { constellationMemberRoles, constellationMembers, constellationRoles, constellations, users } from "../db/schema";
import { redis } from "../redis";

// Communities round 2, Night watch → Safety (approved board 1d): verification levels, raid
// protection and the settings behind the mention cap. A leaf module (no perms/routes imports) so
// perms.ts can ask it whether someone may post.

const cache = new Map<string, { at: number; safety: SafetySettings }>();
const CACHE_MS = 30_000;

/** A constellation's Safety settings (the defaults when never changed), cached for 30 seconds. */
export async function safetyOf(constellationId: string): Promise<SafetySettings> {
  const hit = cache.get(constellationId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.safety;
  const [row] = await db.select({ safety: constellations.safety }).from(constellations).where(eq(constellations.id, constellationId));
  const safety = cleanSafety(row?.safety ?? null);
  if (cache.size > 5000) cache.clear();
  cache.set(constellationId, { at: Date.now(), safety });
  return safety;
}

export function forgetSafety(constellationId: string): void {
  cache.delete(constellationId);
}

/** Moderators and up (and bots) skip verification, the mention cap and raid holds. */
export function skipsSafety(s: { owner: boolean; permissions: Set<ConstellationPermission> }): boolean {
  return s.owner || s.permissions.has("deleteMessages") || s.permissions.has("timeoutKick") || s.permissions.has("ban");
}

/**
 * Why someone can't chat yet because of the verification level, or null when they can.
 * Roles picked in Safety skip it; so do moderators and bots.
 */
export async function verificationBlock(
  s: { constellationId: string; userId: string; owner: boolean; permissions: Set<ConstellationPermission>; roleIds: string[] },
  now = Date.now(),
): Promise<string | null> {
  const safety = await safetyOf(s.constellationId);
  if (safety.verification === "off" || skipsSafety(s)) return null;
  if (s.roleIds.some((r) => safety.verificationSkipRoles.includes(r))) return null;
  const [row] = await db
    .select({ verifiedAt: users.emailVerifiedAt, createdAt: users.createdAt, bot: users.bot, joinedAt: constellationMembers.joinedAt })
    .from(users)
    .innerJoin(constellationMembers, and(eq(constellationMembers.userId, users.id), eq(constellationMembers.constellationId, s.constellationId)))
    .where(eq(users.id, s.userId));
  if (!row || row.bot) return null;
  return verificationProblem(
    safety.verification,
    { emailConfirmed: !!row.verifiedAt, accountCreatedAt: row.createdAt.getTime(), joinedAt: row.joinedAt.getTime() },
    now,
  );
}

// ───────────── Raid protection ─────────────

export const JOINS_PAUSED_MESSAGE = "This constellation paused new joins for a little while. Try again later.";

/** Joins are paused right now (a raid, or a moderator paused them). */
export async function joinsPaused(constellationId: string, now = Date.now()): Promise<Date | null> {
  const [row] = await db.select({ until: constellations.joinsPausedUntil }).from(constellations).where(eq(constellations.id, constellationId));
  return row?.until && row.until.getTime() > now ? row.until : null;
}

const raidKey = (cid: string) => `raid:joins:${cid}`;

export type RaidNoticed = { joins: number; seconds: number; newAccounts: number; pausedUntil: Date; held: string[] };

/**
 * After someone joined: counts joins by young Glofly accounts in the window. Reaching the limit
 * pauses joins and (with raidHold) marks the people who joined in the window, so their messages
 * wait for a moderator. Returns what happened when a raid was noticed (the caller logs + alerts).
 */
export async function noteJoin(constellationId: string, userId: string, now = Date.now()): Promise<RaidNoticed | null> {
  const safety = await safetyOf(constellationId);
  if (!safety.raidOn) return null;
  const [u] = await db.select({ createdAt: users.createdAt, bot: users.bot }).from(users).where(eq(users.id, userId));
  if (!u || u.bot) return null;
  const young = now - u.createdAt.getTime() < safety.raidAccountDays * 86_400_000;
  const key = raidKey(constellationId);
  const windowMs = safety.raidSeconds * 1000;
  let recent: string[] = [];
  try {
    await redis.zRemRangeByScore(key, 0, now - windowMs);
    // Every join is counted (`young` decides whether it counts toward the limit).
    await redis.zAdd(key, { score: now, value: `${userId}|${young ? 1 : 0}` });
    await redis.pExpire(key, windowMs + 5000);
    recent = await redis.zRangeByScore(key, now - windowMs, "+inf");
  } catch {
    return null; // Redis down: no raid protection rather than no joining
  }
  const joiners = recent.map((v) => v.split("|")).map(([id, y]) => ({ id, young: y === "1" }));
  const youngCount = joiners.filter((j) => j.young).length;
  if (youngCount < safety.raidJoins) return null;
  const pausedUntil = new Date(now + safety.raidPauseMinutes * 60_000);
  // Only the first join over the limit starts a raid (a pause already running is left alone).
  const started = await db
    .update(constellations)
    .set({ joinsPausedUntil: pausedUntil, raidAt: new Date(now) })
    .where(and(eq(constellations.id, constellationId), sql`(${constellations.joinsPausedUntil} is null or ${constellations.joinsPausedUntil} < now())`))
    .returning({ id: constellations.id });
  await redis.del(key).catch(() => {});
  if (!started.length) return null;
  const held = safety.raidHold ? [...new Set(joiners.filter((j) => j.young).map((j) => j.id))] : [];
  if (held.length) {
    await db
      .update(constellationMembers)
      .set({ raidHold: true })
      .where(and(eq(constellationMembers.constellationId, constellationId), inArray(constellationMembers.userId, held)));
  }
  return { joins: joiners.length, seconds: safety.raidSeconds, newAccounts: youngCount, pausedUntil, held };
}

/** Is this member's posting held for a moderator (they joined during a raid)? */
export async function raidHeld(constellationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ hold: constellationMembers.raidHold })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
  return !!row?.hold;
}

/** Everyone who can moderate here (Owner + roles that delete, time out or ban), at most 50. */
export async function moderatorIds(constellationId: string): Promise<string[]> {
  const [c] = await db.select({ ownerId: constellations.ownerId }).from(constellations).where(eq(constellations.id, constellationId));
  const roles = await db
    .select({ id: constellationRoles.id, permissions: constellationRoles.permissions, selfAssign: constellationRoles.selfAssign, kind: constellationRoles.kind })
    .from(constellationRoles)
    .where(eq(constellationRoles.constellationId, constellationId));
  const modRoles = roles
    .filter((r) => !r.selfAssign && r.kind !== "member" && r.permissions.some((p) => p === "deleteMessages" || p === "timeoutKick" || p === "ban"))
    .map((r) => r.id);
  const ids = new Set<string>(c ? [c.ownerId] : []);
  if (modRoles.length) {
    const rows = await db
      .select({ userId: constellationMemberRoles.userId })
      .from(constellationMemberRoles)
      .innerJoin(users, eq(users.id, constellationMemberRoles.userId))
      .where(and(eq(constellationMemberRoles.constellationId, constellationId), inArray(constellationMemberRoles.roleId, modRoles), eq(users.bot, false)))
      .limit(60);
    for (const r of rows) ids.add(r.userId);
  }
  return [...ids].slice(0, 50);
}

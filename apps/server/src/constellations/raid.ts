import { eq } from "drizzle-orm";
import { db } from "../db";
import { constellations } from "../db/schema";
import { emitToUser } from "../realtime";
import { inBackground, notifyModerators } from "../push/notify";
import { logModeration } from "./activity";
import { moderatorIds, noteJoin, safetyOf } from "./safety";

// Communities round 2 (board 1d): after a join, raid protection may pause joins. Then the mod log
// gets a "Safety locked joins" line and moderators get the banner live and a push alert.

export async function afterJoinSafety(constellationId: string, userId: string): Promise<void> {
  const raid = await noteJoin(constellationId, userId);
  if (!raid) return;
  await logModeration(constellationId, null, "joins_locked", null, {
    by: "safety",
    joins: raid.joins,
    newAccounts: raid.newAccounts,
    seconds: raid.seconds,
    until: raid.pausedUntil.toISOString(),
    held: raid.held.length,
  });
  const mods = await moderatorIds(constellationId);
  const payload = { constellationId, pausedUntil: raid.pausedUntil.toISOString(), joins: raid.joins, newAccounts: raid.newAccounts, seconds: raid.seconds };
  for (const id of mods) emitToUser(id, "constellation:raid", payload, true);
  const safety = await safetyOf(constellationId);
  if (!safety.raidAlert) return;
  const [c] = await db.select({ id: constellations.id, name: constellations.name, ownerId: constellations.ownerId }).from(constellations).where(eq(constellations.id, constellationId));
  if (!c) return;
  const span = raid.seconds < 60 ? `${raid.seconds} seconds` : raid.seconds === 60 ? "a minute" : `${raid.seconds / 60} minutes`;
  inBackground(notifyModerators(mods, c, `Joins paused: possible raid (${raid.joins} joins in ${span}). Tap to review.`));
}

const pokeTimers = new Map<string, NodeJS.Timeout>();

/**
 * Night watch changed (a report, a held message, an appeal, a decision): moderators' open
 * dashboards and the "Night watch · 5" badge refresh. Bunched per constellation (one poke per 2 s).
 */
export function pokeNightWatch(constellationId: string): void {
  if (pokeTimers.has(constellationId)) return;
  pokeTimers.set(
    constellationId,
    setTimeout(() => {
      pokeTimers.delete(constellationId);
      void moderatorIds(constellationId)
        .then((ids) => {
          for (const id of ids) emitToUser(id, "nightwatch:changed", { constellationId }, true);
        })
        .catch(() => {});
    }, 2000),
  );
}

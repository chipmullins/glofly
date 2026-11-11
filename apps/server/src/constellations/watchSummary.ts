import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { ConstellationPermission } from "@glofly/shared";
import { db } from "../db";
import { automodHeld, constellationAppeals, constellationReports, constellations } from "../db/schema";
import { can, type Standing } from "./perms";

// Communities round 2: what the constellation detail says about Night watch (a leaf module, so
// views.ts can use it without importing the whole dashboard).

/** Any of these opens Night watch (the same people who saw the old Moderation page). */
export const MOD_VIEWERS: ConstellationPermission[] = ["deleteMessages", "timeoutKick", "ban", "muteVoice", "manageRoles", "manageConstellation"];
export const isModViewer = (s: Standing) => MOD_VIEWERS.some((p) => can(s, p));

/** Only held AutoMod messages this recent stay in the queue (older ones are just in the log). */
export const QUEUE_DAYS = 7;

/** For the constellation detail: the "Night watch · 5" badge and the joins-paused banner. */
export async function watchSummaryFor(s: Standing): Promise<{ open: number; pausedUntil: string | null } | null> {
  if (!isModViewer(s)) return null;
  const cid = s.constellationId;
  const since = new Date(Date.now() - QUEUE_DAYS * 86_400_000);
  const [[r], [h], [a], [c]] = await Promise.all([
    db.select({ n: count() }).from(constellationReports).where(and(eq(constellationReports.constellationId, cid), eq(constellationReports.status, "open"))),
    db
      .select({ n: count() })
      .from(automodHeld)
      .where(and(eq(automodHeld.constellationId, cid), isNull(automodHeld.releasedAt), isNull(automodHeld.dismissedAt), gt(automodHeld.createdAt, since))),
    can(s, "ban")
      ? db.select({ n: count() }).from(constellationAppeals).where(and(eq(constellationAppeals.constellationId, cid), eq(constellationAppeals.status, "open")))
      : Promise.resolve([{ n: 0 }]),
    db.select({ until: constellations.joinsPausedUntil }).from(constellations).where(eq(constellations.id, cid)),
  ]);
  const paused = c?.until && c.until.getTime() > Date.now() ? c.until.toISOString() : null;
  return { open: (r?.n ?? 0) + (h?.n ?? 0) + (a?.n ?? 0), pausedUntil: paused };
}


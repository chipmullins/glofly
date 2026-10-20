import { and, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { announcePresence } from "./presence";
import { emitToUser } from "./realtime";

// 0.8.0 Statuses that clear themselves: once a minute, custom statuses whose "Clear after" time
// has come are cleared and friends are told, exactly like clearing it by hand. Rows are claimed
// with one conditional UPDATE, so two runs (or two servers) never clear the same one twice.
// Between runs nobody sees an expired status anyway: presence.ts `liveStatusText` hides it.

export async function sweepExpiredStatuses(now = new Date()): Promise<number> {
  const cleared = await db
    .update(users)
    .set({ statusText: null, statusTextExpiresAt: null })
    .where(and(isNotNull(users.statusTextExpiresAt), lte(users.statusTextExpiresAt, sql`${now.toISOString()}::timestamptz`)))
    .returning({ id: users.id });
  for (const { id } of cleared) {
    // force: friends' last copy may already lack the text (read-time check), but your own
    // devices still need to hear it so their status menu updates.
    await announcePresence(id, emitToUser, true).catch((err) => console.error("Status clear announce failed:", err));
  }
  return cleared.length;
}

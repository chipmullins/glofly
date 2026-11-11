import { tableFor, type Table } from "./perms";

// Live drags check the table at most every 5 s per person (they come up to 30 a second). Changing
// someone's place at a table (removed, made a player or a GM) clears theirs at once.

const tableCache = new Map<string, { at: number; t: Table | null }>();
/** Someone's place at a table changed (removed, made a player or a GM): their drags are checked afresh. */
export function forgetCachedTable(campaignId: string, userId: string): void {
  tableCache.delete(`${campaignId}:${userId}`);
}
export async function cachedTable(campaignId: string, userId: string): Promise<Table | null> {
  const key = `${campaignId}:${userId}`;
  const hit = tableCache.get(key);
  if (hit && Date.now() - hit.at < 5000) return hit.t;
  const t = await tableFor(campaignId, userId);
  if (tableCache.size > 10_000) tableCache.clear();
  tableCache.set(key, { at: Date.now(), t });
  return t;
}

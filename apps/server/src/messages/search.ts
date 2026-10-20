import { desc, sql, type SQL } from "drizzle-orm";
import { db, pool } from "../db";
import { messages } from "../db/schema";
import { messageFields, type MessageRow } from "./routes";

// 0.8.0 faster search. The query is the same as before (ILIKE '%words%', newest first, ties by
// id), so the results are identical; what changed is how Postgres finds them.
//
// The 0.2.x trigram index (messages_body_trgm_idx) finds rare words fast, but for a common word
// Postgres fetched and sorted every match (100–300 ms on 1M messages). The new
// messages_search_recent_idx (newest first, live messages only) lets it read newest-first and
// stop after a page: a few ms. The catch: for a word that's common in OTHER people's chats but
// rare in mine, that walk reads far back (over a second). So when Postgres plans that walk, it
// gets a short time limit, and if that runs out the same query runs again the 0.7.x way (plain
// index scans off: the trigram / per-chat bitmap plans). Numbers: drizzle-pending/search-limits.sql.

const FAST_TRY_MS = 100;

/** Messages matching `where`, newest first (ties by id), at most `limit`. */
export async function searchMessages(where: SQL | undefined, limit: number): Promise<MessageRow[]> {
  const query = (tx: Pick<typeof db, "select">) =>
    tx.select(messageFields).from(messages).where(where).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit);
  // Only the newest-first walk can run long; any other plan is the one 0.7.x used anyway.
  const { sql: text, params } = query(db).toSQL();
  const plan = await pool.query(`explain ${text}`, params);
  const walks = plan.rows.some((r: Record<string, string>) => String(Object.values(r)[0]).includes("messages_search_recent_idx"));
  if (!walks) return query(db);
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`set local statement_timeout = ${FAST_TRY_MS}`));
      return query(tx);
    });
  } catch (err) {
    if (!timedOut(err)) throw err;
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local enable_indexscan = off`);
    return query(tx);
  });
}

/** Postgres's "canceling statement due to statement timeout" (57014), possibly wrapped by drizzle. */
function timedOut(err: unknown): boolean {
  let e = err as { code?: unknown; cause?: unknown } | undefined;
  for (let i = 0; e && i < 3; i++) {
    if (e.code === "57014") return true;
    e = e.cause as typeof e;
  }
  return false;
}

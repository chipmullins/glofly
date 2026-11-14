import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db";

// Applies any new migrations from the drizzle/ folder, then exits.
// The live server runs this on every start (before the server itself), so a
// release that adds a migration needs no separate step. Locally, keep using
// `npm run db:migrate`.
//
// Rule for releases: migrations only ever ADD (new tables, new columns with
// defaults). Removing something waits a release, so the previous app and
// server version keep working and rolling back is just redeploying.

const folder = process.env.MIGRATIONS_DIR ?? "drizzle";

// Indexes on big tables, built with CREATE INDEX CONCURRENTLY: that doesn't block sending
// messages while it builds, but can't run inside a migration (drizzle wraps each in a
// transaction). Each is also in db/schema.ts (so drizzle-kit knows it) and its migration says
// CREATE INDEX IF NOT EXISTS. They're built BEFORE the migrations when their table already
// exists (a live database: the migration's statement then finds the index and does nothing),
// and after them otherwise (a new database: the migration built it, on an empty table).
// Only ever add here; every later start is a quick check.
const concurrentIndexes: { name: string; sql: string }[] = [
  {
    // 0.8.0 faster search (messages/search.ts).
    name: "messages_search_recent_idx",
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_search_recent_idx" ON "messages" USING btree ("created_at" DESC, "id" DESC) WHERE "messages"."deleted_at" is null and "messages"."event" is null`,
  },
  // Robustness round (Nov 14, migration 0066): the bigger tables' foreign keys to users and messages,
  // so deleting an account or a message doesn't scan them.
  { name: "message_reactions_user_idx", sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id")` },
  { name: "poll_votes_user_idx", sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "poll_votes_user_idx" ON "poll_votes" USING btree ("user_id")` },
  { name: "calls_caller_idx", sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_caller_idx" ON "calls" USING btree ("caller_id")` },
  { name: "calls_message_idx", sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "calls_message_idx" ON "calls" USING btree ("message_id")` },
];

async function buildConcurrentIndexes(): Promise<void> {
  const client = await pool.connect();
  try {
    for (const index of concurrentIndexes) {
      const table = /\bON "(\w+)"/.exec(index.sql)?.[1];
      const { rows: exists } = await client.query(`select to_regclass($1) is not null as yes`, [`public.${table}`]);
      if (!exists[0]?.yes) continue;
      // A build that was interrupted (a crash, a deploy) leaves an INVALID index behind that
      // IF NOT EXISTS would skip forever: drop it and build again.
      const { rows } = await client.query<{ valid: boolean }>(
        `select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid
         where c.relname = $1 and c.relnamespace = 'public'::regnamespace`,
        [index.name],
      );
      if (rows[0]?.valid) continue;
      if (rows[0]) {
        console.log(`Index ${index.name} was left unfinished; building it again.`);
        await client.query(`DROP INDEX CONCURRENTLY IF EXISTS "${index.name}"`);
      }
      const started = Date.now();
      await client.query(index.sql);
      console.log(`Built index ${index.name} in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    }
  } finally {
    client.release();
  }
}

buildConcurrentIndexes()
  .then(() => migrate(db, { migrationsFolder: folder }))
  .then(buildConcurrentIndexes)
  .then(async () => {
    console.log("Database is up to date.");
    await pool.end();
  })
  .catch(async (err) => {
    console.error("Migration failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });

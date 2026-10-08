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

migrate(db, { migrationsFolder: folder })
  .then(async () => {
    console.log("Database is up to date.");
    await pool.end();
  })
  .catch(async (err) => {
    console.error("Migration failed:", err);
    await pool.end().catch(() => {});
    process.exit(1);
  });

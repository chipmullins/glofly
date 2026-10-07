import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Add it to the .env file in the glofly folder.");
}

// A pool keeps a few database connections open and reuses them.
export const pool = new Pool({
  connectionString,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
});

// An idle connection dropping (database restart, network blip) shouldn't crash the server;
// the pool simply opens a new one next time.
pool.on("error", (err) => console.error("Database connection error:", err.message));

// Use `db` for all queries. Drizzle sends values separately from the SQL,
// which prevents SQL injection.
export const db = drizzle(pool, { schema });

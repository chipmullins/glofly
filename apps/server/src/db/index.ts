import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Add it to the .env file in the glofly folder.");
}

// Live server: Amazon RDS, reached over an encrypted connection whose certificate
// is checked against Amazon's own certificate list (DATABASE_CA_FILE, baked into
// the Docker image). Locally: plain connection to Docker's Postgres.
const caFile = process.env.DATABASE_CA_FILE?.trim();
const ssl = caFile ? { ca: readFileSync(caFile, "utf8"), rejectUnauthorized: true } : undefined;

// A pool keeps a few database connections open and reuses them.
export const pool = new Pool({
  connectionString,
  ssl,
  // Give up on a connection after 10s with a clear error instead of waiting forever
  // (e.g. a firewall rule blocking the database).
  connectionTimeoutMillis: 10_000,
  max: Number(process.env.DATABASE_POOL_MAX) || 10,
});

// An idle connection dropping (database restart, network blip) shouldn't crash the server;
// the pool simply opens a new one next time.
pool.on("error", (err) => console.error("Database connection error:", err.message));

// Use `db` for all queries. Drizzle sends values separately from the SQL,
// which prevents SQL injection.
export const db = drizzle(pool, { schema });

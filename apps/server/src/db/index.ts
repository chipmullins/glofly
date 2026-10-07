import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is missing. Add it to the .env file in the glofly folder.");
}

// A pool keeps a few database connections open and reuses them.
export const pool = new Pool({ connectionString, max: 10 });

// Use `db` for all queries. Drizzle sends values separately from the SQL,
// which prevents SQL injection.
export const db = drizzle(pool, { schema });

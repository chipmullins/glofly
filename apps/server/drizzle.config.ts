import { defineConfig } from "drizzle-kit";
import { branchDatabaseUrl } from "./src/db/branchDatabase";

// drizzle-kit runs outside the server, so load the root .env here.
process.loadEnvFile("../../.env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // constellations branch: .env.constellations (its own test database) wins when it's there
    url: branchDatabaseUrl() ?? process.env.DATABASE_URL!,
  },
});

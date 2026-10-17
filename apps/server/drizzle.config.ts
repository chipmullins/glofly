import { defineConfig } from "drizzle-kit";

// drizzle-kit runs outside the server, so load the root .env here.
process.loadEnvFile("../../.env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

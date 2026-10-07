import express from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

const app = express();
const PORT = 4000;

app.get("/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", app: "Glofly", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", app: "Glofly", database: "unreachable" });
  }
});

app.listen(PORT, () => {
  console.log(`Glofly server running at http://localhost:${PORT}`);
});

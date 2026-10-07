import { createServer } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { authRouter } from "./auth/routes";
import { blocksRouter, friendsRouter, usersRouter } from "./friends/routes";
import { conversationsRouter } from "./messages/routes";
import { avatarsRouter, profileRouter } from "./profile/routes";
import { sweepUnsentUploads } from "./messages/attachments";
import { startRealtime } from "./realtime";
import { connectRedis } from "./redis";

const app = express();
const PORT = 4000;

app.use(helmet()); // standard security headers; also hides that this is Express
app.use(express.json({ limit: "10kb" })); // rejects oversized request bodies

app.get("/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", app: "Glofly", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", app: "Glofly", database: "unreachable" });
  }
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/users", profileRouter);
app.use("/avatars", avatarsRouter);
app.use("/friends", friendsRouter);
app.use("/blocks", blocksRouter);
app.use("/conversations", conversationsRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

// Last stop for anything that went wrong. Details go to the server log,
// never to the user, so internal information doesn't leak.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === "number" && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  if (status === 413) {
    res.status(413).json({ error: "too_large", message: "That file is too big." });
    return;
  }
  res.status(status).json({ error: status === 500 ? "server_error" : "bad_request" });
};
app.use(errorHandler);

// One server handles both the API and the real-time connection.
const server = createServer(app);
startRealtime(server);

connectRedis()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Glofly server running at http://localhost:${PORT}`);
    });
    // Files added to a chat but never sent are cleared out after an hour.
    setInterval(() => {
      sweepUnsentUploads().catch((err) => console.error("Upload cleanup failed", err));
    }, 10 * 60 * 1000);
  })
  .catch((err) => {
    console.error("Couldn't connect to Redis. Is Docker running? (docker compose up -d)", err);
    process.exit(1);
  });

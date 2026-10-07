import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { authRouter } from "./auth/routes";
import { blocksRouter, friendsRouter, usersRouter } from "./friends/routes";

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
app.use("/friends", friendsRouter);
app.use("/blocks", blocksRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "not_found" });
});

// Last stop for anything that went wrong. Details go to the server log,
// never to the user, so internal information doesn't leak.
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = typeof err?.status === "number" && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? "server_error" : "bad_request" });
};
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Glofly server running at http://localhost:${PORT}`);
});

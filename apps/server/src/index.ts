import { createServer } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { authRouter } from "./auth/routes";
import { accountRouter } from "./account/routes";
import { purgeDeletedAccounts } from "./account/deletion";
import { blocksRouter, friendsRouter, usersRouter } from "./friends/routes";
import { conversationsRouter } from "./messages/routes";
import { extrasRouter } from "./messages/extras";
import { gifsRouter, gifsConfigured } from "./messages/gifs";
import { sweepLanterns } from "./messages/lanterns";
import { callsRouter } from "./calls/routes";
import { watchPageRouter } from "./calls/player";
import { sweepCalls } from "./calls/service";
import { livekitConfigured } from "./calls/livekit";
import { avatarsRouter, profileRouter } from "./profile/routes";
import { sweepUnsentUploads } from "./messages/attachments";
import { startRealtime } from "./realtime";
import { connectRedis } from "./redis";
import { storageKind } from "./storage";
import { pausedPage, webRouter } from "./web/pages";
import { WEB_ORIGIN, webCors } from "./web/session";
import { getPause, refuseWhilePaused } from "./admin/pause";
import { emailKind } from "./email/send";
import { sweepEmailTokens } from "./email/tokens";
import { controlRouter } from "./admin";
import { devicesRouter } from "./push/devices";
import { pushKind } from "./push/fcm";
import { voipKind } from "./push/apns";
import { noticesRouter, purgeOldReports, reportsRouter } from "./safety/routes";

const app = express();
const PORT = Number(process.env.PORT) || 4000;

// Live server: Caddy sits in front and handles https, so the real visitor's address
// arrives in X-Forwarded-For. Trusting exactly one hop keeps per-IP rate limits
// working without letting anyone fake their address. Off when developing.
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);

// Standard security headers; also hides that this is Express. Photos and voice messages may be
// shown by other glofly.app pages (the web app at chat.glofly.app), never by other websites.
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
// Glofly in a browser: CORS for chat.glofly.app only (off unless WEB_ORIGIN is set). Before the
// pause gate, so the web app can read "Glofly is paused" too.
app.use(webCors);
app.use(express.json({ limit: "10kb" })); // rejects oversized request bodies

app.get("/health", async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
    res.json({ status: "ok", app: "Glofly", database: "connected" });
  } catch {
    res.status(503).json({ status: "error", app: "Glofly", database: "unreachable" });
  }
});

// Is Glofly paused? (Control → Server → Pause Glofly.) Apps showing "Glofly is paused" ask this
// every 30 seconds; it's the one public question that's always answered.
app.get("/status", async (_req, res) => {
  const pause = await getPause();
  res.set("Cache-Control", "no-store");
  res.json(pause.paused ? { paused: true, message: pause.message, since: pause.since } : { paused: false });
});

// While paused, everything below answers 503 "paused" (except Control).
app.use(refuseWhilePaused(pausedPage));

app.use("/auth", authRouter);
app.use("/account", accountRouter);
app.use("/users", usersRouter);
app.use("/users", profileRouter);
app.use("/avatars", avatarsRouter);
app.use("/friends", friendsRouter);
app.use("/blocks", blocksRouter);
app.use("/conversations", conversationsRouter);
// 0.5.0: polls, mini games, link preview pictures, firefly swarms (messages/extras.ts); GIFs.
app.use("/conversations", extrasRouter);
app.use("/gifs", gifsRouter);
app.use("/calls", callsRouter);
// Watch Together's video player page (the apps show the shared YouTube video through it).
app.use("/watch", watchPageRouter);
app.use("/reports", reportsRouter);
app.use("/notices", noticesRouter);
// Phones: where to send push notifications.
app.use("/devices", devicesRouter);
// Glofly Control (admin app): only from the admin's network, separate sign-in with a code.
app.use("/admin", controlRouter);
// Pages opened from emails (glofly.app/reset, /confirm). Plain HTML, not JSON.
app.use(webRouter);

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
      console.log(`Glofly server running at http://localhost:${PORT} (files: ${storageKind}; emails: ${emailKind})`);
      console.log(WEB_ORIGIN ? `Glofly in a browser: ${WEB_ORIGIN}` : "Glofly in a browser is off: set WEB_ORIGIN to turn it on.");
      if (!livekitConfigured) console.log("Calls are off: add the LIVEKIT_ settings to .env to turn them on.");
      console.log(gifsConfigured ? "GIFs: GIPHY" : "GIFs are off: set GIPHY_API_KEY to turn them on.");
      console.log(
        pushKind === "off"
          ? "Push notifications are off: set FCM_SERVICE_ACCOUNT_FILE to turn them on."
          : `Push notifications: ${pushKind}`,
      );
      console.log(
        voipKind === "off"
          ? "iPhone lock-screen calls are off: set APNS_KEY_FILE, APNS_KEY_ID and APNS_TEAM_ID to turn them on."
          : `iPhone lock-screen calls: ${voipKind}`,
      );
    });
    // Calls nobody answered become missed; calls someone dropped out of are ended.
    setInterval(() => {
      sweepCalls().catch((err) => console.error("Call check failed", err));
    }, 15 * 1000);
    // Lantern messages fade once everyone else has read them (0.5.0).
    setInterval(() => {
      sweepLanterns().catch((err) => console.error("Lantern check failed", err));
    }, 5 * 1000);
    // Files added to a chat but never sent are cleared out after an hour.
    setInterval(() => {
      sweepUnsentUploads().catch((err) => console.error("Upload cleanup failed", err));
    }, 10 * 60 * 1000);
    // Deleted accounts are removed for good once their 30 days are up (checked hourly).
    const purge = () =>
      purgeDeletedAccounts().catch((err) => console.error("Account removal failed", err));
    purge();
    setInterval(purge, 60 * 60 * 1000);
    // Expired email links are cleared out (hourly).
    const sweepLinks = () =>
      sweepEmailTokens().catch((err) => console.error("Email link cleanup failed", err));
    sweepLinks();
    setInterval(sweepLinks, 60 * 60 * 1000);
    // Resolved reports are removed a year after they were resolved (hourly).
    const sweepReports = () =>
      purgeOldReports().catch((err) => console.error("Report cleanup failed", err));
    sweepReports();
    setInterval(sweepReports, 60 * 60 * 1000);
  })
  .catch((err) => {
    console.error("Couldn't connect to Redis. Is Docker running? (docker compose up -d)", err);
    process.exit(1);
  });

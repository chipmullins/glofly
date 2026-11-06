import { createServer } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { sql } from "drizzle-orm";
import { db, pool } from "./db";
import { qrAccountRouter, qrAuthRouter, qrPageRouter } from "./auth/qr";
import { twoStepRouter } from "./auth/twoStep";
import { errorReportsRouter, recordServerError } from "./errors";
import { chatToolsRouter, sendDueMessages } from "./messages/chatTools";
import { authRouter } from "./auth/routes";
import { accountRouter } from "./account/routes";
import { purgeDeletedAccounts } from "./account/deletion";
import { blocksRouter, friendsRouter, usersRouter } from "./friends/routes";
// 0.8.0: shareable friend invite links (/friends/link, and the page glofly.app/i/<code>).
import { friendLinkPageRouter, friendLinkRouter } from "./friends/links";
import { conversationsRouter } from "./messages/routes";
import { extrasRouter } from "./messages/extras";
import { gifsRouter, gifsConfigured } from "./messages/gifs";
import { sweepLanterns } from "./messages/lanterns";
import { socialRouter, sweepHangs } from "./social/routes";
import { sweepBirthdays } from "./social/birthdays";
import { stickersRouter } from "./stickers/routes";
import { broadcastsRouter, sweepBroadcasts } from "./broadcasts/routes";
import { callsRouter } from "./calls/routes";
import { constellationsRouter } from "./constellations/routes";
import { invitePageRouter, sweepConstellationBirthdays } from "./constellations/community";
// 0.8.0 community tools: search, events with RSVP, AutoMod lite, the Inbox.
import { communityToolsRouter } from "./constellations/communityTools";
import { sweepEvents } from "./constellations/events";
import { myGamesRouter, sweepPlaytime } from "./games/routes";
import { watchPageRouter } from "./calls/player";
import { sweepCalls } from "./calls/service";
import { saveSentBytes } from "./admin/usage";
import { livekitConfigured } from "./calls/livekit";
import { avatarsRouter, profileRouter } from "./profile/routes";
import { sweepUnsentUploads } from "./messages/attachments";
import { startRealtime, stopRealtime } from "./realtime";
import { connectRedis, redis } from "./redis";
import { storageKind } from "./storage";
import { pausedPage, webRouter } from "./web/pages";
import { WEB_ORIGIN, webCors } from "./web/session";
import { getPause, refuseWhilePaused } from "./admin/pause";
import { emailKind } from "./email/send";
import { sweepEmailTokens } from "./email/tokens";
import { controlRouter } from "./admin";
import { heartbeat, noteStopping, recordStartup } from "./admin/ops";
import { sweepAlerts } from "./admin/alerts";
import { sweepExpiredStatuses } from "./statusSweep";
import { devicesRouter } from "./push/devices";
import { pushKind } from "./push/fcm";
import { voipKind } from "./push/apns";
import { integrationsRouter } from "./integrations/routes";
import { botApiRouter } from "./integrations/api";
import { incomingHooksRouter } from "./integrations/webhooks";
import { interactionsRouter } from "./integrations/interactions";
import { sweepIntegrationActivity } from "./integrations/keys";
import { noticesRouter, purgeOldReports, reportsRouter } from "./safety/routes";

/** Runs a background job every so often, never two runs of it at once. */
function every(ms: number, name: string, job: () => Promise<void>): void {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    job()
      .catch((err) => console.error(`${name} failed`, err))
      .finally(() => {
        running = false;
      });
  }, ms);
}

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
app.use(
  express.json({
    limit: "10kb", // rejects oversized request bodies
    // 0.8.2: Control for iPhone signs its requests, body included (admin/devices.ts).
    verify: (req, _res, buf) => {
      if ((req as { url?: string }).url?.startsWith("/admin/")) (req as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

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

app.use("/auth/qr", qrAuthRouter);
app.use("/auth", authRouter);
// 0.7.3: two-step sign-in settings and approving a QR code sign-in (from a phone).
app.use("/account/two-step", twoStepRouter);
app.use("/account/qr", qrAccountRouter);
app.use("/account", accountRouter);
// 0.7.3: what a phone's camera opens from a sign-in QR code.
app.use("/qr", qrPageRouter);
// 0.7.3: the apps' error reports (Control → Errors).
app.use("/errors", errorReportsRouter);
app.use("/users", usersRouter);
app.use("/users", profileRouter);
app.use("/avatars", avatarsRouter);
// 0.8.0 (before friendsRouter: /friends/link isn't a friend's id).
app.use("/friends/link", friendLinkRouter);
app.use("/friends", friendsRouter);
app.use("/blocks", blocksRouter);
// 0.7.3: pins, mark as unread, send later (before conversationsRouter: /conversations/scheduled).
app.use("/conversations", chatToolsRouter);
app.use("/conversations", conversationsRouter);
// 0.5.0: polls, mini games, link preview pictures, firefly swarms (messages/extras.ts); GIFs.
app.use("/conversations", extrasRouter);
app.use("/gifs", gifsRouter);
// 0.5.0: glows, "Want to hang?", birthdays, Year in Glow; custom stickers; Broadcast now.
app.use("/social", socialRouter);
app.use("/stickers", stickersRouter);
app.use("/broadcasts", broadcastsRouter);
app.use("/calls", callsRouter);
// 2.0: Constellations (communities with nebulas, roles, voice rooms) and My games.
// 0.8.0: /constellations/inbox and the community tools (before the main router, so "inbox" isn't
// taken for a constellation id).
// Communities round (Nov 2026): constellation settings → Integrations (API keys for bots and game
// servers), before the main router so "integrations" is never taken for anything else.
app.use("/constellations", integrationsRouter);
app.use("/constellations", interactionsRouter);
app.use("/constellations", communityToolsRouter);
app.use("/constellations", constellationsRouter);
app.use("/games", myGamesRouter);
// Communities round: the bot API (/api/v1, "Authorization: Bot gfk_…"), for game servers and bots.
app.use(botApiRouter);
// Communities round: incoming webhooks (POST /hooks/<id>/<token> posts into one nebula).
app.use(incomingHooksRouter);
// 0.7.5: a constellation invite link's page (glofly.app/c/<code>; Caddy sends /c/* here).
app.use("/c", invitePageRouter);
// 0.8.0: a friend invite link's page (glofly.app/i/<code>; Caddy sends /i/* here).
app.use("/i", friendLinkPageRouter);
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
  if (status === 500) {
    console.error(err);
    recordServerError(err, `${_req.method} ${_req.route?.path ?? _req.baseUrl ?? ""}`.slice(0, 60));
  }
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

// A promise someone forgot to catch is logged, never allowed to take the whole server down.
process.on("unhandledRejection", (err) => console.error("Unhandled promise rejection:", err));

// Docker stops the server with SIGTERM (a deploy, a restart): stop taking new requests, close the
// live connections, let requests already running finish, then close the database and Redis.
// Anything still going after 10 seconds is cut off.
let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: shutting down.`);
  setTimeout(() => process.exit(0), 10_000).unref();
  // 0.8.2: Control's uptime history counts this as an update, not an outage.
  await noteStopping("update");
  try {
    // Closing the live connections also closes the HTTP server, once its requests are done.
    await stopRealtime();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // A moment for the disconnected devices' presence updates to reach Redis and the database.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await pool.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  } catch (err) {
    console.error("Shutdown didn't go cleanly:", err);
  }
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

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
    // 0.8.2 Control: uptime history (a heartbeat every 30 s; a gap found at startup is an outage)
    // and Control's alerts (new reports, failures, sign-ups, fast-growing constellations, the
    // morning summary), checked every minute.
    recordStartup().catch((err) => console.error("Uptime history failed", err));
    every(30_000, "Heartbeat", heartbeat);
    every(60_000, "Control alerts", sweepAlerts);
    // Calls nobody answered become missed; calls someone dropped out of are ended.
    every(15_000, "Call check", sweepCalls);
    // 0.5.0: who's watching broadcasts (and ending abandoned ones), hangs that ran out, birthday
    // reminders, and lantern messages fading once read. Each runs one at a time (never on top of
    // itself if a run takes longer than its interval).
    every(15_000, "Broadcast check", sweepBroadcasts);
    every(60_000, "Hang check", sweepHangs);
    every(60_000, "Birthday check", () => sweepBirthdays());
    every(5_000, "Lantern check", sweepLanterns);
    // 0.7.3 Send later: messages whose time has come.
    every(15_000, "Send later", async () => void (await sendDueMessages()));
    // 2.0 My games: a minute of playtime for everyone playing something right now.
    every(60_000, "Playtime", sweepPlaytime);
    every(60_000, "Usage count", saveSentBytes);
    // 0.8.0: custom statuses whose "Clear after" time has come (cheap: a partial index).
    every(15_000, "Status clear", async () => void (await sweepExpiredStatuses()));
    // 0.7.5: constellations' birthdays ("Firefly Guild turns 1 today!").
    every(10 * 60_000, "Constellation birthdays", () => sweepConstellationBirthdays());
    // 0.8.0: event reminders (15 minutes before) and starts.
    every(30_000, "Constellation events", () => sweepEvents());
    // Files added to a chat but never sent are cleared out after an hour.
    every(10 * 60 * 1000, "Upload cleanup", sweepUnsentUploads);
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
    // Communities round: Integrations → Activity is kept 30 days (hourly).
    every(60 * 60 * 1000, "Integration activity cleanup", sweepIntegrationActivity);
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

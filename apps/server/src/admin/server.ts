import { Router } from "express";
import { z } from "zod";
import { endAllCalls } from "../calls/service";
import { connectedSummary, pauseConnections, resumeConnections } from "../realtime";
import { logAction, noteSchema } from "./audit";
import { DEFAULT_PAUSE_MESSAGE, getPause, PAUSE_MESSAGE_MAX, setPause } from "./pause";
import { admin, invalid, ip } from "./routes";
import { getLockdown, notePause, noteStopping } from "./ops";

// Control → Server (0.4.0): "Pause Glofly" (the kill switch, see admin/pause.ts) and
// "Restart server".

export const serverRouter = Router();

const startedAt = new Date();

/**
 * Restarting only works where something starts the server again when it stops: the live
 * server's Docker (`restart: unless-stopped`, GLOFLY_RESTARTS=docker in deploy/docker-compose.yml).
 * On a PC running `npm run dev`, a restart would just stop it, so Control says so instead.
 */
const canRestart = (): boolean => process.env.GLOFLY_RESTARTS === "docker";

// GET /admin/server — paused or not, and how long the server has been up.
serverRouter.get("/server", async (_req, res) => {
  const pause = await getPause();
  res.json({
    pause,
    defaultPauseMessage: DEFAULT_PAUSE_MESSAGE,
    startedAt: startedAt.toISOString(),
    uptimeSec: Math.round(process.uptime()),
    canRestart: canRestart(),
    devicesConnected: (await connectedSummary()).devices,
    lockdown: await getLockdown(),
  });
});

// PUT /admin/server/pause  { paused, message?, note }
serverRouter.put("/server/pause", async (req, res) => {
  const parsed = z
    .object({
      paused: z.boolean(),
      message: z
        .string()
        .trim()
        .max(PAUSE_MESSAGE_MAX, `Keep the message under ${PAUSE_MESSAGE_MAX} characters.`)
        .optional(),
      note: noteSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const before = await getPause();
  const message = parsed.data.message || (parsed.data.paused ? DEFAULT_PAUSE_MESSAGE : before.message);

  if (parsed.data.paused) {
    // Already paused: only the message changes (apps pick it up on their next check).
    const state = await setPause(true, message);
    let devices = 0;
    let calls = 0;
    if (!before.paused) {
      calls = await endAllCalls();
      devices = await pauseConnections();
      await notePause(true).catch(() => undefined);
    }
    await logAction({
      adminId: admin(res).id,
      action: before.paused ? "Changed the pause message" : "Paused Glofly",
      targetLabel: message,
      details: before.paused ? { from: before.message, to: message } : { devices, calls },
      note: parsed.data.note,
      ip: ip(res),
    });
    res.json({
      ok: true,
      pause: state,
      message: before.paused
        ? "Pause message updated."
        : `Glofly is paused. ${devices === 1 ? "1 device was" : `${devices} devices were`} disconnected${calls ? ` and ${calls === 1 ? "1 call" : `${calls} calls`} ended` : ""}.`,
    });
    return;
  }

  if (!before.paused) {
    res.json({ ok: true, pause: before, message: "Glofly isn't paused." });
    return;
  }
  const state = await setPause(false, message);
  resumeConnections();
  await notePause(false).catch(() => undefined);
  const minutes = before.since ? Math.max(1, Math.round((Date.now() - Date.parse(before.since)) / 60_000)) : null;
  await logAction({
    adminId: admin(res).id,
    action: "Unpaused Glofly",
    details: minutes ? { pausedMinutes: minutes } : null,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, pause: state, message: "Glofly is back. Apps reconnect on their own within about 30 seconds." });
});

// POST /admin/server/restart  { note } — the server stops; Docker starts it again (5–15 s).
let restarting = false;
serverRouter.post("/server/restart", async (req, res) => {
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  if (!canRestart()) {
    res.status(409).json({
      error: "cant_restart",
      message: "This server can't restart itself (it isn't running in the live server's Docker). Restart it where it runs.",
    });
    return;
  }
  if (restarting) {
    res.status(409).json({ error: "restarting", message: "It's already restarting." });
    return;
  }
  restarting = true;
  // Logged first, so the entry is there even though this process is about to stop.
  await noteStopping("restart");
  await logAction({
    adminId: admin(res).id,
    action: "Restarted the server",
    details: { uptimeSec: Math.round(process.uptime()) },
    note: parsed.data.note,
    ip: ip(res),
  });
  // A moment for the answer to reach Control, then stop. Apps see the connection drop and
  // reconnect by themselves once it's back.
  res.on("finish", () => {
    console.log("Restarting (asked from Glofly Control).");
    setTimeout(() => process.exit(0), 750);
  });
  res.json({ ok: true, startedAt: startedAt.toISOString(), message: "Restarting. Glofly is back in about 10 seconds." });
});

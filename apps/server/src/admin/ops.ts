import { Router } from "express";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { serverSettings, uptimeEvents, users } from "../db/schema";
import { endAllCalls } from "../calls/service";
import { TIME_ZONE } from "../social/glows";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip } from "./routes";
import { getLockdown, LOCKDOWN_NEW_HOURS, saveLockdown, type LockdownState } from "./lockdown";

export { getLockdown, lockedDown, LOCKDOWN_MESSAGE } from "./lockdown";

// 0.9.0 Control tools for when things go wrong (desktop Control and Control for iPhone):
//   - Quick notes: saved reasons that fill an action's audit note in one tap
//   - Lockdown: accounts made in the last 24 hours can only talk to the friends they already have
//   - End all calls
//   - Uptime: the last 30 days of ups and downs

export const opsRouter = Router();

async function setting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, key));
  return (row?.value as T | undefined) ?? null;
}
async function saveSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(serverSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value, updatedAt: new Date() } });
}

// ───────────── Quick notes ─────────────

export const DEFAULT_QUICK_NOTES = ["Server stuck", "Spam wave", "Maintenance", "Requested by user", "Report follow-up", "Testing a fix"];
const QUICK_NOTES_MAX = 20;

export async function getQuickNotes(): Promise<string[]> {
  const v = await setting<unknown>("quickNotes");
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : DEFAULT_QUICK_NOTES;
}

opsRouter.get("/quick-notes", async (_req, res) => {
  res.json({ notes: await getQuickNotes() });
});

// PUT /admin/quick-notes  { notes: string[] }
opsRouter.put("/quick-notes", async (req, res) => {
  const parsed = z
    .object({
      notes: z
        .array(z.string().trim().min(3, "Each note needs at least 3 characters.").max(60, "Keep each note under 60 characters."))
        .max(QUICK_NOTES_MAX, `Up to ${QUICK_NOTES_MAX} quick notes.`),
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const notes = [...new Set(parsed.data.notes)];
  await saveSetting("quickNotes", notes);
  res.json({ notes });
});

// ───────────── Lockdown (state and checks in lockdown.ts) ─────────────

opsRouter.get("/server/lockdown", async (_req, res) => {
  const state = await getLockdown();
  const since = new Date(Date.now() - LOCKDOWN_NEW_HOURS * 60 * 60 * 1000);
  const affected = await db.$count(users, gte(users.createdAt, since));
  res.json({ lockdown: state, affected, hours: LOCKDOWN_NEW_HOURS });
});

// PUT /admin/server/lockdown  { on, note }
opsRouter.put("/server/lockdown", async (req, res) => {
  const parsed = z.object({ on: z.boolean(), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const before = await getLockdown();
  if (before.on === parsed.data.on) {
    res.json({ ok: true, lockdown: before, message: before.on ? "Lockdown is already on." : "Lockdown is already off." });
    return;
  }
  const state: LockdownState = { on: parsed.data.on, since: parsed.data.on ? new Date().toISOString() : null };
  await saveLockdown(state);
  const minutes = before.since ? Math.max(1, Math.round((Date.now() - Date.parse(before.since)) / 60_000)) : null;
  await logAction({
    adminId: admin(res).id,
    action: state.on ? "Turned on Lockdown" : "Turned off Lockdown",
    details: state.on ? null : { minutes },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    lockdown: state,
    message: state.on
      ? "Lockdown is on. Accounts under a day old can only talk to friends they already have."
      : "Lockdown is off. New accounts can do everything again.",
  });
});

// ───────────── End all calls ─────────────

// POST /admin/server/end-calls  { note }
opsRouter.post("/server/end-calls", async (req, res) => {
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const ended = await endAllCalls();
  await logAction({ adminId: admin(res).id, action: "Ended all calls", details: { calls: ended }, note: parsed.data.note, ip: ip(res) });
  res.json({
    ok: true,
    ended,
    message: ended ? `Ended ${ended === 1 ? "1 call" : `${ended} calls`} (voice rooms and Watch Together included).` : "Nobody was in a call.",
  });
});

// ───────────── Uptime ─────────────
//
// The server notes that it's alive every 30 seconds (server_settings "heartbeat"). When it starts,
// a gap since the last heartbeat is an outage, unless it was asked to restart (Control) or was
// stopped cleanly (an update: Docker's SIGTERM), which are noted just before it stops.

const HEARTBEAT_MS = 30_000;

export async function heartbeat(): Promise<void> {
  await saveSetting("heartbeat", { at: new Date().toISOString() });
}

/** Called just before stopping: a restart from Control, or a clean stop (an update). */
export async function noteStopping(kind: "restart" | "update"): Promise<void> {
  await saveSetting("stopping", { kind, at: new Date().toISOString() }).catch(() => undefined);
}

/** On startup: turn the gap since the last heartbeat into an uptime event. */
export async function recordStartup(): Promise<void> {
  const hb = await setting<{ at?: string }>("heartbeat");
  const stop = await setting<{ kind?: string; at?: string }>("stopping");
  const now = Date.now();
  const last = hb?.at ? Date.parse(hb.at) : NaN;
  await db.delete(serverSettings).where(eq(serverSettings.key, "stopping"));
  if (!Number.isFinite(last)) {
    await heartbeat();
    return;
  }
  const stoppedAt = stop?.at ? Date.parse(stop.at) : NaN;
  const planned = Number.isFinite(stoppedAt) && stoppedAt >= last - HEARTBEAT_MS && now - stoppedAt < 30 * 60_000;
  if (planned) {
    await db.insert(uptimeEvents).values({
      kind: stop?.kind === "restart" ? "restart" : "update",
      startedAt: new Date(stoppedAt),
      endedAt: new Date(now),
      details: null,
    });
  } else if (now - last > HEARTBEAT_MS * 1.5) {
    // Down since about the last heartbeat (it was alive up to then).
    await db.insert(uptimeEvents).values({ kind: "outage", startedAt: new Date(last), endedAt: new Date(now), details: null });
  }
  await heartbeat();
}

/** Glofly paused / unpaused from Control (server.ts). */
export async function notePause(paused: boolean): Promise<void> {
  if (paused) {
    await db.insert(uptimeEvents).values({ kind: "pause", startedAt: new Date(), endedAt: null, details: null });
  } else {
    await db.update(uptimeEvents).set({ endedAt: new Date() }).where(and(eq(uptimeEvents.kind, "pause"), isNull(uptimeEvents.endedAt)));
  }
}

const dayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The last 30 days, for Control → Server (and the phone's Home card). */
export async function uptimeReport(now = new Date()) {
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const events = await db.select().from(uptimeEvents).where(gte(uptimeEvents.startedAt, from)).orderBy(desc(uptimeEvents.startedAt));
  const days: { day: string; status: "up" | "you" | "down"; downSec: number }[] = [];
  for (let i = 29; i >= 0; i--) days.push({ day: dayOf(new Date(now.getTime() - i * 24 * 60 * 60 * 1000)), status: "up", downSec: 0 });
  let downMs = 0;
  for (const e of events) {
    const end = e.endedAt?.getTime() ?? now.getTime();
    const length = Math.max(0, end - e.startedAt.getTime());
    if (e.kind !== "pause") downMs += length;
    const d = days.find((x) => x.day === dayOf(e.startedAt));
    if (!d) continue;
    if (e.kind === "outage") {
      d.status = "down";
      d.downSec += Math.round(length / 1000);
    } else if (d.status === "up") {
      d.status = "you";
    }
    if (e.kind !== "pause" && e.kind !== "outage") d.downSec += Math.round(length / 1000);
  }
  const total = now.getTime() - from.getTime();
  return {
    percent: Math.max(0, Math.min(100, Math.floor(((total - downMs) / total) * 10000) / 100)),
    days,
    events: events.slice(0, 20).map((e) => ({
      kind: e.kind as "outage" | "restart" | "update" | "pause",
      startedAt: e.startedAt.toISOString(),
      endedAt: e.endedAt?.toISOString() ?? null,
      seconds: e.endedAt ? Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 1000) : null,
    })),
  };
}

opsRouter.get("/server/uptime", async (_req, res) => {
  res.json(await uptimeReport());
});

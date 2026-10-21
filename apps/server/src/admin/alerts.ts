import { createHash } from "node:crypto";
import { Router } from "express";
import { and, count, desc, eq, gt, gte, isNotNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { adminAlerts, adminDevices, constellationMembers, constellations, messages, reports, serverSettings, users } from "../db/schema";
import { redis } from "../redis";
import { controlAlertsConfigured, sendControlAlert } from "../push/apns";
import { failedKey } from "../email/send";
import { failedPushesToday } from "../push/fcm";
import { TIME_ZONE } from "../social/glows";
import { adminConfigured } from "./secrets";
import { invalid } from "./routes";

// 0.9.0: Control's alerts. Each one is kept (Recent alerts, desktop notifications while Control is
// open) and, if its kind is switched on, pushed to every approved phone that registered for alerts.
// Alerts never carry message text or who reported someone, so nothing private shows on a lock
// screen. "Urgent" kinds are time-sensitive (they break through Focus).

export const ALERT_KINDS = [
  "server_down",
  "control_signin",
  "report_spike",
  "report_new",
  "delivery_failures",
  "account_new",
  "constellation_growing",
  "inbox_reply",
  "morning_summary",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

const URGENT = new Set<AlertKind>(["server_down", "control_signin", "report_spike"]);

export type AlertPrefs = { kinds: Record<AlertKind, boolean>; desktop: boolean };

const DEFAULT_PREFS: AlertPrefs = {
  kinds: {
    server_down: true,
    control_signin: true,
    report_spike: true,
    report_new: true,
    delivery_failures: true,
    account_new: false,
    constellation_growing: true,
    inbox_reply: true,
    morning_summary: true,
  },
  desktop: true,
};

export async function getAlertPrefs(): Promise<AlertPrefs> {
  const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "controlAlerts"));
  const v = (row?.value ?? {}) as Partial<AlertPrefs>;
  const kinds = { ...DEFAULT_PREFS.kinds };
  for (const k of ALERT_KINDS) if (typeof v.kinds?.[k] === "boolean") kinds[k] = v.kinds[k];
  return { kinds, desktop: typeof v.desktop === "boolean" ? v.desktop : DEFAULT_PREFS.desktop };
}

/** Pushes one alert to every approved phone with alerts on. Exported for the watchdog. */
export async function pushToPhones(kind: AlertKind, title: string, body: string, data: Record<string, string> = {}): Promise<number> {
  if (!controlAlertsConfigured) return 0;
  const phones = await db
    .select({ id: adminDevices.id, token: adminDevices.pushToken })
    .from(adminDevices)
    .where(isNotNull(adminDevices.pushToken));
  let sent = 0;
  for (const p of phones) {
    const result = await sendControlAlert(p.token!, { title, body, data: { kind, ...data }, timeSensitive: URGENT.has(kind) });
    if (result === "sent") sent++;
    if (result === "gone") await db.update(adminDevices).set({ pushToken: null }).where(eq(adminDevices.id, p.id));
  }
  return sent;
}

/** Records an alert and pushes it if that kind is on. Never throws. */
export async function raiseAlert(kind: AlertKind, title: string, body: string, data: Record<string, string> = {}): Promise<void> {
  try {
    await db.insert(adminAlerts).values({ kind, title: title.slice(0, 120), body: body.slice(0, 300), data });
    const prefs = await getAlertPrefs();
    if (prefs.kinds[kind]) await pushToPhones(kind, title, body, data);
  } catch (err) {
    console.error("Couldn't send a Control alert:", err);
  }
}

// ───────────── Sign-ins (called from auth.ts) ─────────────

const hash = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 32);

/** A Control sign-in from a device/network not seen in the last 90 days. */
export function noteSignIn(s: { adminId: string; where: string; ip: string; backup: boolean }): void {
  void (async () => {
    // Phones move between networks all the time: a phone is "known" by itself.
    const place = s.where.endsWith("(phone)") ? s.where : `${s.where}|${s.ip}`;
    const key = `admin:known:${hash(`${s.adminId}|${place}`)}`;
    const seen = await redis.set(key, "1", { NX: true, EX: 90 * 24 * 60 * 60 });
    if (seen === "OK" || s.backup) {
      await raiseAlert(
        "control_signin",
        "Control sign-in somewhere new",
        `${s.where} signed in${s.backup ? " with a backup code" : ""}. Not you? Remove it in Server → Approved phones and run admin:setup.`,
      );
    }
  })().catch(() => undefined);
}

/** A wrong authenticator or backup code. At most one alert every 15 minutes. */
export function noteRefusedCode(ip: string): void {
  void (async () => {
    const first = await redis.set("admin:alert:refused", "1", { NX: true, EX: 15 * 60 });
    if (first === "OK") await raiseAlert("control_signin", "Wrong Control code", `Someone typed a wrong sign-in code (from ${ip || "an unknown address"}).`);
  })().catch(() => undefined);
}

// ───────────── The minute sweep ─────────────

const state = {
  get: async (k: string) => redis.get(`admin:alertstate:${k}`),
  set: async (k: string, v: string, ex?: number) => redis.set(`admin:alertstate:${k}`, v, ex ? { EX: ex } : undefined),
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Hour and date in Glofly's time zone. */
function localNow(now = new Date()): { hour: number; minute: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { hour: Number(get("hour")) % 24, minute: Number(get("minute")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

async function sweepReports(now: Date): Promise<void> {
  const last = new Date(Number((await state.get("reports")) ?? now.getTime()));
  await state.set("reports", String(now.getTime()));
  const fresh = await db
    .select({ id: reports.id, reason: reports.reason, username: users.username })
    .from(reports)
    .leftJoin(users, eq(users.id, reports.reportedUserId))
    .where(and(gt(reports.createdAt, last), lt(reports.createdAt, now)))
    .orderBy(reports.createdAt);
  const [{ n: lastTen }] = await db.select({ n: count() }).from(reports).where(gte(reports.createdAt, new Date(now.getTime() - 10 * 60_000)));
  if (lastTen >= 5 && (await redis.set("admin:alertstate:spike", "1", { NX: true, EX: 30 * 60 })) === "OK") {
    await raiseAlert("report_spike", "Lots of reports", `${plural(lastTen, "report")} in the last 10 minutes. Check Reports.`, { open: "reports" });
    return;
  }
  for (const r of fresh.slice(0, 3)) {
    const reason = r.reason === "self_harm" ? "self-harm" : r.reason.replace("_", " ");
    await raiseAlert("report_new", "New report", `${r.username ? `@${r.username}` : "Someone"} was reported (${reason}).`, { open: "reports", reportId: r.id });
  }
  if (fresh.length > 3) await raiseAlert("report_new", "New reports", `${fresh.length - 3} more reports came in.`, { open: "reports" });
}

async function sweepFailures(now: Date): Promise<void> {
  const emails = Number(await redis.get(failedKey(now)).catch(() => 0)) || 0;
  const pushes = await failedPushesToday();
  const day = now.toISOString().slice(0, 10);
  const before = JSON.parse((await state.get(`fail:${day}`)) ?? '{"e":0,"p":0}') as { e: number; p: number };
  if (emails <= before.e && pushes <= before.p) return;
  // Bundled: at most once an hour.
  if ((await redis.set("admin:alertstate:failhour", "1", { NX: true, EX: 60 * 60 })) !== "OK") return;
  await state.set(`fail:${day}`, JSON.stringify({ e: emails, p: pushes }), 2 * 24 * 60 * 60);
  const bits = [emails > before.e ? plural(emails, "email") : null, pushes > before.p ? plural(pushes, "push notification") : null].filter(Boolean);
  await raiseAlert("delivery_failures", "Deliveries failing", `${bits.join(" and ")} failed today.`, { open: "dashboard" });
}

async function sweepAccounts(now: Date): Promise<void> {
  const last = new Date(Number((await state.get("accounts")) ?? now.getTime()));
  await state.set("accounts", String(now.getTime()));
  const fresh = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(and(gt(users.createdAt, last), lt(users.createdAt, now)))
    .limit(6);
  if (fresh.length > 3) {
    await raiseAlert("account_new", "New accounts", `${fresh.length >= 6 ? "6 or more" : fresh.length} people made accounts.`, { open: "accounts" });
    return;
  }
  for (const u of fresh) await raiseAlert("account_new", "New account", `@${u.username} joined Glofly.`, { open: "accounts", userId: u.id });
}

export const GROWING_JOINS_PER_HOUR = 25;

async function sweepGrowth(now: Date): Promise<void> {
  const rows = await db
    .select({ id: constellations.id, name: constellations.name, joins: count() })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(gte(constellationMembers.joinedAt, new Date(now.getTime() - 60 * 60_000)))
    .groupBy(constellations.id, constellations.name)
    .having(sql`count(*) >= ${GROWING_JOINS_PER_HOUR}`);
  for (const r of rows) {
    if ((await redis.set(`admin:alertstate:grow:${r.id}`, "1", { NX: true, EX: 6 * 60 * 60 })) !== "OK") continue;
    await raiseAlert("constellation_growing", "A constellation is growing fast", `${r.name}: ${r.joins} people joined in the last hour.`, { open: "constellations", constellationId: r.id });
  }
}

/** Yesterday in numbers, at 9:00 in Glofly's time zone. */
export async function morningSummaryText(now = new Date()): Promise<string> {
  const since = new Date(now.getTime() - 24 * 60 * 60_000);
  const [m] = await db.select({ n: count() }).from(messages).where(gte(messages.createdAt, since));
  const [u] = await db.select({ n: count() }).from(users).where(gte(users.createdAt, since));
  const [r] = await db.select({ n: count() }).from(reports).where(gte(reports.createdAt, since));
  const [open] = await db.select({ n: count() }).from(reports).where(eq(reports.status, "open"));
  return `Last 24 hours: ${plural(m.n, "message")}, ${plural(u.n, "new account")}, ${plural(r.n, "report")}${open.n ? ` (${open.n} still open)` : ""}.`;
}

async function sweepMorning(now: Date): Promise<void> {
  const local = localNow(now);
  if (local.hour !== 9 || local.minute > 10) return;
  if ((await redis.set(`admin:alertstate:morning:${local.day}`, "1", { NX: true, EX: 2 * 24 * 60 * 60 })) !== "OK") return;
  await raiseAlert("morning_summary", "Good morning", await morningSummaryText(now), { open: "dashboard" });
}

/** Every minute (index.ts). Each part on its own, so one failing doesn't stop the others. */
export async function sweepAlerts(): Promise<void> {
  if (!adminConfigured()) return;
  const now = new Date();
  for (const part of [sweepReports, sweepFailures, sweepAccounts, sweepGrowth, sweepMorning]) {
    await part(now).catch((err) => console.error("Control alerts:", err));
  }
  if (now.getUTCMinutes() === 0) {
    await db.delete(adminAlerts).where(lt(adminAlerts.createdAt, new Date(now.getTime() - 30 * 24 * 60 * 60_000))).catch(() => undefined);
  }
}

// ───────────── Routes ─────────────

export const alertsRouter = Router();

// GET /admin/alerts?after=<iso> — the newest 50 (or the ones after a time), and the settings.
alertsRouter.get("/alerts", async (req, res) => {
  const after = z.iso.datetime({ offset: true }).safeParse(req.query.after);
  const rows = await db
    .select()
    .from(adminAlerts)
    .where(after.success ? gt(adminAlerts.createdAt, new Date(after.data)) : undefined)
    .orderBy(desc(adminAlerts.createdAt))
    .limit(50);
  res.json({
    alerts: rows.map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, data: a.data ?? {}, createdAt: a.createdAt.toISOString() })),
    prefs: await getAlertPrefs(),
    pushReady: controlAlertsConfigured,
    now: new Date().toISOString(),
  });
});

// PUT /admin/alerts/prefs  { kinds?: {...}, desktop?: boolean }
alertsRouter.put("/alerts/prefs", async (req, res) => {
  const parsed = z
    .object({
      kinds: z.partialRecord(z.enum(ALERT_KINDS), z.boolean()).optional(),
      desktop: z.boolean().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const before = await getAlertPrefs();
  const next: AlertPrefs = { kinds: { ...before.kinds, ...parsed.data.kinds }, desktop: parsed.data.desktop ?? before.desktop };
  await db
    .insert(serverSettings)
    .values({ key: "controlAlerts", value: next })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value: next, updatedAt: new Date() } });
  res.json({ prefs: next });
});

// POST /admin/alerts/test — a test push to this account's phones.
alertsRouter.post("/alerts/test", async (_req, res) => {
  if (!controlAlertsConfigured) {
    res.status(409).json({ error: "push_off", message: "Alerts to phones are off on this server: set APNS_KEY_FILE, APNS_KEY_ID and APNS_TEAM_ID." });
    return;
  }
  const sent = await pushToPhones("morning_summary", "Test alert", "Alerts from Glofly Control reach this phone.");
  res.json({ ok: true, sent, message: sent ? `Sent to ${plural(sent, "phone")}.` : "No phone has alerts turned on yet. Open Control on your iPhone and allow notifications." });
});

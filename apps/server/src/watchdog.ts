import { eq, isNotNull } from "drizzle-orm";
import { db, pool } from "./db";
import { adminAlerts, adminDevices, serverSettings } from "./db/schema";
import { controlAlertsConfigured, sendControlAlert } from "./push/apns";

// 0.8.2: the watchdog (its own small service in deploy/docker-compose.yml: `node dist/watchdog.js`).
// It asks the Glofly server's /health every 30 seconds. When the server hasn't answered for about a
// minute and a half, it pushes "Server isn't answering" to the admin's approved phones (Control for
// iPhone), and "Server is back" once it answers again. A restart from Control or an update (both
// note themselves just before stopping) gets 10 minutes of grace before it counts.
//
// It keeps a copy of the phones' alert addresses and the alert settings from the last time the
// database answered, so it can still warn when the database is what's broken. (If the whole machine
// is down, the watchdog is down with it: that needs a monitor somewhere else.)

const URL = process.env.WATCHDOG_URL?.trim() || "http://server:4000/health";
const EVERY_MS = Number(process.env.WATCHDOG_EVERY_MS) || 30_000; // (shorter only for testing)
const FAILS_BEFORE_ALERT = 3;
const GRACE_MS = 10 * 60_000;


let tokens: { id: string; token: string }[] = [];
let alertsOn = true;
let fails = 0;
let firstFailAt: number | null = null;
let down = false;

async function refreshFromDatabase(): Promise<void> {
  try {
    const rows = await db.select({ id: adminDevices.id, token: adminDevices.pushToken }).from(adminDevices).where(isNotNull(adminDevices.pushToken));
    tokens = rows.map((r) => ({ id: r.id, token: r.token! }));
    const [prefs] = await db.select().from(serverSettings).where(eq(serverSettings.key, "controlAlerts"));
    const kinds = (prefs?.value as { kinds?: Record<string, boolean> } | undefined)?.kinds;
    alertsOn = kinds?.server_down !== false;
  } catch {
    // Keep what we had.
  }
}

async function plannedStopRecently(): Promise<boolean> {
  try {
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "stopping"));
    const at = Date.parse((row?.value as { at?: string } | null)?.at ?? "");
    return Number.isFinite(at) && Date.now() - at < GRACE_MS;
  } catch {
    return false;
  }
}

async function alert(title: string, body: string): Promise<void> {
  console.log(`Watchdog: ${title}. ${body}`);
  try {
    await db.insert(adminAlerts).values({ kind: "server_down", title, body, data: { open: "server" } });
  } catch {
    // The database may be what's down.
  }
  if (!alertsOn || !controlAlertsConfigured) return;
  for (const t of tokens) {
    const result = await sendControlAlert(t.token, { title, body, data: { kind: "server_down", open: "server" }, timeSensitive: true });
    if (result === "gone") await db.update(adminDevices).set({ pushToken: null }).where(eq(adminDevices.id, t.id)).catch(() => undefined);
  }
}

const minutes = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m === 1 ? "about a minute" : `${m} minutes`;
};

async function check(): Promise<void> {
  let ok = false;
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(10_000) });
    ok = response.status === 200;
  } catch {
    ok = false;
  }
  if (ok) {
    if (down && firstFailAt) await alert("Server is back", `Glofly answers again after ${minutes(Date.now() - firstFailAt)}.`);
    fails = 0;
    firstFailAt = null;
    down = false;
    await refreshFromDatabase();
    return;
  }
  fails++;
  firstFailAt ??= Date.now();
  if (down || fails < FAILS_BEFORE_ALERT) return;
  if (Date.now() - firstFailAt < GRACE_MS && (await plannedStopRecently())) return;
  down = true;
  await alert("Server isn't answering", `Down for ${minutes(Date.now() - firstFailAt)}. Open Control to check, restart or pause.`);
}

let running = false;
async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await check();
  } catch (err) {
    console.error("Watchdog check failed:", err);
  } finally {
    running = false;
  }
}

console.log(`Watchdog: watching ${URL} every ${EVERY_MS / 1000} s${controlAlertsConfigured ? "" : " (alerts to phones are off: no APNS_ settings)"}.`);
void refreshFromDatabase();
void tick();
setInterval(() => void tick(), EVERY_MS);
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    void pool.end().finally(() => process.exit(0));
  });
}

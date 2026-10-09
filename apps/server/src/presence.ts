import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "./db";
import { friendships, users } from "./db/schema";
import { redis } from "./redis";

// Who's online, away, busy or offline.
//
// Each connected device is recorded in Redis with a timestamp that the server refreshes
// every 30 seconds. If a device vanishes without saying goodbye (crash, lost Wi-Fi, the
// server restarting), its entry simply goes stale and stops counting after 90 seconds.

export type Status = "online" | "away" | "dnd" | "offline";
/** "Playing Guild Wars 2", since when (ISO date). */
export type Activity = { name: string; since: string };
export type Presence = {
  status: Status;
  statusText: string | null;
  lastSeenAt: string | null;
  /** What they're playing right now, if they share it (null while offline or invisible). */
  activity: Activity | null;
};

const DEVICE_TTL_MS = 90_000;
const devicesKey = (userId: string) => `presence:devices:${userId}`; // every connected device
const activeKey = (userId: string) => `presence:active:${userId}`; // devices someone is using
const lastSentKey = (userId: string) => `presence:last:${userId}`; // what friends were last told
const NOT_OFFLINE = "presence:not-offline"; // people currently shown as online/away/busy
// What each device says its person is playing. Refreshed with the 30-second heartbeat, so a
// device that vanishes stops sharing its game within 90 seconds.
const activityKey = (userId: string, deviceId: string) => `presence:activity:${userId}:${deviceId}`;
const activityDevicesKey = (userId: string) => `presence:activity-devices:${userId}`;
const ACTIVITY_TTL_S = 90;
const ACTIVITY_NAME_MAX = 64;

async function liveCount(key: string): Promise<number> {
  const now = Date.now();
  await redis.zRemRangeByScore(key, 0, now - DEVICE_TTL_MS);
  return redis.zCard(key);
}

export async function deviceConnected(userId: string, deviceId: string): Promise<void> {
  const now = Date.now();
  await redis.zAdd(devicesKey(userId), { score: now, value: deviceId });
  await redis.zAdd(activeKey(userId), { score: now, value: deviceId }); // new devices start active
}

/** Called every 30 seconds for each connected device. */
export async function deviceHeartbeat(userId: string, deviceId: string, idle: boolean): Promise<void> {
  const now = Date.now();
  await redis.zAdd(devicesKey(userId), { score: now, value: deviceId });
  await redis.expire(activityKey(userId, deviceId), ACTIVITY_TTL_S);
  if (idle) await redis.zRem(activeKey(userId), deviceId);
  else await redis.zAdd(activeKey(userId), { score: now, value: deviceId });
}

export async function deviceIdle(userId: string, deviceId: string, idle: boolean): Promise<void> {
  if (idle) await redis.zRem(activeKey(userId), deviceId);
  else await redis.zAdd(activeKey(userId), { score: Date.now(), value: deviceId });
}

export async function deviceDisconnected(userId: string, deviceId: string): Promise<void> {
  await redis.zRem(devicesKey(userId), deviceId);
  await redis.del(activityKey(userId, deviceId));
  await redis.sRem(activityDevicesKey(userId), deviceId);
  await redis.zRem(activeKey(userId), deviceId);
  if ((await liveCount(devicesKey(userId))) === 0) {
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  }
}

/**
 * A game name as the app sent it, made safe to show: trimmed, one line, no hidden or
 * direction-changing characters, at most 64 characters. Null if nothing's left.
 */
export function cleanActivityName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .replace(/[\t\n\r]/g, " ") // line breaks become spaces
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return null;
  return [...name].slice(0, ACTIVITY_NAME_MAX).join("");
}

/**
 * This device's game (or null: not playing). Returns true if it changed. Starting the same
 * game again keeps its "since", so the time played doesn't reset on a reconnect.
 */
export async function setDeviceActivity(
  userId: string,
  deviceId: string,
  name: string | null,
): Promise<boolean> {
  const key = activityKey(userId, deviceId);
  const before = await redis.get(key);
  const previous = before ? (JSON.parse(before) as Activity) : null;
  if (!name) {
    if (!previous) return false;
    await redis.del(key);
    await redis.sRem(activityDevicesKey(userId), deviceId);
    return true;
  }
  if (previous?.name === name) {
    await redis.expire(key, ACTIVITY_TTL_S);
    return false;
  }
  const activity: Activity = { name, since: new Date().toISOString() };
  await redis.set(key, JSON.stringify(activity), { EX: ACTIVITY_TTL_S });
  await redis.sAdd(activityDevicesKey(userId), deviceId);
  return true;
}

/** What someone's playing on any of their devices (the game started first wins). */
async function activityOf(userId: string): Promise<Activity | null> {
  let found: Activity | null = null;
  for (const deviceId of await redis.sMembers(activityDevicesKey(userId))) {
    const raw = await redis.get(activityKey(userId, deviceId));
    if (!raw) {
      await redis.sRem(activityDevicesKey(userId), deviceId); // expired: that device is gone
      continue;
    }
    const activity = JSON.parse(raw) as Activity;
    if (!found || activity.since < found.since) found = activity;
  }
  return found;
}

/** What friends see for each of these people. */
export async function presenceOf(userIds: string[]): Promise<Map<string, Presence>> {
  const result = new Map<string, Presence>();
  if (!userIds.length) return result;
  const rows = await db
    .select({
      id: users.id,
      statusPreference: users.statusPreference,
      statusText: users.statusText,
      lastSeenAt: users.lastSeenAt,
      showLastSeen: users.showLastSeen,
    })
    .from(users)
    .where(inArray(users.id, userIds));

  for (const row of rows) {
    const connected = (await liveCount(devicesKey(row.id))) > 0;
    const active = connected && (await liveCount(activeKey(row.id))) > 0;
    let status: Status;
    if (!connected || row.statusPreference === "invisible") status = "offline";
    else if (row.statusPreference === "dnd") status = "dnd";
    else if (row.statusPreference === "away" || !active) status = "away";
    else status = "online";

    result.set(row.id, {
      status,
      // Custom status only shows while they're around.
      statusText: status === "offline" ? null : row.statusText,
      // Invisible people, and anyone who turned off "Show when I was last online",
      // don't reveal when they were last seen.
      lastSeenAt:
        status === "offline" && row.statusPreference !== "invisible" && row.showLastSeen
          ? (row.lastSeenAt?.toISOString() ?? null)
          : null,
      // Invisible looks offline, so it never shows a game either.
      activity: status === "offline" ? null : await activityOf(row.id),
    });
  }
  return result;
}

export async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ low: friendships.userLow, high: friendships.userHigh })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, "accepted"),
        or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)),
      ),
    );
  return rows.map((r) => (r.low === userId ? r.high : r.low));
}

type Emit = (userId: string, event: string, payload: unknown) => void;

/**
 * Works out what friends should see for this person, and tells them if it changed.
 * `force` sends it even if unchanged (e.g. to someone who just became a friend).
 */
export async function announcePresence(userId: string, emit: Emit, force = false): Promise<void> {
  const presence = (await presenceOf([userId])).get(userId);
  if (!presence) return;
  const serialized = JSON.stringify(presence);
  const previous = await redis.get(lastSentKey(userId));
  if (!force && previous === serialized) return;
  await redis.set(lastSentKey(userId), serialized, { EX: 7 * 24 * 60 * 60 });

  if (presence.status === "offline") await redis.sRem(NOT_OFFLINE, userId);
  else await redis.sAdd(NOT_OFFLINE, userId);

  const payload = { userId, ...presence };
  emit(userId, "presence", payload); // your other devices
  for (const friendId of await friendIdsOf(userId)) emit(friendId, "presence", payload);
}

/**
 * Safety net, run every 30 seconds: anyone shown as online whose devices have all gone
 * stale (a crash or lost connection) is switched to offline for their friends.
 */
export async function sweepStalePresence(emit: Emit): Promise<void> {
  for (const userId of await redis.sMembers(NOT_OFFLINE)) {
    if ((await liveCount(devicesKey(userId))) === 0) {
      // Their devices vanished without disconnecting; record when we last heard from them.
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
    }
    await announcePresence(userId, emit);
  }
}

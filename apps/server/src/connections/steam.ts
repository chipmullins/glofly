// 0.9.3 Steam linking: Steam's games and playtime in My games, and "Playing …" from Steam.
//
// Games are synced when linked, every 6 hours, and on Sync now. Steam's playtime is kept beside
// Glofly's own (user_games.steam_seconds): My games shows the larger, so a game played with
// Glofly open isn't counted twice. Steam only shares playtime when the person's game details are
// public on Steam. "Playing" is checked every minute for people with Glofly open, 100 at a time.

import { and, eq, inArray, isNotNull, lt, or, isNull, sql } from "drizzle-orm";
import { connectionSettingsOf, gameKey } from "@glofly/shared";
import { db } from "../db";
import { linkedAccounts, userGames } from "../db/schema";
import { connectedSummary, emitToUser } from "../realtime";
import { announcePresence, setDeviceActivity } from "../presence";
import { steamConfigured, steamOwnedGames, steamPlayers } from "./providers";

const SYNC_EVERY_MS = 6 * 3600_000;
/** The pretend "device" Steam's Playing comes from (so the desktop's own detection still wins). */
const STEAM_DEVICE = "steam";

/** Copies their Steam games into My games. False: Steam couldn't be reached. */
export async function syncSteamGames(userId: string): Promise<{ ok: boolean; count: number; publicGames: boolean }> {
  const [acct] = await db.select().from(linkedAccounts).where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.provider, "steam")));
  if (!acct || !steamConfigured()) return { ok: false, count: 0, publicGames: false };
  const games = await steamOwnedGames(acct.externalId);
  if (!games) return { ok: false, count: 0, publicGames: false };
  const players = await steamPlayers([acct.externalId]);
  const publicGames = players?.[0]?.publicGames ?? games.length > 0;
  const now = new Date();
  // Played ones only (a library of 2,000 unplayed games shouldn't flood My games).
  const played = games.filter((g) => g.minutes > 0);
  for (const g of played) {
    const key = gameKey(g.name);
    if (!key) continue;
    const last = g.lastPlayed > 0 ? new Date(g.lastPlayed * 1000) : now;
    await db
      .insert(userGames)
      .values({ userId, gameKey: key, name: g.name, seconds: 0, steamAppId: g.appId, steamSeconds: g.minutes * 60, firstPlayedAt: last, lastPlayedAt: last })
      .onConflictDoUpdate({
        target: [userGames.userId, userGames.gameKey],
        set: {
          steamAppId: g.appId,
          steamSeconds: g.minutes * 60,
          lastPlayedAt: sql`greatest(${userGames.lastPlayedAt}, ${last.toISOString()}::timestamptz)`,
        },
      });
  }
  await db
    .update(linkedAccounts)
    .set({
      syncedAt: now,
      gameCount: played.length,
      ...(players?.[0] ? { displayName: players[0].name, profileUrl: players[0].profileUrl } : {}),
    })
    .where(eq(linkedAccounts.id, acct.id));
  emitToUser(userId, "games:changed", {});
  emitToUser(userId, "connections:changed", {}, true);
  return { ok: true, count: played.length, publicGames };
}

/** Unlinking takes Steam's part out of My games (games only Steam knew about go entirely). */
export async function forgetSteamGames(userId: string): Promise<void> {
  await db.delete(userGames).where(and(eq(userGames.userId, userId), eq(userGames.seconds, 0), isNotNull(userGames.steamAppId)));
  await db.update(userGames).set({ steamAppId: null, steamSeconds: 0 }).where(eq(userGames.userId, userId));
  await setDeviceActivity(userId, STEAM_DEVICE, null);
  emitToUser(userId, "games:changed", {});
}

/** Every few minutes: anyone due a sync (6 hours) gets one. */
export async function sweepSteamSync(): Promise<void> {
  if (!steamConfigured()) return;
  const due = await db
    .select({ userId: linkedAccounts.userId })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.provider, "steam"), or(isNull(linkedAccounts.syncedAt), lt(linkedAccounts.syncedAt, new Date(Date.now() - SYNC_EVERY_MS)))))
    .limit(20);
  for (const { userId } of due) await syncSteamGames(userId).catch(() => undefined);
}

/** Every minute: "Playing …" from Steam for people with Glofly open who allow it. */
export async function sweepSteamPlaying(): Promise<void> {
  if (!steamConfigured()) return;
  const { userIds: connected } = await connectedSummary();
  const userIds = [...connected];
  if (!userIds.length) return;
  const accts = await db
    .select({ userId: linkedAccounts.userId, steamId: linkedAccounts.externalId, settings: linkedAccounts.settings })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.provider, "steam"), inArray(linkedAccounts.userId, userIds)));
  const wanted = accts.filter((a) => connectionSettingsOf(a.settings).playing);
  for (let i = 0; i < wanted.length; i += 100) {
    const batch = wanted.slice(i, i + 100);
    const players = await steamPlayers(batch.map((a) => a.steamId));
    if (!players) return;
    for (const a of batch) {
      const playing = players.find((p) => p.steamId === a.steamId)?.playing ?? null;
      // Kept 90 seconds (refreshed by each sweep), like a device's own activity.
      if (await setDeviceActivity(a.userId, STEAM_DEVICE, playing)) await announcePresence(a.userId, emitToUser);
    }
  }
}

/** Steam linked with "Show in My games" on (Steam's playtime counts in My games and profiles)? */
export async function steamInMyGames(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ settings: linkedAccounts.settings })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.provider, "steam")));
  return !!row && connectionSettingsOf(row.settings).myGames;
}

/** Their Steam profile page for their Glofly profile, when they chose to show it. */
export async function steamLinkOf(userId: string): Promise<{ steamUrl?: string }> {
  const [row] = await db
    .select({ settings: linkedAccounts.settings, profileUrl: linkedAccounts.profileUrl })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.userId, userId), eq(linkedAccounts.provider, "steam")));
  if (!row || !connectionSettingsOf(row.settings).showLink) return {};
  const url = row.profileUrl ?? "";
  return /^https:\/\/steamcommunity\.com\/(id|profiles)\/[A-Za-z0-9_-]{2,64}\/?$/.test(url) ? { steamUrl: url } : {};
}

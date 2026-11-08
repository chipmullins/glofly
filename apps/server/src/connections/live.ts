// 0.9.3: who's live on Twitch or Kick. Glofly listens to a channel (Twitch EventSub, Kick
// webhooks) while someone needs it: a linked account that tells friends, or a constellation's
// Live alerts. When it goes live: friends get "Maya went live on Kick" (in the apps, a phone push,
// the Windows notification), and constellations post their alert.

import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import {
  connectionSettingsOf,
  siteName,
  streamUrl,
  type FriendStream,
  type StreamLive,
  type StreamSite,
} from "@glofly/shared";
import { db } from "../db";
import { redis } from "../redis";
import {
  linkedAccounts,
  serverSettings,
  streamWatches,
  users,
} from "../db/schema";
import { emitToUser } from "../realtime";
import { friendIdsOf } from "../presence";
import { inBackground, notifyFriendNews } from "../push/notify";
import {
  kickConfigured,
  kickStream,
  kickSubscribe,
  kickUnsubscribe,
  twitchConfigured,
  twitchStream,
  twitchSubscribe,
  twitchUnsubscribe,
} from "./providers";

const SECRET_SETTING = "twitch_eventsub_secret";
let secretCache: string | null = null;

/** The secret Twitch signs its webhooks with (made once, kept in server_settings). */
export async function eventSubSecret(): Promise<string> {
  if (process.env.TWITCH_EVENTSUB_SECRET?.trim())
    return process.env.TWITCH_EVENTSUB_SECRET.trim();
  if (secretCache) return secretCache;
  const read = async () =>
    (
      await db
        .select({ value: serverSettings.value })
        .from(serverSettings)
        .where(eq(serverSettings.key, SECRET_SETTING))
    )[0]?.value as { secret?: string } | undefined;
  let row = await read();
  if (!row?.secret) {
    await db
      .insert(serverSettings)
      .values({
        key: SECRET_SETTING,
        value: { secret: randomBytes(32).toString("hex") },
      })
      .onConflictDoNothing();
    row = await read();
  }
  secretCache = row?.secret ?? null;
  return secretCache ?? "";
}

/** Where Twitch and Kick send their notices (this server's public address). */
export const publicBase = (fallback: string) =>
  (process.env.PUBLIC_API_URL?.trim() || fallback).replace(/\/+$/, "");

/** Starts listening to a channel (does nothing if Glofly already is). False: the site said no. */
export async function watchChannel(
  site: StreamSite,
  channelId: string,
  base: string,
): Promise<boolean> {
  const [row] = await db
    .select()
    .from(streamWatches)
    .where(
      and(
        eq(streamWatches.provider, site),
        eq(streamWatches.channelId, channelId),
      ),
    );
  if (row && complete(site, row.subscriptionIds)) return true;
  let ids: string[] | null = null;
  if (site === "twitch" && twitchConfigured())
    ids = await twitchSubscribe(
      channelId,
      `${publicBase(base)}/hooks/twitch`,
      await eventSubSecret(),
      row?.subscriptionIds ?? [],
    );
  if (site === "kick" && kickConfigured())
    ids = row?.subscriptionIds.length
      ? row.subscriptionIds
      : await kickSubscribe(channelId);
  await db
    .insert(streamWatches)
    .values({ provider: site, channelId, subscriptionIds: ids ?? [] })
    .onConflictDoUpdate({
      target: [streamWatches.provider, streamWatches.channelId],
      set: { subscriptionIds: ids ?? [], updatedAt: new Date() },
    });
  return !!ids && complete(site, ids);
}

/** Twitch needs both stream.online and stream.offline; Kick one subscription. */
const complete = (site: StreamSite, ids: string[]) =>
  site === "twitch" ? ids.length >= 2 : ids.length >= 1;

/** Stops listening when nobody needs the channel any more. `stillNeeded` says if someone does. */
export async function unwatchIfUnused(
  site: StreamSite,
  channelId: string,
  stillNeeded: boolean,
): Promise<void> {
  if (stillNeeded) return;
  const [row] = await db
    .select()
    .from(streamWatches)
    .where(
      and(
        eq(streamWatches.provider, site),
        eq(streamWatches.channelId, channelId),
      ),
    );
  if (!row) return;
  for (const id of row.subscriptionIds) {
    if (site === "twitch") await twitchUnsubscribe(id);
    else await kickUnsubscribe(id);
  }
  await db
    .delete(streamWatches)
    .where(
      and(
        eq(streamWatches.provider, site),
        eq(streamWatches.channelId, channelId),
      ),
    );
}

/** Listeners for "went live" besides friends (constellation Live alerts register here). */
type LiveListener = (
  site: StreamSite,
  channelId: string,
  login: string | null,
  live: StreamLive & { thumbnail?: string | null },
) => Promise<void>;
const listeners: LiveListener[] = [];
export function onChannelLive(fn: LiveListener): void {
  listeners.push(fn);
}

/** What a channel is streaming (from the site; null if it can't say). */
async function streamInfo(site: StreamSite, channelId: string) {
  return site === "twitch" ? twitchStream(channelId) : kickStream(channelId);
}

/**
 * A channel went live (from a webhook). `hint` is what the webhook itself said; the site is asked
 * for the title and game when the webhook didn't carry them.
 */
export async function channelWentLive(
  site: StreamSite,
  channelId: string,
  hint: {
    login?: string | null;
    title?: string | null;
    startedAt?: string | null;
  },
): Promise<void> {
  const info = await streamInfo(site, channelId).catch(() => null);
  const linked = await db
    .select({
      userId: linkedAccounts.userId,
      login: linkedAccounts.login,
      settings: linkedAccounts.settings,
    })
    .from(linkedAccounts)
    .where(
      and(
        eq(linkedAccounts.provider, site),
        eq(linkedAccounts.externalId, channelId),
      ),
    );
  const login = hint.login || linked[0]?.login || null;
  const url = login ? streamUrl(site, login) : null;
  if (!url) return;
  const startRaw = hint.startedAt ?? info?.startedAt ?? null;
  const startedAt =
    startRaw && Number.isFinite(Date.parse(startRaw))
      ? new Date(startRaw).toISOString()
      : null;
  const live: StreamLive & { thumbnail?: string | null } = {
    title: (hint.title ?? info?.title ?? "").slice(0, 140),
    game: info?.game ?? null,
    startedAt: startedAt ?? new Date().toISOString(),
    url,
    viewers: info?.viewers ?? null,
    thumbnail: info?.thumbnail ?? null,
  };
  // One alert per stream, decided in one statement (Twitch retries, two notices at once, a
  // link-while-live racing the webhook). Without a start time, only "wasn't live" counts.
  const fresh = await db
    .update(streamWatches)
    .set({ live, updatedAt: new Date() })
    .where(
      and(
        eq(streamWatches.provider, site),
        eq(streamWatches.channelId, channelId),
        startedAt
          ? sql`(${streamWatches.live} is null or ${streamWatches.live}->>'startedAt' is distinct from ${startedAt})`
          : sql`${streamWatches.live} is null`,
      ),
    )
    .returning({ channelId: streamWatches.channelId });
  if (!fresh.length) return;
  // And never twice for one stream (unlinking and linking again starts the watch over).
  if (
    (await redis.set(`livealert:${site}:${channelId}:${live.startedAt}`, "1", {
      NX: true,
      EX: 12 * 3600,
    })) !== "OK"
  )
    return;
  for (const a of linked) {
    await db
      .update(linkedAccounts)
      .set({
        live: {
          title: live.title,
          game: live.game,
          startedAt: live.startedAt,
          url: live.url,
          viewers: live.viewers,
        },
      })
      .where(
        and(
          eq(linkedAccounts.userId, a.userId),
          eq(linkedAccounts.provider, site),
        ),
      );
    inBackground(
      tellFriends(a.userId, site, live, connectionSettingsOf(a.settings)),
    );
  }
  for (const fn of listeners) inBackground(fn(site, channelId, login, live));
}

export async function channelWentOffline(
  site: StreamSite,
  channelId: string,
): Promise<void> {
  await db
    .update(streamWatches)
    .set({ live: null, updatedAt: new Date() })
    .where(
      and(
        eq(streamWatches.provider, site),
        eq(streamWatches.channelId, channelId),
      ),
    );
  const linked = await db
    .update(linkedAccounts)
    .set({ live: null })
    .where(
      and(
        eq(linkedAccounts.provider, site),
        eq(linkedAccounts.externalId, channelId),
      ),
    )
    .returning({ userId: linkedAccounts.userId });
  for (const { userId } of linked) {
    for (const id of await friendIdsOf(userId))
      emitToUser(id, "friend:live", { userId, source: site, live: null }, true);
    emitToUser(userId, "connections:changed", {}, true);
  }
}

/** "Maya went live on Kick": to the friends she picked (apps + phones), by her settings. */
async function tellFriends(
  userId: string,
  site: StreamSite,
  live: StreamLive,
  settings: ReturnType<typeof connectionSettingsOf>,
): Promise<void> {
  emitToUser(userId, "connections:changed", {}, true);
  const friends = await friendIdsOf(userId);
  const [who] = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      headerVersion: users.headerVersion,
      deleteAfter: users.deleteAfter,
    })
    .from(users)
    .where(eq(users.id, userId));
  // An account waiting to be deleted (its 30 days) tells nobody.
  if (!who || who.deleteAfter) return;
  const stream: FriendStream = {
    userId,
    source: site,
    title: live.title,
    game: live.game,
    url: live.url,
    startedAt: live.startedAt,
  };
  const told =
    settings.tellFriends === "off"
      ? []
      : settings.tellFriends === "chosen"
        ? friends.filter((f) => settings.chosen.includes(f))
        : friends;
  for (const id of friends) {
    // Everyone who may see the LIVE badge gets the state; only those told get the alert.
    if (settings.showLive || told.includes(id))
      emitToUser(
        id,
        "friend:live",
        // The header picture goes across the top of the Windows notification (no game art).
        {
          userId,
          source: site,
          live: settings.showLive || told.includes(id) ? stream : null,
          alert: told.includes(id),
          showLive: settings.showLive,
          headerVersion: who.headerVersion ?? null,
        },
        true,
      );
  }
  for (const id of told) {
    const muted = await alertsMuted(id, userId);
    if (!muted)
      inBackground(
        notifyFriendNews(
          id,
          who,
          `went live on ${siteName(site)}${live.title ? `: ${live.title}` : ""}`.slice(
            0,
            160,
          ),
          "soon",
        ),
      );
  }
}

/** "Mute Chip's live alerts" (users.muted_live_alerts). */
async function alertsMuted(
  viewerId: string,
  streamerId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ muted: users.mutedLiveAlerts })
    .from(users)
    .where(eq(users.id, viewerId));
  return (row?.muted ?? []).includes(streamerId);
}

/** My friends live on Twitch or Kick right now (for the LIVE badges when an app starts). */
export async function friendStreamsFor(
  userId: string,
): Promise<FriendStream[]> {
  const friends = new Set(await friendIdsOf(userId));
  if (!friends.size) return [];
  const rows = await db
    .select({
      userId: linkedAccounts.userId,
      provider: linkedAccounts.provider,
      live: linkedAccounts.live,
      settings: linkedAccounts.settings,
    })
    .from(linkedAccounts)
    .where(
      and(
        inArray(linkedAccounts.userId, [...friends]),
        isNotNull(linkedAccounts.live),
      ),
    );
  const out: FriendStream[] = [];
  for (const r of rows) {
    if (
      !friends.has(r.userId) ||
      !r.live ||
      (r.provider !== "twitch" && r.provider !== "kick")
    )
      continue;
    if (!connectionSettingsOf(r.settings).showLive) continue;
    const l = r.live as StreamLive;
    out.push({
      userId: r.userId,
      source: r.provider,
      title: l.title,
      game: l.game,
      url: l.url,
      startedAt: l.startedAt,
    });
  }
  return out;
}

/**
 * Channels Glofly should be listening to but isn't (the site said no, or revoked it): asked again
 * every so often. `base` is this server's public address.
 */
export async function sweepStreamWatches(base: string): Promise<void> {
  const stale = await db
    .select()
    .from(streamWatches)
    .where(
      and(
        sql`${streamWatches.provider} in ('twitch', 'kick')`,
        sql`cardinality(${streamWatches.subscriptionIds}) < (case when ${streamWatches.provider} = 'twitch' then 2 else 1 end)`,
        lt(streamWatches.updatedAt, new Date(Date.now() - 10 * 60_000)),
      ),
    )
    .limit(50);
  for (const row of stale) {
    const site = row.provider as StreamSite;
    let ids: string[] = row.subscriptionIds;
    if (site === "twitch" && twitchConfigured())
      ids = await twitchSubscribe(
        row.channelId,
        `${publicBase(base)}/hooks/twitch`,
        await eventSubSecret(),
        row.subscriptionIds,
      );
    if (site === "kick" && kickConfigured())
      ids = (await kickSubscribe(row.channelId)) ?? [];
    await db
      .update(streamWatches)
      .set({ subscriptionIds: ids, updatedAt: new Date() })
      .where(
        and(
          eq(streamWatches.provider, site),
          eq(streamWatches.channelId, row.channelId),
        ),
      );
  }
  // A missed "offline" must not leave LIVE up forever: streams quiet for 30 minutes are asked about.
  const quiet = await db
    .select({
      provider: streamWatches.provider,
      channelId: streamWatches.channelId,
    })
    .from(streamWatches)
    .where(
      and(
        sql`${streamWatches.provider} in ('twitch', 'kick')`,
        isNotNull(streamWatches.live),
        lt(streamWatches.updatedAt, new Date(Date.now() - 30 * 60_000)),
      ),
    )
    .limit(100);
  for (const q of quiet) {
    const site = q.provider as StreamSite;
    const info = await streamInfo(site, q.channelId).catch(() => undefined);
    if (info === undefined) continue;
    // "Not live" twice in a row (a hiccup reaching the site also reads as "not live").
    if (info === null) {
      const n = await redis.incr(`liveq:${site}:${q.channelId}`);
      await redis.expire(`liveq:${site}:${q.channelId}`, 3600);
      if (n >= 2) {
        await redis.del(`liveq:${site}:${q.channelId}`);
        await channelWentOffline(site, q.channelId);
      }
      continue;
    }
    await redis.del(`liveq:${site}:${q.channelId}`);
    await db
      .update(streamWatches)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(streamWatches.provider, site),
          eq(streamWatches.channelId, q.channelId),
        ),
      );
  }
}

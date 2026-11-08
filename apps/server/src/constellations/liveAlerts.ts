// 0.9.3 Constellation settings → Live alerts (approved canvas "Glofly: forwarding, formatting,
// live alerts, Steam", boards 4–5). No bot needed: Glofly posts in a nebula when a Twitch or Kick
// channel goes live, or a YouTube channel posts a video, with a card ("Watch together in <voice
// nebula>", "Open on Twitch"). Owner or "Edit constellation settings" only.
//
//   GET    /constellations/:id/live-alerts            the channels, the members' streams setting
//   POST   /constellations/:id/live-alerts            { site, channel, nebulaId, ping, message, watchNebulaId }
//   PATCH  /constellations/:id/live-alerts/:alertId   { nebulaId?, ping?, message?, watchNebulaId? }
//   DELETE /constellations/:id/live-alerts/:alertId
//   PUT    /constellations/:id/live-alerts/members    { nebulaId, ping, message } | { off: true }
//
// "Members' streams" (Settings → Connections → "Also post in my constellations") is a row with
// site "members": a member who linked Twitch or Kick and turned that on gets an alert here too.
// Pings are checked when an admin picks them (they must be allowed to mention that role, @everyone
// or @here); Glofly then posts them as set up.

import { Router, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  alertSiteName,
  connectionSettingsOf,
  DEFAULT_LIVE_MESSAGE,
  DEFAULT_VIDEO_MESSAGE,
  LIVE_ALERT_MESSAGE_MAX,
  LIVE_ALERTS_MAX,
  liveAlertText,
  parseChannel,
  streamUrl,
  type AlertSite,
  type LiveAlert,
  type LiveCard,
  type StreamLive,
  type StreamSite,
} from "@glofly/shared";
import { db } from "../db";
import { redis } from "../redis";
import { lockedDown } from "../admin/lockdown";
import { constellationLiveAlerts, constellationMembers, constellationRoles, linkedAccounts, messages, nebulas, streamWatches } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "./perms";
import { postScheduledText, sendUpdated } from "../messages/routes";
import { previewImageFrom, savePreviewImage } from "../messages/links";
import { toolBot } from "../tools/tools";
import { kickChannelBySlug, kickConfigured, twitchConfigured, twitchUserByLogin } from "../connections/providers";
import { onChannelLive, publicBase, unwatchIfUnused, watchChannel } from "../connections/live";
import { onYoutubeVideo, unwatchYoutube, watchYoutube, youtubeByHandle, youtubeChannel, youtubeHandlesOn, type YoutubeVideo } from "../connections/youtube";
import { setChannelNeeded } from "../connections/routes";

export const liveAlertsRouter = Router();
liveAlertsRouter.use("/:id/live-alerts", requireAuth);

const me = (res: Response) => res.locals.user as { id: string };
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : "invalid", message });
const idParam = z.uuid();
const MEMBERS = "members";
const baseOf = (req: Request) => publicBase(`${req.protocol}://${req.get("host")}`);
/** One alert per channel per constellation at most every 10 minutes (a stream that drops and comes back). */
const ALERT_GAP_MS = 10 * 60_000;

const limiter = rateLimit("live-alerts:change", {
  windowMs: 10 * 60_000,
  limit: 40,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of changes. Wait a few minutes." },
});

async function manager(req: Request, res: Response): Promise<Standing | null> {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return null;
  }
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, "That constellation isn't available.", 404);
    return null;
  }
  if (!can(s, "manageConstellation")) {
    bad(res, "Only people who can edit this constellation's settings can set up Live alerts.", 403);
    return null;
  }
  if (req.method !== "GET" && (await frozen(s.constellationId))) {
    bad(res, FROZEN_MESSAGE, 403);
    return null;
  }
  return s;
}

const channelUrlOf = (site: AlertSite, login: string, channelId: string) =>
  site === "youtube" ? `https://www.youtube.com/channel/${channelId}` : (streamUrl(site, login) ?? "");

function view(r: typeof constellationLiveAlerts.$inferSelect): LiveAlert {
  return {
    id: r.id,
    site: r.site as AlertSite,
    channelName: r.channelName,
    channelUrl: channelUrlOf(r.site as AlertSite, r.channelLogin, r.channelId),
    nebulaId: r.nebulaId,
    ping: r.ping,
    message: r.message,
    watchNebulaId: r.watchNebulaId,
    lastAlertAt: r.lastAlertAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The nebula, ping and Watch together choices point at this constellation, and the ping is allowed. */
async function problemWith(
  s: Standing,
  v: { nebulaId?: string; ping?: string | null; watchNebulaId?: string | null },
): Promise<string | null> {
  const ids = [v.nebulaId, v.watchNebulaId].filter((x): x is string => !!x);
  const found = ids.length
    ? await db
        .select({ id: nebulas.id, kind: nebulas.kind })
        .from(nebulas)
        .where(and(eq(nebulas.constellationId, s.constellationId), inArray(nebulas.id, ids)))
    : [];
  if (v.nebulaId && found.find((n) => n.id === v.nebulaId)?.kind !== "text") return "Pick a text nebula from this constellation to post in.";
  if (v.watchNebulaId && found.find((n) => n.id === v.watchNebulaId)?.kind !== "voice") return "Pick a voice nebula for Watch together.";
  if (v.ping) {
    const all = can(s, "mentionEveryone");
    if (v.ping === "everyone" || v.ping === "here") {
      if (!all) return "You can't ping @everyone or @here in this constellation.";
    } else {
      const [role] = await db
        .select({ kind: constellationRoles.kind, mentionable: constellationRoles.mentionable })
        .from(constellationRoles)
        .where(and(eq(constellationRoles.id, v.ping), eq(constellationRoles.constellationId, s.constellationId)));
      if (!role || role.kind === "member") return "Pick a role from this constellation to ping.";
      if (!all && !role.mentionable) return "You can't ping that role in this constellation.";
    }
  }
  return null;
}

const pingField = z.union([z.literal("everyone"), z.literal("here"), idParam]).nullable();
const messageField = z.string().trim().max(LIVE_ALERT_MESSAGE_MAX);

/** Is anything (an alert or a linked account) still listening to this channel? */
async function channelNeeded(site: "twitch" | "kick", channelId: string): Promise<boolean> {
  const [a] = await db
    .select({ id: constellationLiveAlerts.id })
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.site, site), eq(constellationLiveAlerts.channelId, channelId)))
    .limit(1);
  if (a) return true;
  const linked = await db
    .select({ settings: linkedAccounts.settings })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.provider, site), eq(linkedAccounts.externalId, channelId)));
  return linked.some((l) => {
    const st = connectionSettingsOf(l.settings);
    return st.tellFriends !== "off" || st.showLive || st.postInConstellations;
  });
}
// connections/routes.ts asks this before it stops listening for an unlinked account.
setChannelNeeded(async (site, channelId) => {
  const [a] = await db
    .select({ id: constellationLiveAlerts.id })
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.site, site), eq(constellationLiveAlerts.channelId, channelId)))
    .limit(1);
  return !!a;
});

async function stopIfUnused(site: AlertSite, channelId: string, base: string): Promise<void> {
  if (site === "youtube") {
    const [a] = await db
      .select({ id: constellationLiveAlerts.id })
      .from(constellationLiveAlerts)
      .where(and(eq(constellationLiveAlerts.site, "youtube"), eq(constellationLiveAlerts.channelId, channelId)))
      .limit(1);
    if (!a) await unwatchYoutube(channelId, base);
    return;
  }
  await unwatchIfUnused(site, channelId, await channelNeeded(site, channelId));
}

liveAlertsRouter.get("/:id/live-alerts", async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const rows = await db
    .select()
    .from(constellationLiveAlerts)
    .where(eq(constellationLiveAlerts.constellationId, s.constellationId))
    .orderBy(constellationLiveAlerts.createdAt);
  const members = rows.find((r) => r.site === MEMBERS);
  res.json({
    alerts: rows.filter((r) => r.site !== MEMBERS).map(view),
    members: members ? { nebulaId: members.nebulaId, ping: members.ping, message: members.message } : null,
    sites: { twitch: twitchConfigured(), kick: kickConfigured(), youtube: true, youtubeHandles: youtubeHandlesOn() },
    canPingEveryone: can(s, "mentionEveryone"),
  });
});

const addBody = z.object({
  site: z.enum(["twitch", "kick", "youtube"]),
  channel: z.string().trim().min(2).max(200),
  nebulaId: idParam,
  ping: pingField.default(null),
  message: messageField.default(""),
  watchNebulaId: idParam.nullable().default(null),
});

liveAlertsRouter.post("/:id/live-alerts", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const body = addBody.safeParse(req.body);
  if (!body.success) return void bad(res, "Fill in the channel and where to post.");
  const v = body.data;
  if (v.site === "youtube") v.watchNebulaId = v.watchNebulaId ?? null;
  const problem = await problemWith(s, v);
  if (problem) return void bad(res, problem);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.constellationId, s.constellationId), sql`${constellationLiveAlerts.site} <> 'members'`));
  if (count >= LIVE_ALERTS_MAX) return void bad(res, `A constellation can follow up to ${LIVE_ALERTS_MAX} channels.`);

  const name = alertSiteName(v.site);
  if (v.site !== "youtube" && !(v.site === "twitch" ? twitchConfigured() : kickConfigured())) {
    return void bad(res, `${name} alerts aren't set up on this server yet.`, 503);
  }
  const parsed = parseChannel(v.site, v.channel);
  if (!parsed) return void bad(res, v.site === "youtube" ? "Paste the YouTube channel's link (youtube.com/@name or youtube.com/channel/…)." : `Paste the ${name} channel's link or name.`);
  let channel: { id: string; login: string; name: string } | null = null;
  if ("login" in parsed) {
    const c = v.site === "twitch" ? await twitchUserByLogin(parsed.login) : await kickChannelBySlug(parsed.login);
    channel = c ? { id: c.id, login: c.login, name: c.displayName } : null;
  } else if ("youtubeId" in parsed) {
    const c = await youtubeChannel(parsed.youtubeId);
    channel = c ? { id: c.id, login: c.id, name: c.name } : null;
  } else {
    if (!youtubeHandlesOn()) return void bad(res, "Paste the channel's youtube.com/channel/… link (YouTube → the channel → Share → Copy channel ID link).");
    const c = await youtubeByHandle(parsed.handle);
    channel = c ? { id: c.id, login: c.id, name: c.name } : null;
  }
  if (!channel) return void bad(res, `Couldn't find that channel on ${name}. Check the link and try again.`);

  const [row] = await db
    .insert(constellationLiveAlerts)
    .values({
      constellationId: s.constellationId,
      site: v.site,
      channelId: channel.id,
      channelLogin: channel.login,
      channelName: channel.name.slice(0, 80),
      nebulaId: v.nebulaId,
      ping: v.ping,
      message: v.message || (v.site === "youtube" ? DEFAULT_VIDEO_MESSAGE : DEFAULT_LIVE_MESSAGE),
      watchNebulaId: v.site === "youtube" ? null : v.watchNebulaId,
      createdBy: s.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return void bad(res, `This constellation already follows ${channel.name} on ${name}.`, 409);
  const ok = v.site === "youtube" ? await watchYoutube(channel.id, baseOf(req)) : await watchChannel(v.site, channel.id, baseOf(req));
  res.status(201).json({ alert: view(row), listening: ok });
});

const editBody = z
  .object({ nebulaId: idParam, ping: pingField, message: messageField, watchNebulaId: idParam.nullable() })
  .partial()
  .strict();

liveAlertsRouter.patch("/:id/live-alerts/:alertId", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const alertId = idParam.safeParse(req.params.alertId);
  const body = editBody.safeParse(req.body);
  if (!alertId.success || !body.success) return void bad(res, "Those changes didn't make sense. Try again.");
  const [row] = await db
    .select()
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.id, alertId.data), eq(constellationLiveAlerts.constellationId, s.constellationId)));
  if (!row || row.site === MEMBERS) return void bad(res, "That alert isn't there any more.", 404);
  const v = body.data;
  // A ping that isn't changing stays as it is (even if the editor couldn't have picked it).
  const problem = await problemWith(s, { nebulaId: v.nebulaId, watchNebulaId: v.watchNebulaId, ping: v.ping !== undefined && v.ping !== row.ping ? v.ping : null });
  if (problem) return void bad(res, problem);
  const [updated] = await db
    .update(constellationLiveAlerts)
    .set({
      ...(v.nebulaId ? { nebulaId: v.nebulaId } : {}),
      ...(v.ping !== undefined ? { ping: v.ping } : {}),
      ...(v.message !== undefined ? { message: v.message || (row.site === "youtube" ? DEFAULT_VIDEO_MESSAGE : DEFAULT_LIVE_MESSAGE) } : {}),
      ...(v.watchNebulaId !== undefined && row.site !== "youtube" ? { watchNebulaId: v.watchNebulaId } : {}),
    })
    .where(eq(constellationLiveAlerts.id, row.id))
    .returning();
  res.json({ alert: view(updated) });
});

liveAlertsRouter.delete("/:id/live-alerts/:alertId", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const alertId = idParam.safeParse(req.params.alertId);
  if (!alertId.success) return void bad(res, "That alert isn't there any more.", 404);
  const [row] = await db
    .delete(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.id, alertId.data), eq(constellationLiveAlerts.constellationId, s.constellationId), sql`${constellationLiveAlerts.site} <> 'members'`))
    .returning();
  if (row) await stopIfUnused(row.site as AlertSite, row.channelId, baseOf(req));
  res.status(204).end();
});

const membersBody = z.union([
  z.object({ off: z.literal(true) }).strict(),
  z.object({ nebulaId: idParam, ping: pingField.default(null), message: messageField.default("") }).strict(),
]);

liveAlertsRouter.put("/:id/live-alerts/members", limiter, async (req, res) => {
  const s = await manager(req, res);
  if (!s) return;
  const body = membersBody.safeParse(req.body);
  if (!body.success) return void bad(res, "Pick where members' streams are posted.");
  if ("off" in body.data) {
    await db
      .delete(constellationLiveAlerts)
      .where(and(eq(constellationLiveAlerts.constellationId, s.constellationId), eq(constellationLiveAlerts.site, MEMBERS)));
    return void res.json({ members: null });
  }
  const v = body.data;
  const [existing] = await db
    .select()
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.constellationId, s.constellationId), eq(constellationLiveAlerts.site, MEMBERS)));
  const problem = await problemWith(s, { nebulaId: v.nebulaId, ping: existing && existing.ping === v.ping ? null : v.ping });
  if (problem) return void bad(res, problem);
  const message = v.message || DEFAULT_LIVE_MESSAGE;
  await db
    .insert(constellationLiveAlerts)
    .values({ constellationId: s.constellationId, site: MEMBERS, channelId: MEMBERS, channelLogin: MEMBERS, channelName: "Members", nebulaId: v.nebulaId, ping: v.ping, message, createdBy: s.userId })
    .onConflictDoUpdate({
      target: [constellationLiveAlerts.constellationId, constellationLiveAlerts.site, constellationLiveAlerts.channelId],
      set: { nebulaId: v.nebulaId, ping: v.ping, message },
    });
  res.json({ members: { nebulaId: v.nebulaId, ping: v.ping, message } });
});

// ───────────── Posting ─────────────

/** "@Stream fans" / "@everyone" for the text (null: no ping, or the role is gone). */
async function pingText(constellationId: string, ping: string | null): Promise<string | null> {
  if (!ping) return null;
  if (ping === "everyone" || ping === "here") return `@${ping}`;
  const [role] = await db
    .select({ name: constellationRoles.name })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.id, ping), eq(constellationRoles.constellationId, constellationId)));
  return role ? `@${role.name}` : null;
}

async function post(
  alert: typeof constellationLiveAlerts.$inferSelect,
  card: LiveCard,
  picture: string | null,
  // Twitch/Kick channels: one alert per 10 minutes (a stream that drops and comes back).
  gap = true,
): Promise<void> {
  // Claim the slot first (two notices at once still make one alert).
  const claimed = await db
    .update(constellationLiveAlerts)
    .set({ lastAlertAt: new Date() })
    .where(
      and(
        eq(constellationLiveAlerts.id, alert.id),
        gap
          ? sql`(${constellationLiveAlerts.lastAlertAt} is null or ${constellationLiveAlerts.lastAlertAt} < now() - make_interval(secs => ${ALERT_GAP_MS / 1000}))`
          : undefined,
      ),
    )
    .returning({ id: constellationLiveAlerts.id });
  if (!claimed.length || (await frozen(alert.constellationId))) return;
  const [n] = await db
    .select({ conversationId: nebulas.conversationId, kind: nebulas.kind })
    .from(nebulas)
    .where(and(eq(nebulas.id, alert.nebulaId), eq(nebulas.constellationId, alert.constellationId)));
  if (!n || n.kind !== "text") return;
  const text = liveAlertText(alert.message, card, await pingText(alert.constellationId, alert.ping));
  const bot = await toolBot(alert.constellationId);
  const sent = await postScheduledText(n.conversationId, bot, text, null, null, { liveCard: card, trustedMentions: !!alert.ping });
  if (!sent.ok) return;
  // The card's picture, shown as the message's preview (older apps show it like any link preview).
  const pic = picture ? await previewImageFrom(picture) : null;
  if (pic) await savePreviewImage(n.conversationId, sent.messageId, pic.image);
  await db
    .update(messages)
    .set({
      linkPreview: {
        url: card.url,
        title: card.title || card.channelName,
        description: [card.game, card.viewers !== null ? `${card.viewers} watching` : null].filter(Boolean).join(" · ") || null,
        siteName: alertSiteName(card.site),
        image: pic?.size ?? null,
      },
    })
    .where(eq(messages.id, sent.messageId));
  await sendUpdated(sent.messageId, n.conversationId);
}

/** A Twitch or Kick channel went live: every constellation following it, and members' streams. */
async function channelLive(site: StreamSite, channelId: string, login: string | null, live: StreamLive & { thumbnail?: string | null }): Promise<void> {
  const alerts = await db
    .select()
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.site, site), eq(constellationLiveAlerts.channelId, channelId)));
  for (const a of alerts) {
    const card: LiveCard = {
      site,
      kind: "live",
      channelName: a.channelName,
      title: live.title,
      game: live.game,
      viewers: live.viewers ?? null,
      url: live.url,
      watchNebulaId: a.watchNebulaId,
    };
    await post(a, card, live.thumbnail ?? null).catch((err) => console.error("Live alert failed", err));
  }
  // Members' streams: members who linked this channel and turned on "Also post in my constellations".
  const linked = await db
    .select({ userId: linkedAccounts.userId, settings: linkedAccounts.settings, displayName: linkedAccounts.displayName })
    .from(linkedAccounts)
    .where(and(eq(linkedAccounts.provider, site), eq(linkedAccounts.externalId, channelId)));
  for (const l of linked) {
    // Lockdown (Control) holds a member's posts in constellations back, alerts included.
    if (!connectionSettingsOf(l.settings).postInConstellations || (await lockedDown(l.userId))) continue;
    const rows = await db
      .select({ alert: constellationLiveAlerts })
      .from(constellationLiveAlerts)
      .innerJoin(
        constellationMembers,
        and(eq(constellationMembers.constellationId, constellationLiveAlerts.constellationId), eq(constellationMembers.userId, l.userId)),
      )
      .where(eq(constellationLiveAlerts.site, MEMBERS));
    for (const { alert } of rows) {
      // A channel the constellation already follows gets one alert, not two.
      if (alerts.some((a) => a.constellationId === alert.constellationId)) continue;
      const standing = await standingOf(alert.constellationId, l.userId);
      if (!standing || (standing.timedOutUntil && standing.timedOutUntil > new Date())) continue;
      const card: LiveCard = {
        site,
        kind: "live",
        channelName: l.displayName || login || "",
        title: live.title,
        game: live.game,
        viewers: live.viewers ?? null,
        url: live.url,
        watchNebulaId: null,
      };
      // The slot is per constellation + member (a members row is shared, so track it in Redis).
      if ((await redis.set(`memberlive:${alert.constellationId}:${l.userId}`, "1", { NX: true, EX: ALERT_GAP_MS / 1000 })) !== "OK") continue;
      await post(alert, card, live.thumbnail ?? null, false).catch((err) => console.error("Live alert failed", err));
    }
  }
}

async function youtubeVideo(video: YoutubeVideo): Promise<void> {
  const alerts = await db
    .select()
    .from(constellationLiveAlerts)
    .where(and(eq(constellationLiveAlerts.site, "youtube"), eq(constellationLiveAlerts.channelId, video.channelId)));
  for (const a of alerts) {
    const card: LiveCard = {
      site: "youtube",
      kind: "video",
      channelName: video.channelName ?? a.channelName,
      title: video.title,
      game: null,
      viewers: null,
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      watchNebulaId: null,
    };
    // Each video posts (no 10-minute gap: two uploads in a row are two videos).
    await post(a, card, `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`, false).catch((err) =>
      console.error("YouTube alert failed", err),
    );
  }
}

let started = false;
/** Hooks Live alerts up to Twitch/Kick/YouTube notices (once, at startup). */
export function startLiveAlerts(): void {
  if (started) return;
  started = true;
  onChannelLive((site, channelId, login, live) => channelLive(site, channelId, login, live));
  onYoutubeVideo((video) => youtubeVideo(video));
}

/** Channels nobody needs any more (a constellation was deleted, say): stop listening. */
export async function sweepUnusedWatches(base: string): Promise<void> {
  const rows = await db.select({ provider: streamWatches.provider, channelId: streamWatches.channelId }).from(streamWatches).limit(500);
  for (const r of rows) {
    if (r.provider === "youtube") await stopIfUnused("youtube", r.channelId, base);
    else if (r.provider === "twitch" || r.provider === "kick") await stopIfUnused(r.provider, r.channelId, base);
  }
}

import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import {
  canControlWatch,
  defaultWatchTitle,
  WATCH_SITES_FEATURE,
  type WatchSite,
  watchEnded,
  watchPositionAt,
  WATCH_SKIP_SEC,
  type WatchAction,
  type WatchControl,
  type WatchPreview,
  type WatchReaction,
  type WatchState,
  type WatchUpdate,
} from "@glofly/shared";
import { db } from "../db";
import { callParticipants, conversationMembers } from "../db/schema";
import { isNebulaChat } from "../constellations/chats";
import { emitToUser, emitToUserByFeature, someAppLacks } from "../realtime";

// Watch Together (Oct 2026): a YouTube video everyone in a call watches at the same moment.
//
// One small state per call, kept here in memory (like the ring timers): which video, playing or
// paused, and where it was at a moment of this server's clock. Every change goes to everyone in
// the call's chat (`watch:updated`, all their devices); each app works out where the video
// should be from that and nudges its own YouTube player to match. A server restart forgets what
// was being watched (the apps show the call without it, and anyone can start it again).
//
// Older apps (0.4.0 and before) never ask for any of this and ignore the live events; they only
// see the chat line ("Jordan started watching “…” together in the call").

type Entry = { state: WatchState; conversationId: string; endTimer?: ReturnType<typeof setTimeout> };
const watching = new Map<string, Entry>();

/** Only YouTube existed before 0.7.1: older apps are told about other sites' videos as "nothing". */
const oldAppsCanSee = (s: WatchState | null) => !s || !s.site || s.site === "youtube";

export type WatchProblem = { status: number; error: string; message: string };
const forbidden = (message: string): WatchProblem => ({ status: 403, error: "forbidden", message });
const ONLY_STARTER = (name: string) => `Only ${name} can pause and skip this video.`;

async function membersOf(conversationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

/**
 * Who hears about a call's video: everyone in the chat; for a voice nebula (2.0), only the people
 * in the room (newer apps only, which modern says).
 */
async function audienceOf(conversationId: string, callId: string): Promise<{ ids: string[]; modern: boolean }> {
  if (await isNebulaChat(conversationId)) {
    const rows = await db
      .select({ userId: callParticipants.userId })
      .from(callParticipants)
      .where(and(eq(callParticipants.callId, callId), isNotNull(callParticipants.joinedAt), isNull(callParticipants.leftAt)));
    return { ids: rows.map((r) => r.userId), modern: true };
  }
  return { ids: await membersOf(conversationId), modern: false };
}

/** A playing video that has reached its end becomes paused at the end (once its length is known). */
function settle(entry: Entry, now = Date.now()): void {
  const s = entry.state;
  if (s.playing && watchEnded(s, now)) {
    entry.state = { ...s, playing: false, position: s.durationSec ?? s.position, at: now, last: { userId: s.startedBy, action: "ended" }, seq: s.seq + 1 };
  }
}

/** What's being watched in this call right now (null: nothing). */
export function watchOf(callId: string): WatchState | null {
  const entry = watching.get(callId);
  if (!entry) return null;
  settle(entry);
  return entry.state;
}

/** `sites`: the app asking knows every site (0.7.1); older apps only ever hear about YouTube. */
export function watchUpdate(callId: string, sites = true): WatchUpdate {
  const watch = watchOf(callId);
  return { callId, watch: sites || oldAppsCanSee(watch) ? watch : null, serverNow: Date.now() };
}

/**
 * 0.7.1: when a playing video reaches its end, everyone is told it ended (paused at the end) at
 * that moment, so no app is left thinking it should still be playing (which made it play again).
 */
function scheduleEnd(callId: string, entry: Entry): void {
  clearTimeout(entry.endTimer);
  entry.endTimer = undefined;
  const s = entry.state;
  if (!s.playing || !s.durationSec || s.live) return;
  const left = (s.durationSec - watchPositionAt(s, Date.now())) * 1000;
  entry.endTimer = setTimeout(() => {
    if (watching.get(callId) !== entry) return;
    const before = entry.state.seq;
    settle(entry);
    if (entry.state.seq !== before) void announce(callId, entry.conversationId);
    else scheduleEnd(callId, entry);
  }, Math.max(0, left) + 150);
  entry.endTimer.unref?.();
}

async function announce(callId: string, conversationId: string): Promise<void> {
  const entry = watching.get(callId);
  if (entry) scheduleEnd(callId, entry);
  const payload = watchUpdate(callId);
  const audience = await audienceOf(conversationId, callId);
  if (oldAppsCanSee(payload.watch)) {
    for (const userId of audience.ids) emitToUser(userId, "watch:updated", payload, audience.modern);
    return;
  }
  // Another site: apps that know it get the video, older ones hear "nothing's on".
  const older: WatchUpdate = { ...payload, watch: null };
  for (const userId of audience.ids) void emitToUserByFeature(userId, "watch:updated", WATCH_SITES_FEATURE, payload, older, audience.modern);
}

/** Does everyone else in the call have an app that can show this site? (0.7.1) */
export async function othersNeedUpdate(callId: string, conversationId: string, userId: string, site: WatchSite): Promise<boolean> {
  if (site === "youtube") return false;
  const audience = await audienceOf(conversationId, callId);
  for (const id of audience.ids) {
    if (id === userId) continue;
    if (await someAppLacks(id, WATCH_SITES_FEATURE)) return true;
  }
  return false;
}

/** Tidies a title from YouTube (or an app) into one short plain line. */
export function cleanTitle(raw: unknown, fallback: string = "YouTube video"): string {
  if (typeof raw !== "string") return fallback;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 100) : fallback;
}

/**
 * Starts a video (or changes it). Starting is open to anyone in the call; changing the video
 * follows who can control it. Returns the new state, whether it was the first video of this
 * watching session (worth a line in the chat), or a problem.
 */
export async function startWatch(
  callId: string,
  conversationId: string,
  userId: string,
  video: { site?: WatchSite; videoId: string; live?: boolean; title: string; channel: string | null; startSec: number; control?: WatchControl },
  starterName: (id: string) => Promise<string>,
): Promise<{ state: WatchState; first: boolean } | WatchProblem> {
  const now = Date.now();
  const old = watching.get(callId);
  if (old && !canControlWatch(old.state, userId)) return forbidden(ONLY_STARTER(await starterName(old.state.startedBy)));
  const site = video.site ?? "youtube";
  const live = site === "twitch" && !!video.live;
  const state: WatchState = {
    callId,
    site,
    videoId: video.videoId,
    live,
    title: cleanTitle(video.title, defaultWatchTitle(site, live)),
    channel: video.channel ? cleanTitle(video.channel, "") || null : null,
    durationSec: null,
    // Changing the video keeps who picked the first one in charge (and their setting).
    startedBy: old ? old.state.startedBy : userId,
    control: video.control ?? old?.state.control ?? "everyone",
    playing: true,
    position: live ? 0 : Math.max(0, Math.min(video.startSec, 24 * 3600)),
    at: now,
    last: { userId, action: old ? "change" : "start" },
    seq: (old?.state.seq ?? 0) + 1,
  };
  if (old) clearTimeout(old.endTimer);
  watching.set(callId, { state, conversationId });
  await announce(callId, conversationId);
  return { state, first: !old };
}

export type ControlAction = "play" | "pause" | "seek" | "back" | "forward";

/** Play, pause, skip to a moment, or ±10 seconds, for everyone. */
export async function controlWatch(
  callId: string,
  userId: string,
  action: ControlAction,
  to: number | undefined,
  starterName: (id: string) => Promise<string>,
): Promise<WatchState | WatchProblem> {
  const entry = watching.get(callId);
  if (!entry) return { status: 409, error: "not_watching", message: "Nobody's watching anything right now." };
  const now = Date.now();
  settle(entry, now);
  const s = entry.state;
  if (!canControlWatch(s, userId)) return forbidden(ONLY_STARTER(await starterName(s.startedBy)));
  if (s.live && action !== "play" && action !== "pause") {
    return { status: 409, error: "live", message: "You can't skip in a live stream." };
  }
  const here = watchPositionAt(s, now);
  const end = s.durationSec ?? Number.POSITIVE_INFINITY;
  const clamp = (v: number) => Math.max(0, Math.min(v, end));
  let playing = s.playing;
  let position = here;
  if (action === "play") {
    playing = true;
    // At the end: play again from the start.
    if (s.durationSec && here >= s.durationSec - 0.5) position = 0;
  } else if (action === "pause") playing = false;
  else if (action === "seek") position = clamp(to ?? here);
  else if (action === "back") position = clamp(here - WATCH_SKIP_SEC);
  else position = clamp(here + WATCH_SKIP_SEC);
  // Skipping to the very end stops there.
  if (s.durationSec && position >= s.durationSec - 0.25) {
    position = s.durationSec;
    playing = false;
  }
  entry.state = { ...s, playing, position, at: now, last: { userId, action }, seq: s.seq + 1 };
  await announce(callId, entry.conversationId);
  return entry.state;
}

/** Whoever started the video lets everyone control it, or only themselves. */
export async function setWatchControl(callId: string, userId: string, control: WatchControl): Promise<WatchState | WatchProblem> {
  const entry = watching.get(callId);
  if (!entry) return { status: 409, error: "not_watching", message: "Nobody's watching anything right now." };
  if (entry.state.startedBy !== userId) return forbidden("Only whoever picked the video can change who controls it.");
  if (entry.state.control === control) return entry.state;
  const now = Date.now();
  settle(entry, now);
  const s = entry.state;
  entry.state = { ...s, position: watchPositionAt(s, now), at: now, control, last: { userId, action: "control" }, seq: s.seq + 1 };
  await announce(callId, entry.conversationId);
  return entry.state;
}

/**
 * A player found out how long the video is (YouTube tells each player once it loads). The first
 * answer for the current video from someone who can control it counts (so nobody else can end
 * the video for everyone by reporting it as 1 second long), and never shorter than where it is.
 * A title too, if YouTube's page couldn't be asked.
 */
export async function reportWatch(callId: string, userId: string, videoId: string, durationSec: number, title?: string): Promise<void> {
  const entry = watching.get(callId);
  if (!entry || entry.state.videoId !== videoId) return;
  const s = entry.state;
  if (!canControlWatch(s, userId)) return;
  // A very short video is only believed from whoever picked it.
  if (durationSec < 10 && userId !== s.startedBy) return;
  const here = watchPositionAt(s, Date.now());
  const better = !s.live && s.durationSec === null && durationSec > 0 && durationSec < 48 * 3600 && durationSec >= here - 2;
  const fallback = defaultWatchTitle(s.site, s.live);
  const named = s.title === fallback && typeof title === "string" && cleanTitle(title, fallback) !== fallback;
  if (!better && !named) return;
  entry.state = {
    ...s,
    durationSec: better ? Math.round(durationSec * 10) / 10 : s.durationSec,
    title: named ? cleanTitle(title, fallback) : s.title,
    seq: s.seq + 1,
  };
  await announce(callId, entry.conversationId);
}

/** Stops watching for everyone (follows who can control it). */
export async function stopWatch(callId: string, userId: string, starterName: (id: string) => Promise<string>): Promise<WatchProblem | null> {
  const entry = watching.get(callId);
  if (!entry) return null;
  if (!canControlWatch(entry.state, userId)) return forbidden(`Only ${await starterName(entry.state.startedBy)} can stop the video.`);
  clearTimeout(entry.endTimer);
  watching.delete(callId);
  await announce(callId, entry.conversationId);
  return null;
}

/**
 * Someone left the call. If only they could control the video, everyone can now (so the
 * video isn't stuck). If nobody's left, the call is closing anyway (forgetWatch).
 */
export async function watcherLeft(callId: string, userId: string): Promise<void> {
  const entry = watching.get(callId);
  if (!entry || entry.state.control !== "starter" || entry.state.startedBy !== userId) return;
  const now = Date.now();
  settle(entry, now);
  const s = entry.state;
  entry.state = { ...s, position: watchPositionAt(s, now), at: now, control: "everyone", last: { userId, action: "control" }, seq: s.seq + 1 };
  await announce(callId, entry.conversationId);
}

/** Add people (0.5.2) moved the call to a new group: what it's watching is told to that group. */
export function moveWatch(callId: string, conversationId: string): void {
  const entry = watching.get(callId);
  if (entry) entry.conversationId = conversationId;
}

/** The call is over: nothing to watch any more. */
export function forgetWatch(callId: string): void {
  clearTimeout(watching.get(callId)?.endTimer);
  watching.delete(callId);
}

/** A firefly reaction over the video, to everyone in the call's chat. */
export async function reactWatch(callId: string, conversationId: string, userId: string, reaction: WatchReaction): Promise<void> {
  const payload = { callId, userId, reaction, id: randomUUID() };
  const audience = await audienceOf(conversationId, callId);
  for (const id of audience.ids) emitToUser(id, "watch:reaction", payload, audience.modern);
}

// ---- What a link is (the Start dialog) ----
//
// YouTube's, Vimeo's and Dailymotion's oEmbed answers give the title and channel, and YouTube's
// says whether the video may be played outside YouTube at all (401/403: its owner turned that
// off). Only each site's own address is ever asked, with an id we checked, so nobody can point
// the server anywhere else. Twitch has no open oEmbed: the title comes from the channel name.

type PreviewResult = { ok: true; preview: WatchPreview } | { ok: false; status: number; error: string; message: string };
const previews = new Map<string, { at: number; result: PreviewResult }>();
const PREVIEW_KEEP_MS = 6 * 60 * 60 * 1000;
// Only for testing against a stand-in (YOUTUBE_OEMBED_URL in .env); normally YouTube's own.
const OEMBED = process.env.YOUTUBE_OEMBED_URL || "https://www.youtube.com/oembed";

function oembedUrl(site: WatchSite, videoId: string): string | null {
  if (site === "youtube") return `${OEMBED}?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  if (site === "vimeo") {
    const [id, hash] = videoId.split(":");
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${id}${hash ? `/${hash}` : ""}`)}`;
  }
  if (site === "dailymotion") return `https://www.dailymotion.com/services/oembed?format=json&url=${encodeURIComponent(`https://www.dailymotion.com/video/${videoId}`)}`;
  return null;
}

export async function previewVideo(videoId: string, site: WatchSite = "youtube", live = false): Promise<PreviewResult> {
  const key = `${site}:${videoId}`;
  const cached = previews.get(key);
  if (cached && Date.now() - cached.at < PREVIEW_KEEP_MS) return cached.result;
  const name = defaultWatchTitle(site, live);
  const fallback: WatchPreview = {
    site,
    live,
    videoId,
    title: site === "twitch" && live ? `${videoId.slice(2)} on Twitch` : name,
    channel: site === "twitch" && live ? videoId.slice(2) : null,
    thumbnailUrl: site === "youtube" ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
  };
  const url = oembedUrl(site, videoId);
  if (!url) return { ok: true, preview: fallback };
  let result: PreviewResult;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "error" });
    if (res.status === 401 || res.status === 403) {
      result = { ok: false, status: 422, error: "not_embeddable", message: "That video can't be played outside its site. Try another one." };
    } else if (res.status === 400 || res.status === 404) {
      result = { ok: false, status: 404, error: "not_found", message: "Couldn't find that video. Check the link." };
    } else if (!res.ok) {
      return { ok: true, preview: fallback }; // a hiccup on their side: don't remember it
    } else {
      const body = (await res.json()) as { title?: unknown; author_name?: unknown };
      result = {
        ok: true,
        preview: { ...fallback, title: cleanTitle(body.title, name), channel: typeof body.author_name === "string" ? cleanTitle(body.author_name, "") || null : null },
      };
    }
  } catch {
    // The site couldn't be reached from here: start anyway (the players report the title).
    return { ok: true, preview: fallback };
  }
  if (previews.size > 500) previews.delete(previews.keys().next().value!);
  previews.set(key, { at: Date.now(), result });
  return result;
}

export type { WatchAction };

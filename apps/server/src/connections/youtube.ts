// 0.9.3 Live alerts: YouTube channels (new videos and premieres), through YouTube's WebSub hub.
//
// No sign-in and no key needed for a channel link with /channel/UC…; "@handle" links are looked
// up with the YouTube Data API when YOUTUBE_API_KEY is set. The hub calls GET /hooks/youtube to
// confirm a subscription and POSTs the channel's Atom feed entry when a video is published or
// changed. Notices are signed (X-Hub-Signature, HMAC-SHA1 with our secret); only videos published
// in the last 2 days and not seen before make an alert. Subscriptions last 5 days and are renewed.
// YOUTUBE_HUB_URL / YOUTUBE_FEED_URL / YOUTUBE_API_URL are only for testing with a stand-in.

import { createHmac, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { and, eq, lt, or, isNull } from "drizzle-orm";
import { db } from "../db";
import { streamWatches } from "../db/schema";
import { redis } from "../redis";
import { inBackground } from "../push/notify";
import { eventSubSecret, publicBase } from "./live";

const env = (k: string) => process.env[k]?.trim() || "";
const base = (k: string, fallback: string) => (env(k) || fallback).replace(/\/+$/, "");
const HUB = base("YOUTUBE_HUB_URL", "https://pubsubhubbub.appspot.com");
const FEED = base("YOUTUBE_FEED_URL", "https://www.youtube.com/feeds/videos.xml");
const API = base("YOUTUBE_API_URL", "https://www.googleapis.com/youtube/v3");
const LEASE_SECONDS = 5 * 86_400;
const TIMEOUT = 8000;

export const youtubeHandlesOn = () => env("YOUTUBE_API_KEY").length > 0;
const topicOf = (channelId: string) => `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${channelId}`;
const isChannelId = (s: string) => /^UC[A-Za-z0-9_-]{22}$/.test(s);

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** A channel by id: its name (from its public feed). Null if YouTube doesn't know it. */
export async function youtubeChannel(channelId: string): Promise<{ id: string; name: string } | null> {
  if (!isChannelId(channelId)) return null;
  try {
    const res = await fetch(`${FEED}?${new URLSearchParams({ channel_id: channelId })}`, { signal: AbortSignal.timeout(TIMEOUT), redirect: "error" });
    if (!res.ok) return null;
    const xml = (await res.text()).slice(0, 200_000);
    const name = /<title>([\s\S]{1,300}?)<\/title>/.exec(xml)?.[1];
    return { id: channelId, name: name ? decode(name).slice(0, 80) : channelId };
  } catch {
    return null;
  }
}

/** "@handle" → the channel (needs YOUTUBE_API_KEY). */
export async function youtubeByHandle(handle: string): Promise<{ id: string; name: string } | null> {
  if (!youtubeHandlesOn() || !/^[A-Za-z0-9._-]{3,30}$/.test(handle)) return null;
  try {
    const q = new URLSearchParams({ part: "snippet", forHandle: `@${handle}`, key: env("YOUTUBE_API_KEY") });
    const res = await fetch(`${API}/channels?${q}`, { signal: AbortSignal.timeout(TIMEOUT), redirect: "error" });
    if (!res.ok) return null;
    const r = (await res.json()) as { items?: { id?: unknown; snippet?: { title?: unknown } }[] };
    const item = r.items?.[0];
    if (typeof item?.id !== "string" || !isChannelId(item.id)) return null;
    return { id: item.id, name: typeof item.snippet?.title === "string" ? item.snippet.title.slice(0, 80) : item.id };
  } catch {
    return null;
  }
}

async function hub(mode: "subscribe" | "unsubscribe", channelId: string, callbackBase: string): Promise<boolean> {
  try {
    const res = await fetch(`${HUB}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        "hub.callback": `${publicBase(callbackBase)}/hooks/youtube`,
        "hub.topic": topicOf(channelId),
        "hub.mode": mode,
        "hub.verify": "async",
        "hub.secret": await eventSubSecret(),
        "hub.lease_seconds": String(LEASE_SECONDS),
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT),
      redirect: "error",
    });
    return res.status === 202 || res.status === 204;
  } catch {
    return false;
  }
}

/** Starts listening to a YouTube channel (renewed by sweepYoutube). */
export async function watchYoutube(channelId: string, callbackBase: string): Promise<boolean> {
  const [row] = await db.select().from(streamWatches).where(and(eq(streamWatches.provider, "youtube"), eq(streamWatches.channelId, channelId)));
  if (row?.subscriptionIds.length && row.renewAt && row.renewAt > new Date()) return true;
  const ok = await hub("subscribe", channelId, callbackBase);
  const renewAt = new Date(Date.now() + (ok ? LEASE_SECONDS - 86_400 : 600) * 1000);
  await db
    .insert(streamWatches)
    .values({ provider: "youtube", channelId, subscriptionIds: ok ? ["websub"] : [], renewAt })
    .onConflictDoUpdate({ target: [streamWatches.provider, streamWatches.channelId], set: { subscriptionIds: ok ? ["websub"] : [], renewAt, updatedAt: new Date() } });
  return ok;
}

export async function unwatchYoutube(channelId: string, callbackBase: string): Promise<void> {
  const [row] = await db
    .delete(streamWatches)
    .where(and(eq(streamWatches.provider, "youtube"), eq(streamWatches.channelId, channelId)))
    .returning();
  if (row) await hub("unsubscribe", channelId, callbackBase);
}

/** Subscriptions about to run out (or never confirmed) are asked for again. */
export async function sweepYoutube(callbackBase: string): Promise<void> {
  const due = await db
    .select({ channelId: streamWatches.channelId })
    .from(streamWatches)
    .where(and(eq(streamWatches.provider, "youtube"), or(isNull(streamWatches.renewAt), lt(streamWatches.renewAt, new Date()))))
    .limit(50);
  for (const { channelId } of due) {
    const ok = await hub("subscribe", channelId, callbackBase);
    await db
      .update(streamWatches)
      .set({ subscriptionIds: ok ? ["websub"] : [], renewAt: new Date(Date.now() + (ok ? LEASE_SECONDS - 86_400 : 600) * 1000), updatedAt: new Date() })
      .where(and(eq(streamWatches.provider, "youtube"), eq(streamWatches.channelId, channelId)));
  }
}

export type YoutubeVideo = { channelId: string; videoId: string; title: string; channelName: string | null; published: string };
type VideoListener = (video: YoutubeVideo) => Promise<void>;
const listeners: VideoListener[] = [];
export function onYoutubeVideo(fn: VideoListener): void {
  listeners.push(fn);
}

/** The video in a hub notice (null: a deleted entry or nothing usable). */
export function videoFromFeed(xml: string): YoutubeVideo | null {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1];
  if (!entry) return null;
  const videoId = /<yt:videoId>([A-Za-z0-9_-]{11})<\/yt:videoId>/.exec(entry)?.[1];
  const channelId = /<yt:channelId>(UC[A-Za-z0-9_-]{22})<\/yt:channelId>/.exec(entry)?.[1];
  const title = /<title>([\s\S]{0,500}?)<\/title>/.exec(entry)?.[1];
  const published = /<published>([^<]{10,40})<\/published>/.exec(entry)?.[1];
  const author = /<author>[\s\S]*?<name>([\s\S]{1,200}?)<\/name>/.exec(entry)?.[1];
  if (!videoId || !channelId || !published || !Number.isFinite(Date.parse(published))) return null;
  return { videoId, channelId, title: title ? decode(title).slice(0, 140) : "", channelName: author ? decode(author).slice(0, 80) : null, published };
}

export const youtubeHooksRouter = Router();

// The hub confirms a subscribe/unsubscribe: only answered for what Glofly asked.
youtubeHooksRouter.get("/hooks/youtube", async (req, res) => {
  const mode = req.query["hub.mode"];
  const topic = req.query["hub.topic"];
  const challenge = req.query["hub.challenge"];
  const channelId = typeof topic === "string" ? /[?&]channel_id=(UC[A-Za-z0-9_-]{22})$/.exec(topic)?.[1] : undefined;
  if (typeof challenge !== "string" || challenge.length > 400 || !channelId || (mode !== "subscribe" && mode !== "unsubscribe")) {
    res.status(404).end();
    return;
  }
  const [row] = await db.select({ id: streamWatches.channelId }).from(streamWatches).where(and(eq(streamWatches.provider, "youtube"), eq(streamWatches.channelId, channelId)));
  if ((mode === "subscribe") !== !!row) {
    res.status(404).end();
    return;
  }
  res.status(200).type("text/plain").send(challenge);
});

youtubeHooksRouter.post("/hooks/youtube", express.raw({ type: () => true, limit: "64kb" }), async (req, res) => {
  const body = Buffer.isBuffer(req.body) ? req.body : null;
  const sig = /^sha1=([0-9a-f]{40})$/i.exec(req.get("X-Hub-Signature") ?? "")?.[1];
  // WebSub: answer 2xx even when the signature is wrong (and ignore the notice), so a forger
  // learns nothing; the hub itself always signs.
  res.status(204).end();
  if (!body || !sig) return;
  const want = createHmac("sha1", await eventSubSecret()).update(body).digest();
  const got = Buffer.from(sig, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return;
  const video = videoFromFeed(body.toString("utf8"));
  if (!video) return;
  if (Date.now() - Date.parse(video.published) > 2 * 86_400_000) return; // an old video edited
  const [row] = await db.select({ id: streamWatches.channelId }).from(streamWatches).where(and(eq(streamWatches.provider, "youtube"), eq(streamWatches.channelId, video.channelId)));
  if (!row) return;
  // Each video once (the hub also sends title changes).
  if ((await redis.set(`ytvideo:${video.videoId}`, "1", { NX: true, EX: 30 * 86_400 })) !== "OK") return;
  for (const fn of listeners) inBackground(fn(video));
});

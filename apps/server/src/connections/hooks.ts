// 0.9.3: Twitch (EventSub) and Kick tell Glofly when a channel goes live or offline.
//
//   POST /hooks/twitch   HMAC-SHA256 with Glofly's EventSub secret over id + timestamp + body
//   POST /hooks/kick     RSA-SHA256 with Kick's public key over "id.timestamp.body"
//
// Both check the signature against the exact bytes received (index.ts keeps req.rawBody for these
// two paths), refuse anything older than 10 minutes, and ignore a message id seen before (both
// sites retry). Nothing in a notice is trusted beyond "this channel is live/offline": titles and
// games are asked from the site again when missing, and links are rebuilt from the login.

import { createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { streamWatches } from "../db/schema";
import { redis } from "../redis";
import { inBackground } from "../push/notify";
import { kickSignatureOk } from "./providers";
import { channelWentLive, channelWentOffline, eventSubSecret } from "./live";

const MAX_AGE_MS = 10 * 60 * 1000;
const raw = (req: Request) => (req as Request & { rawBody?: Buffer }).rawBody ?? null;
const header = (req: Request, name: string) => {
  const v = req.get(name);
  return typeof v === "string" ? v : "";
};

/** First time this message id is seen (both sites send retries)? */
async function firstTime(site: string, id: string): Promise<boolean> {
  return (await redis.set(`livehook:${site}:${id.slice(0, 100)}`, "1", { NX: true, EX: 60 * 60 })) === "OK";
}

const fresh = (timestamp: string) => {
  const at = Date.parse(timestamp);
  return Number.isFinite(at) && Math.abs(Date.now() - at) < MAX_AGE_MS;
};

const watched = async (site: "twitch" | "kick", channelId: string) =>
  (await db.select({ id: streamWatches.channelId }).from(streamWatches).where(and(eq(streamWatches.provider, site), eq(streamWatches.channelId, channelId)))).length > 0;

export const liveHooksRouter = Router();

liveHooksRouter.post("/hooks/twitch", async (req, res) => {
  const body = raw(req);
  const id = header(req, "Twitch-Eventsub-Message-Id");
  const timestamp = header(req, "Twitch-Eventsub-Message-Timestamp");
  const signature = header(req, "Twitch-Eventsub-Message-Signature");
  const type = header(req, "Twitch-Eventsub-Message-Type");
  if (!body || !id || !timestamp || !signature.startsWith("sha256=")) {
    res.status(403).end();
    return;
  }
  const want = createHmac("sha256", await eventSubSecret()).update(id + timestamp).update(body).digest();
  const got = Buffer.from(signature.slice(7), "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want) || !fresh(timestamp)) {
    res.status(403).end();
    return;
  }
  const msg = req.body as {
    challenge?: unknown;
    subscription?: { id?: unknown; type?: unknown; condition?: { broadcaster_user_id?: unknown } };
    event?: { broadcaster_user_id?: unknown; broadcaster_user_login?: unknown; started_at?: unknown };
  };
  if (type === "webhook_callback_verification") {
    if (typeof msg.challenge !== "string") {
      res.status(400).end();
      return;
    }
    res.status(200).type("text/plain").send(msg.challenge);
    return;
  }
  res.status(204).end();
  if (!(await firstTime("twitch", id))) return;
  const channelId = msg.event?.broadcaster_user_id ?? msg.subscription?.condition?.broadcaster_user_id;
  if (typeof channelId !== "string" || !/^\d{1,20}$/.test(channelId) || !(await watched("twitch", channelId))) return;
  if (type === "revocation") {
    // Twitch stopped sending (the account changed, or too many failures): the renew sweep
    // subscribes again if someone still needs it.
    await db
      .update(streamWatches)
      .set({ subscriptionIds: [], updatedAt: new Date() })
      .where(and(eq(streamWatches.provider, "twitch"), eq(streamWatches.channelId, channelId)));
    return;
  }
  if (type !== "notification") return;
  const login = typeof msg.event?.broadcaster_user_login === "string" ? msg.event.broadcaster_user_login : null;
  if (msg.subscription?.type === "stream.online") {
    inBackground(channelWentLive("twitch", channelId, { login, startedAt: typeof msg.event?.started_at === "string" ? msg.event.started_at : null }));
  } else if (msg.subscription?.type === "stream.offline") {
    inBackground(channelWentOffline("twitch", channelId));
  }
});

liveHooksRouter.post("/hooks/kick", async (req, res) => {
  const body = raw(req);
  const id = header(req, "Kick-Event-Message-Id");
  const timestamp = header(req, "Kick-Event-Message-Timestamp");
  const signature = header(req, "Kick-Event-Signature");
  const type = header(req, "Kick-Event-Type");
  if (!body || !(await kickSignatureOk(id, timestamp, body, signature)) || !fresh(timestamp)) {
    res.status(403).end();
    return;
  }
  res.status(204).end();
  if (type !== "livestream.status.updated" || !(await firstTime("kick", id))) return;
  const msg = req.body as {
    broadcaster?: { user_id?: unknown; channel_slug?: unknown };
    is_live?: unknown;
    title?: unknown;
    started_at?: unknown;
  };
  const rawId = msg.broadcaster?.user_id;
  const channelId = typeof rawId === "number" || typeof rawId === "string" ? String(rawId) : "";
  if (!/^\d{1,20}$/.test(channelId) || !(await watched("kick", channelId))) return;
  const slug = typeof msg.broadcaster?.channel_slug === "string" ? msg.broadcaster.channel_slug : null;
  if (msg.is_live === true) {
    inBackground(
      channelWentLive("kick", channelId, {
        login: slug,
        title: typeof msg.title === "string" ? msg.title : null,
        startedAt: typeof msg.started_at === "string" ? msg.started_at : null,
      }),
    );
  } else if (msg.is_live === false) {
    inBackground(channelWentOffline("kick", channelId));
  }
});

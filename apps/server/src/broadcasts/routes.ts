import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { BROADCAST_TITLE_MAX, type BroadcastJoin, type PublicUser } from "@glofly/shared";
import { requireAuth } from "../auth/sessions";
import { db } from "../db";
import { users } from "../db/schema";
import { broadcastToken, closeRoom, LIVEKIT_URL, livekitConfigured, peopleInRoom, removeFromRoom } from "../calls/livekit";
import { emitToUser } from "../realtime";
import { inBackground, notifyFriendNews } from "../push/notify";
import { friendIdsOf } from "../social/routes";
import { live, shown } from "./state";

// Broadcast now (0.5.0): one tap starts a stream of your screen (with its sound) that any of
// your friends can drop in and watch, without a call. LiveKit carries it in a room of its own;
// the broadcaster may send, friends may only watch.
//
//   POST   /broadcasts                 { title? }  go live (a pass to send)
//   DELETE /broadcasts                 stop
//   GET    /broadcasts/mine            who's watching
//   POST   /broadcasts/:userId/watch   a friend's pass to watch

export const broadcastsRouter = Router();
broadcastsRouter.use(requireAuth);

type Me = { id: string; displayName: string; avatarVersion: string | null };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();

const startLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 6,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of going live. Wait a few minutes." },
});

function notSetUp(res: Response): boolean {
  if (livekitConfigured) return false;
  res.status(503).json({ error: "calls_unavailable", message: "Broadcasting isn't set up on this server yet." });
  return true;
}

async function tellFriends(userId: string): Promise<string[]> {
  const friends = await friendIdsOf(userId);
  for (const id of friends) emitToUser(id, "social:changed", {});
  emitToUser(userId, "social:changed", {});
  return friends;
}

broadcastsRouter.post("/", startLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const title = z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(BROADCAST_TITLE_MAX))
    .optional()
    .safeParse(req.body?.title ?? undefined);
  if (!title.success) {
    res.status(400).json({ error: "invalid", message: `Keep the title under ${BROADCAST_TITLE_MAX} characters.` });
    return;
  }
  const user = me(res);
  // Already live (another device, or a quick restart): keep the same room.
  let b = live.get(user.id);
  const fresh = !b;
  if (!b) {
    b = { userId: user.id, room: `bc_${user.id}_${randomBytes(6).toString("hex")}`, startedAt: new Date(), title: title.data || null, viewers: [], seenAt: Date.now() };
    live.set(user.id, b);
  } else if (title.data !== undefined) b.title = title.data || null;
  const token = await broadcastToken(b.room, user, "host");
  const friends = await tellFriends(user.id);
  if (fresh) {
    for (const id of friends) inBackground(notifyFriendNews(id, user, b.title ? `is live: ${b.title}` : "is live. Tap to watch!", "soon"));
  }
  const join: BroadcastJoin = { url: LIVEKIT_URL, token, room: b.room, broadcast: shown(b) };
  res.status(fresh ? 201 : 200).json(join);
});

export async function endBroadcast(userId: string): Promise<void> {
  const b = live.get(userId);
  if (!b) return;
  live.delete(userId);
  await closeRoom(b.room);
  await tellFriends(userId);
}

broadcastsRouter.delete("/", async (_req, res) => {
  await endBroadcast(me(res).id);
  res.status(204).end();
});

broadcastsRouter.get("/mine", async (_req, res) => {
  const b = live.get(me(res).id);
  if (!b) {
    res.json({ broadcast: null, viewers: [] });
    return;
  }
  const viewers: PublicUser[] = b.viewers.length
    ? await db
        .select({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion })
        .from(users)
        .where(inArray(users.id, b.viewers))
    : [];
  res.json({ broadcast: shown(b), viewers });
});

const watchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

broadcastsRouter.post("/:userId/watch", watchLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const hostId = idParam.safeParse(req.params.userId);
  const viewer = me(res);
  const b = hostId.success ? live.get(hostId.data) : undefined;
  // Only friends can watch (restricted accounts too: only the friends they were given).
  if (!b || !hostId.success || hostId.data === viewer.id || !(await friendIdsOf(viewer.id)).includes(hostId.data)) {
    res.status(404).json({ error: "not_found", message: "That broadcast has ended." });
    return;
  }
  const token = await broadcastToken(b.room, viewer, "viewer");
  const join: BroadcastJoin = { url: LIVEKIT_URL, token, room: b.room, broadcast: shown(b) };
  res.json(join);
});

/**
 * Every 15 seconds: who's watching each broadcast, and ending broadcasts whose broadcaster has
 * left (closed the app, lost the connection) for more than a minute.
 */
export async function sweepBroadcasts(): Promise<void> {
  for (const b of [...live.values()]) {
    const people = await peopleInRoom(b.room);
    if (people === null) continue; // LiveKit couldn't say; try again next time
    if (people.includes(b.userId)) b.seenAt = Date.now();
    else if (Date.now() - b.seenAt > 60_000) {
      await endBroadcast(b.userId);
      continue;
    }
    // Someone unfriended or blocked during the broadcast stops watching right away.
    let viewers = people.filter((id) => id !== b.userId);
    if (viewers.length) {
      const friends = new Set(await friendIdsOf(b.userId));
      for (const id of viewers.filter((v) => !friends.has(v))) await removeFromRoom(b.room, id);
      viewers = viewers.filter((v) => friends.has(v));
    }
    if (viewers.join() !== b.viewers.join()) {
      b.viewers = viewers;
      emitToUser(b.userId, "social:changed", {});
    }
  }
}

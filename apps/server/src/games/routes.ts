import { isRestricted } from "../friends/rules";
import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { cfxCard } from "./cfx";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { gameKey, type MyGame, type MyGamesVisibility } from "@glofly/shared";
import { db } from "../db";
import { userGames, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { areFriends, blockedEitherWay } from "../friends/rules";
import { currentActivity } from "../presence";
import { connectedSummary, emitToUser } from "../realtime";
import { sendStream } from "../storage";
import { coverImage, coversFor, igdbConfigured, isCoverId, searchGames } from "./igdb";

// My games (Glofly 2.0): the games someone has played, with their playtime, from the desktop's
// "Playing …". The server adds a minute every minute while someone's presence says they're
// playing (counted while the game is running, whether or not it's in front). Shown from their
// profile card, to Everyone / Friends / Only me; favorites (starred) first, then most played.
//
//   GET    /games/me                     my games and who can see them
//   PUT    /games/me/settings            { visibility }
//   PUT    /games/me/:key                { favorite?, hidden? }   (key: the game's key as hex)
//   DELETE /games/me/:key                remove a game from my list
//   GET    /games/user/:userId           someone's games (if they share them with me)

export const myGamesRouter = Router();
myGamesRouter.use(requireAuth);

// Communities round: the card under a cfx.re/join link (games/cfx.ts; lookup off until allowed).
myGamesRouter.get(
  "/cfx/:code",
  rateLimit("games:cfx", {
    windowMs: 60 * 1000,
    limit: 30,
    keyGenerator: (_req, res) => (res.locals.user as { id: string }).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message: "That's a lot of server cards. Try again in a minute." },
  }),
  cfxCard,
);

const me = (res: Response) => res.locals.user as { id: string };

// 0.9.1: "Find a game" for the profile board (IGDB through Glofly; games/igdb.ts).
const searchLimiter = rateLimit("games:search", {
  windowMs: 60 * 1000,
  limit: 40,
  keyGenerator: (_req, res) => (res.locals.user as { id: string }).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of searching. Try again in a minute." },
});
myGamesRouter.get("/search", searchLimiter, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
  if (!igdbConfigured) {
    res.json({ games: [], available: false });
    return;
  }
  const games = await searchGames(q);
  if (!games) {
    res.status(502).json({ error: "igdb_unreachable", message: "Couldn't look up games right now. You can still type the name." });
    return;
  }
  res.set("Cache-Control", "private, max-age=300");
  res.json({ games: games.map(({ igdbId: _i, ...g }) => g), available: true });
});

// GET /games/cover/:id — a game's box art (fetched from IGDB once, kept and served by Glofly).
const coverLimiter = rateLimit("games:cover", {
  windowMs: 60 * 1000,
  limit: 300,
  keyGenerator: (_req, res) => (res.locals.user as { id: string }).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
myGamesRouter.get("/cover/:id", coverLimiter, async (req, res) => {
  const id = req.params.id;
  if (!isCoverId(id)) {
    res.status(404).end();
    return;
  }
  const image = await coverImage(id);
  if (!image) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  if (Buffer.isBuffer(image)) {
    res.setHeader("Content-Length", String(image.length));
    res.end(image);
  } else {
    res.setHeader("Content-Length", String(image.size));
    sendStream(image.stream, res);
  }
});
const visibilityField = z.enum(["everyone", "friends", "only_me"]);

/** Every minute: a minute of playtime for everyone with Glofly open who's playing something. */
export async function sweepPlaytime(): Promise<void> {
  const { userIds } = await connectedSummary();
  const now = new Date();
  for (const userId of userIds) {
    const activity = await currentActivity(userId);
    if (!activity) continue;
    const key = gameKey(activity.name);
    if (!key) continue;
    await db
      .insert(userGames)
      .values({ userId, gameKey: key, name: activity.name, seconds: 60, firstPlayedAt: now, lastPlayedAt: now })
      .onConflictDoUpdate({
        target: [userGames.userId, userGames.gameKey],
        set: { seconds: sql`${userGames.seconds} + 60`, lastPlayedAt: now, name: activity.name },
      });
  }
}

async function gamesOf(userId: string, includeHidden: boolean): Promise<MyGame[]> {
  const rows = await db
    .select()
    .from(userGames)
    .where(and(eq(userGames.userId, userId), includeHidden ? undefined : eq(userGames.hidden, false)))
    .orderBy(desc(userGames.favorite), desc(userGames.seconds))
    .limit(200);
  const covers = await coversFor(rows.map((r) => ({ key: r.gameKey, name: r.name })));
  return rows.map((r) => ({
    ...(covers.has(r.gameKey) ? { cover: covers.get(r.gameKey)! } : {}),
    key: r.gameKey,
    name: r.name,
    seconds: r.seconds,
    firstPlayedAt: r.firstPlayedAt.toISOString(),
    lastPlayedAt: r.lastPlayedAt.toISOString(),
    favorite: r.favorite,
    hidden: r.hidden,
  }));
}

async function visibilityOf(userId: string): Promise<MyGamesVisibility> {
  const [row] = await db.select({ v: users.myGamesVisibility }).from(users).where(eq(users.id, userId));
  const parsed = visibilityField.safeParse(row?.v);
  return parsed.success ? parsed.data : "friends";
}

myGamesRouter.get("/me", async (_req, res) => {
  const myId = me(res).id;
  res.json({ visibility: await visibilityOf(myId), games: await gamesOf(myId, true) });
});

myGamesRouter.put("/me/settings", async (req, res) => {
  const v = visibilityField.safeParse(req.body?.visibility);
  if (!v.success) {
    res.status(400).json({ error: "invalid", message: "Pick Everyone, Friends or Only me." });
    return;
  }
  await db.update(users).set({ myGamesVisibility: v.data }).where(eq(users.id, me(res).id));
  emitToUser(me(res).id, "games:changed", {});
  res.json({ visibility: v.data });
});

// A game's key arrives as hex (the apps' request gateway only passes plain characters).
const keyParam = z
  .string()
  .regex(/^(?:[0-9a-f]{2}){1,240}$/)
  .transform((hex) => Buffer.from(hex, "hex").toString("utf8"));

myGamesRouter.put("/me/:key", async (req, res) => {
  const key = keyParam.safeParse(req.params.key);
  const body = z.object({ favorite: z.boolean().optional(), hidden: z.boolean().optional() }).safeParse(req.body);
  if (!key.success || !body.success) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const updated = await db
    .update(userGames)
    .set(body.data)
    .where(and(eq(userGames.userId, me(res).id), eq(userGames.gameKey, key.data)))
    .returning({ key: userGames.gameKey });
  if (!updated.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  emitToUser(me(res).id, "games:changed", {});
  res.json({ games: await gamesOf(me(res).id, true) });
});

myGamesRouter.delete("/me/:key", async (req, res) => {
  const key = keyParam.safeParse(req.params.key);
  if (key.success) await db.delete(userGames).where(and(eq(userGames.userId, me(res).id), eq(userGames.gameKey, key.data)));
  emitToUser(me(res).id, "games:changed", {});
  res.json({ games: await gamesOf(me(res).id, true) });
});

/** 0.9.1 profile preview: whether My games would show to a friend / to anyone else. */
export async function gamesSharedAs(ownerId: string, friend: boolean): Promise<boolean> {
  const own = await visibilityOf(ownerId);
  const visibility = (await isRestricted(ownerId)) ? (own === "only_me" ? "only_me" : "friends") : own;
  return visibility === "everyone" || (visibility === "friends" && friend);
}

/** Whether someone's My games shows to this viewer (0.9.1: also used by profiles). */
export async function gamesSharedWith(viewerId: string, ownerId: string): Promise<boolean> {
  if (viewerId === ownerId) return true;
  const visibility = (await isRestricted(ownerId)) ? (await visibilityOf(ownerId)) === "only_me" ? "only_me" : "friends" : await visibilityOf(ownerId);
  return (
    !(await blockedEitherWay(viewerId, ownerId)) &&
    (visibility === "everyone" || (visibility === "friends" && (await areFriends(viewerId, ownerId))))
  );
}

myGamesRouter.get("/user/:userId", async (req, res) => {
  const id = z.uuid().safeParse(req.params.userId);
  const myId = me(res).id;
  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (id.data === myId) {
    res.json({ visibility: await visibilityOf(myId), games: await gamesOf(myId, false), shared: true });
    return;
  }
  // 0.7.3: a family-managed (restricted) account's games are only ever shown to its friends,
  // whatever its setting says.
  const visibility = (await isRestricted(id.data)) ? (await visibilityOf(id.data)) === "only_me" ? "only_me" : "friends" : await visibilityOf(id.data);
  const shared =
    !(await blockedEitherWay(myId, id.data)) &&
    (visibility === "everyone" || (visibility === "friends" && (await areFriends(myId, id.data))));
  res.json({ visibility, shared, games: shared ? await gamesOf(id.data, false) : [] });
});

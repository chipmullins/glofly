import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { blocks, friendships, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";

// Everything here needs a signed-in user.
export const usersRouter = Router();
export const friendsRouter = Router();
export const blocksRouter = Router();
usersRouter.use(requireAuth);
friendsRouter.use(requireAuth);
blocksRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

// Limits are per account, not per connection.
const perUser = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (_req, res) => me(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message },
  });
const searchLimiter = perUser(60 * 1000, 60, "Slow down a little and try again.");
const requestLimiter = perUser(60 * 60 * 1000, 30, "You've sent a lot of requests. Try again later.");

/** Pairs are stored lower id first, so each pair of people has exactly one row. */
function pair(a: string, b: string): { userLow: string; userHigh: string } {
  return a < b ? { userLow: a, userHigh: b } : { userLow: b, userHigh: a };
}
const pairIs = (a: string, b: string) => {
  const p = pair(a, b);
  return and(eq(friendships.userLow, p.userLow), eq(friendships.userHigh, p.userHigh));
};

/** True if either person has blocked the other. */
async function blockedEitherWay(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(
      or(
        and(eq(blocks.blockerId, a), eq(blocks.blockedId, b)),
        and(eq(blocks.blockerId, b), eq(blocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

const userIdParam = z.uuid();
const publicUser = { id: users.id, username: users.username, displayName: users.displayName };

/** Escapes characters that mean "anything" in a LIKE search, so they're matched literally. */
const likeSafe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// GET /users/search?q=ja — live search for the Add friend dialog.
// Matches the start of a username, or the start of any word in a display name.
usersRouter.get("/search", searchLimiter, async (req, res) => {
  const q = z.string().trim().min(2).max(32).safeParse(req.query.q);
  if (!q.success) {
    res.json({ results: [] });
    return;
  }
  const myId = me(res).id;
  const term = likeSafe(q.data.toLowerCase());

  const found = await db
    .select(publicUser)
    .from(users)
    .where(
      and(
        ne(users.id, myId),
        or(
          ilike(users.username, `${term}%`),
          ilike(users.displayName, `${term}%`),
          ilike(users.displayName, `% ${term}%`),
        ),
        // Blocked users never appear, in either direction.
        sql`not exists (select 1 from ${blocks} where (${blocks.blockerId} = ${myId} and ${blocks.blockedId} = ${users.id}) or (${blocks.blockerId} = ${users.id} and ${blocks.blockedId} = ${myId}))`,
      ),
    )
    .orderBy(
      // Exact username first, then usernames that start with it, then display names.
      sql`case when lower(${users.username}) = ${q.data.toLowerCase()} then 0 when lower(${users.username}) like ${`${term}%`} then 1 else 2 end`,
      users.username,
    )
    .limit(8);

  // What each result is to me: a friend, a sent or received request, or nobody yet.
  const ids = found.map((u) => u.id);
  const links = ids.length
    ? await db
        .select()
        .from(friendships)
        .where(
          or(
            and(eq(friendships.userLow, myId), inArray(friendships.userHigh, ids)),
            and(eq(friendships.userHigh, myId), inArray(friendships.userLow, ids)),
          ),
        )
    : [];

  const results = found.map((u) => {
    const link = links.find((l) => l.userLow === u.id || l.userHigh === u.id);
    const relationship = !link
      ? "none"
      : link.status === "accepted"
        ? "friends"
        : link.requesterId === myId
          ? "outgoing"
          : "incoming";
    return { ...u, relationship };
  });
  res.json({ results });
});

// GET /friends — friends, requests in both directions, and blocked people.
friendsRouter.get("/", async (_req, res) => {
  const myId = me(res).id;
  const otherId = sql`case when ${friendships.userLow} = ${myId} then ${friendships.userHigh} else ${friendships.userLow} end`;

  const rows = await db
    .select({
      ...publicUser,
      status: friendships.status,
      requesterId: friendships.requesterId,
      createdAt: friendships.createdAt,
      acceptedAt: friendships.acceptedAt,
    })
    .from(friendships)
    .innerJoin(users, eq(users.id, otherId))
    .where(or(eq(friendships.userLow, myId), eq(friendships.userHigh, myId)))
    .orderBy(users.displayName);

  const blocked = await db
    .select({ ...publicUser, since: blocks.createdAt })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedId))
    .where(eq(blocks.blockerId, myId))
    .orderBy(users.displayName);

  const strip = (r: (typeof rows)[number]) => ({
    id: r.id,
    username: r.username,
    displayName: r.displayName,
  });
  res.json({
    friends: rows
      .filter((r) => r.status === "accepted")
      .map((r) => ({ ...strip(r), since: r.acceptedAt ?? r.createdAt })),
    incoming: rows
      .filter((r) => r.status === "pending" && r.requesterId !== myId)
      .map((r) => ({ ...strip(r), since: r.createdAt })),
    outgoing: rows
      .filter((r) => r.status === "pending" && r.requesterId === myId)
      .map((r) => ({ ...strip(r), since: r.createdAt })),
    blocked,
  });
});

// POST /friends/requests  { username } — send a friend request.
// If they already sent you one, this accepts it instead.
friendsRouter.post("/requests", requestLimiter, async (req, res) => {
  const parsed = z.object({ username: z.string().trim().min(1).max(40) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Enter a username." });
    return;
  }
  const myId = me(res).id;

  const [target] = await db
    .select(publicUser)
    .from(users)
    .where(sql`lower(${users.username}) = ${parsed.data.username.toLowerCase()}`)
    .limit(1);

  // A block looks exactly like "not found", so blocking never reveals itself.
  if (!target || (await blockedEitherWay(myId, target.id))) {
    res.status(404).json({ error: "not_found", message: "No one has that username." });
    return;
  }
  if (target.id === myId) {
    res.status(400).json({ error: "self", message: "That's you! Try a friend's username." });
    return;
  }

  const [existing] = await db.select().from(friendships).where(pairIs(myId, target.id)).limit(1);
  if (existing?.status === "accepted") {
    res.status(409).json({ error: "already_friends", message: "You're already friends." });
    return;
  }
  if (existing && existing.requesterId === myId) {
    res.status(409).json({ error: "already_sent", message: "You already sent a request." });
    return;
  }
  if (existing) {
    // They asked first, so this is a yes.
    await db
      .update(friendships)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(friendships.id, existing.id));
    res.json({ status: "accepted", user: target });
    return;
  }

  await db
    .insert(friendships)
    .values({ ...pair(myId, target.id), requesterId: myId, status: "pending" })
    .onConflictDoNothing();
  res.status(201).json({ status: "pending", user: target });
});

// POST /friends/requests/:userId/accept — accept a request they sent you.
friendsRouter.post("/requests/:userId/accept", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  if (!them.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const myId = me(res).id;
  const updated = await db
    .update(friendships)
    .set({ status: "accepted", acceptedAt: new Date() })
    .where(
      and(
        pairIs(myId, them.data),
        eq(friendships.status, "pending"),
        eq(friendships.requesterId, them.data),
      ),
    )
    .returning({ id: friendships.id });
  if (!updated.length) {
    res.status(404).json({ error: "not_found", message: "That request isn't there anymore." });
    return;
  }
  res.json({ status: "accepted" });
});

// DELETE /friends/requests/:userId — decline a request to you, or cancel one you sent.
friendsRouter.delete("/requests/:userId", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  if (them.success) {
    await db
      .delete(friendships)
      .where(and(pairIs(me(res).id, them.data), eq(friendships.status, "pending")));
  }
  res.status(204).end();
});

// DELETE /friends/:userId — remove a friend.
friendsRouter.delete("/:userId", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  if (them.success) {
    await db
      .delete(friendships)
      .where(and(pairIs(me(res).id, them.data), eq(friendships.status, "accepted")));
  }
  res.status(204).end();
});

// POST /blocks/:userId — block someone. Also removes any friendship or request between you.
blocksRouter.post("/:userId", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  const myId = me(res).id;
  if (!them.success || them.data === myId) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, them.data));
  if (!exists) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.insert(blocks).values({ blockerId: myId, blockedId: them.data }).onConflictDoNothing();
    await tx.delete(friendships).where(pairIs(myId, them.data));
  });
  res.status(204).end();
});

// DELETE /blocks/:userId — unblock.
blocksRouter.delete("/:userId", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  if (them.success) {
    await db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, me(res).id), eq(blocks.blockedId, them.data)));
  }
  res.status(204).end();
});

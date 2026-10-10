import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { blocks, conversationMembers, friendships, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { emitToUser } from "../realtime";
import { endCallsBetween } from "../calls/service";
import { announcePresence, presenceOf } from "../presence";
import { blockedEitherWay, pair, pairIs } from "./rules";

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

const userIdParam = z.uuid();

/** New friends see each other's status right away. */
async function shareNewFriendPresence(a: string, b: string): Promise<void> {
  await announcePresence(a, emitToUser, true);
  await announcePresence(b, emitToUser, true);
}

/** Tells both people's apps to refresh their friends lists right away. */
function friendsChanged(...userIds: string[]): void {
  for (const id of userIds) emitToUser(id, "friends:changed", {});
}
const publicUser = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarVersion: users.avatarVersion,
};

/** Escapes characters that mean "anything" in a LIKE search, so they're matched literally. */
const likeSafe = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const statusSchema = z.object({
  status: z.enum(["online", "away", "dnd", "invisible"]).optional(),
  statusText: z
    .string()
    .trim()
    .max(80, "Custom status can be up to 80 characters.")
    // eslint-disable-next-line no-control-regex
    .refine((t) => !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(t), "That status has hidden characters.")
    .transform((t) => (t === "" ? null : t))
    .nullable()
    .optional(),
});

async function myStatus(userId: string) {
  const [row] = await db
    .select({ status: users.statusPreference, statusText: users.statusText })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

// GET /users/me/status — the status you picked and your custom status.
usersRouter.get("/me/status", async (_req, res) => {
  res.json(await myStatus(me(res).id));
});

// PATCH /users/me/status  { status?, statusText? } — change them. Friends see it instantly.
usersRouter.patch("/me/status", searchLimiter, async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: parsed.error.issues[0].message });
    return;
  }
  const { status, statusText } = parsed.data;
  const changes: { statusPreference?: typeof status; statusText?: string | null } = {};
  if (status !== undefined) changes.statusPreference = status;
  if (statusText !== undefined) changes.statusText = statusText;
  if (Object.keys(changes).length) {
    await db.update(users).set(changes).where(eq(users.id, me(res).id));
    await announcePresence(me(res).id, emitToUser);
  }
  res.json(await myStatus(me(res).id));
});

const settingsSchema = z
  .object({
    readReceipts: z.boolean(),
    showLastSeen: z.boolean(),
    showTyping: z.boolean(),
    friendRequests: z.enum(["everyone", "nobody"]),
  })
  .partial()
  .strict();

async function mySettings(userId: string) {
  const [row] = await db
    .select({
      readReceipts: users.readReceipts,
      showLastSeen: users.showLastSeen,
      showTyping: users.showTyping,
      friendRequests: users.friendRequests,
    })
    .from(users)
    .where(eq(users.id, userId));
  return row;
}

/** Everyone I have a chat with. */
export async function chatPartnersOf(userId: string): Promise<string[]> {
  const mine = db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId));
  const rows = await db
    .selectDistinct({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(inArray(conversationMembers.conversationId, mine), ne(conversationMembers.userId, userId)));
  return rows.map((r) => r.userId);
}

// GET /users/me/settings — privacy settings.
usersRouter.get("/me/settings", async (_req, res) => {
  res.json(await mySettings(me(res).id));
});

// PATCH /users/me/settings  { readReceipts?, showLastSeen?, showTyping?, friendRequests? }
usersRouter.patch("/me/settings", searchLimiter, async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success || !Object.keys(parsed.data).length) {
    res.status(400).json({ error: "invalid", message: "Something about that setting was off." });
    return;
  }
  const myId = me(res).id;
  const before = await mySettings(myId);
  await db.update(users).set(parsed.data).where(eq(users.id, myId));
  const after = await mySettings(myId);

  // Friends see the change right away.
  if (before.showLastSeen !== after.showLastSeen) await announcePresence(myId, emitToUser, true);
  if (before.readReceipts !== after.readReceipts) {
    for (const id of [myId, ...(await chatPartnersOf(myId))]) emitToUser(id, "conversations:changed", {});
  }
  res.json(after);
});

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
        isNull(users.deleteAfter), // accounts being deleted are hidden
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
    .where(
      and(
        or(eq(friendships.userLow, myId), eq(friendships.userHigh, myId)),
        // Someone deleting their account disappears until they restore it.
        isNull(users.deleteAfter),
      ),
    )
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
    avatarVersion: r.avatarVersion,
    displayName: r.displayName,
  });
  const friendRows = rows.filter((r) => r.status === "accepted");
  const presence = await presenceOf(friendRows.map((r) => r.id));
  const offline = { status: "offline", statusText: null, lastSeenAt: null, activity: null };
  res.json({
    friends: friendRows.map((r) => ({
      ...strip(r),
      since: r.acceptedAt ?? r.createdAt,
      presence: presence.get(r.id) ?? offline,
    })),
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

  const [found] = await db
    .select({ ...publicUser, friendRequests: users.friendRequests, deleteAfter: users.deleteAfter })
    .from(users)
    .where(sql`lower(${users.username}) = ${parsed.data.username.toLowerCase()}`)
    .limit(1);
  const target = found && {
    id: found.id,
    username: found.username,
    displayName: found.displayName,
    avatarVersion: found.avatarVersion,
  };

  // A block looks exactly like "not found", so blocking never reveals itself.
  if (!found || !target || found.deleteAfter || (await blockedEitherWay(myId, target.id))) {
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
    friendsChanged(myId, target.id);
    await shareNewFriendPresence(myId, target.id);
    res.json({ status: "accepted", user: target });
    return;
  }

  // "Who can send me friend requests: No one". (Someone they asked first can still say yes, above.)
  if (found.friendRequests === "nobody") {
    res.status(403).json({
      error: "not_accepting",
      message: `@${target.username} isn't accepting friend requests.`,
    });
    return;
  }

  await db
    .insert(friendships)
    .values({ ...pair(myId, target.id), requesterId: myId, status: "pending" })
    .onConflictDoNothing();
  friendsChanged(myId, target.id);
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
  friendsChanged(myId, them.data);
  await shareNewFriendPresence(myId, them.data);
  res.json({ status: "accepted" });
});

// DELETE /friends/requests/:userId — decline a request to you, or cancel one you sent.
friendsRouter.delete("/requests/:userId", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  if (them.success) {
    await db
      .delete(friendships)
      .where(and(pairIs(me(res).id, them.data), eq(friendships.status, "pending")));
    friendsChanged(me(res).id, them.data);
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
    friendsChanged(me(res).id, them.data);
    await endCallsBetween(me(res).id, them.data); // only friends can call each other
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
  await blockPerson(myId, them.data);
  res.status(204).end();
});

/** Blocks someone: any friendship or request between you goes, and any call between you ends. */
export async function blockPerson(myId: string, themId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(blocks).values({ blockerId: myId, blockedId: themId }).onConflictDoNothing();
    await tx.delete(friendships).where(pairIs(myId, themId));
  });
  friendsChanged(myId, themId);
  await endCallsBetween(myId, themId);
}

// DELETE /blocks/:userId — unblock.
blocksRouter.delete("/:userId", async (req, res) => {
  const them = userIdParam.safeParse(req.params.userId);
  if (them.success) {
    await db
      .delete(blocks)
      .where(and(eq(blocks.blockerId, me(res).id), eq(blocks.blockedId, them.data)));
    friendsChanged(me(res).id);
  }
  res.status(204).end();
});

import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { conversationMembers, conversations, messages, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { canMessage, pair } from "../friends/rules";
import { emitToUser } from "../realtime";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

export const MESSAGE_MAX = 4000;

const sendLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 20,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "You're sending messages very fast. Take a breath and try again." },
});

const idParam = z.uuid();
const messageFields = {
  id: messages.id,
  conversationId: messages.conversationId,
  senderId: messages.senderId,
  body: messages.body,
  createdAt: messages.createdAt,
};

/** The other person in a DM, and whether you're a member at all. */
async function dmPartner(conversationId: string, myId: string) {
  const members = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  if (!members.some((m) => m.userId === myId)) return null; // not your chat
  return members.find((m) => m.userId !== myId)?.userId ?? null;
}

/** Everything the sidebar needs about some of my conversations. */
async function summaries(myId: string, conversationIds?: string[]) {
  const mine = await db
    .select({
      id: conversations.id,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.userId, myId),
        conversationIds ? inArray(conversations.id, conversationIds) : undefined,
      ),
    );
  if (!mine.length) return [];
  const ids = mine.map((c) => c.id);

  const partners = await db
    .select({
      conversationId: conversationMembers.conversationId,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(inArray(conversationMembers.conversationId, ids), ne(conversationMembers.userId, myId)));

  // Newest message in each conversation.
  const latest = await db
    .selectDistinctOn([messages.conversationId], messageFields)
    .from(messages)
    .where(inArray(messages.conversationId, ids))
    .orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id));

  // Messages from the other person since I last read the chat.
  const unread = await db
    .select({ conversationId: messages.conversationId, count: sql<number>`count(*)::int` })
    .from(messages)
    .innerJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, messages.conversationId),
        eq(conversationMembers.userId, myId),
      ),
    )
    .where(
      and(
        inArray(messages.conversationId, ids),
        ne(messages.senderId, myId),
        gt(messages.createdAt, conversationMembers.lastReadAt),
      ),
    )
    .groupBy(messages.conversationId);

  const result = [];
  for (const c of mine) {
    const partner = partners.find((p) => p.conversationId === c.id);
    if (!partner) continue;
    result.push({
      id: c.id,
      partner: { id: partner.id, username: partner.username, displayName: partner.displayName },
      lastMessage: latest.find((m) => m.conversationId === c.id) ?? null,
      unreadCount: unread.find((u) => u.conversationId === c.id)?.count ?? 0,
      canMessage: await canMessage(myId, partner.id),
      activityAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
    });
  }
  return result.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
}

// GET /conversations — my chats, most recent first.
conversationsRouter.get("/", async (_req, res) => {
  res.json({ conversations: await summaries(me(res).id) });
});

// POST /conversations/dm  { userId } — open the DM with a friend (creates it the first time).
conversationsRouter.post("/dm", async (req, res) => {
  const parsed = z.object({ userId: idParam }).safeParse(req.body);
  const myId = me(res).id;
  if (!parsed.success || parsed.data.userId === myId) {
    res.status(400).json({ error: "invalid", message: "Pick a friend to message." });
    return;
  }
  const them = parsed.data.userId;
  if (!(await canMessage(myId, them))) {
    res.status(403).json({ error: "forbidden", message: "You can only message your friends." });
    return;
  }

  const { userLow, userHigh } = pair(myId, them);
  const dmKey = `${userLow}:${userHigh}`;
  const conversationId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversations)
      .values({ dmKey })
      .onConflictDoNothing()
      .returning({ id: conversations.id });
    if (created) {
      await tx.insert(conversationMembers).values([
        { conversationId: created.id, userId: myId },
        { conversationId: created.id, userId: them },
      ]);
      return created.id;
    }
    const [existing] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.dmKey, dmKey));
    return existing.id;
  });

  const [summary] = await summaries(myId, [conversationId]);
  res.json({ conversation: summary });
});

// GET /conversations/:id/messages?before=<messageId>&limit=50 — history, oldest first.
conversationsRouter.get("/:id/messages", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  if (!id.success || (await dmPartner(id.data, myId)) === null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const limit = z.coerce.number().int().min(1).max(100).catch(50).parse(req.query.limit);
  const before = idParam.safeParse(req.query.before);

  // "Older than this message" — by time, with the id breaking ties.
  let olderThan = undefined;
  if (before.success) {
    const [anchor] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(and(eq(messages.id, before.data), eq(messages.conversationId, id.data)));
    if (anchor) {
      olderThan = or(
        lt(messages.createdAt, anchor.createdAt),
        and(eq(messages.createdAt, anchor.createdAt), lt(messages.id, before.data)),
      );
    }
  }

  const rows = await db
    .select(messageFields)
    .from(messages)
    .where(and(eq(messages.conversationId, id.data), olderThan))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);

  res.json({ messages: rows.slice(0, limit).reverse(), hasMore: rows.length > limit });
});

// POST /conversations/:id/messages  { body } — send a message.
conversationsRouter.post("/:id/messages", sendLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = z
    .string()
    .transform((s) => s.replace(/\r\n/g, "\n").trim())
    .pipe(z.string().min(1).max(MESSAGE_MAX))
    .safeParse(req.body?.body);
  const myId = me(res).id;

  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!body.success) {
    res.status(400).json({
      error: "invalid",
      message: `Messages can be 1 to ${MESSAGE_MAX.toLocaleString()} characters.`,
    });
    return;
  }
  const partner = await dmPartner(id.data, myId);
  if (partner === null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!(await canMessage(myId, partner))) {
    res.status(403).json({ error: "forbidden", message: "You can only message your friends." });
    return;
  }

  const message = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(messages)
      .values({ conversationId: id.data, senderId: myId, body: body.data })
      .returning(messageFields);
    await tx
      .update(conversations)
      .set({ lastMessageAt: inserted.createdAt })
      .where(eq(conversations.id, id.data));
    // Sending counts as having read everything before it.
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: inserted.createdAt })
      .where(
        and(eq(conversationMembers.conversationId, id.data), eq(conversationMembers.userId, myId)),
      );
    return inserted;
  });

  // Instantly to both people (all their signed-in devices).
  for (const userId of [myId, partner]) emitToUser(userId, "message:new", { message });
  res.status(201).json({ message });
});

// POST /conversations/:id/read — I've seen everything in this chat.
conversationsRouter.post("/:id/read", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (id.success) {
    await db
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(conversationMembers.conversationId, id.data),
          eq(conversationMembers.userId, me(res).id),
        ),
      );
  }
  res.status(204).end();
});

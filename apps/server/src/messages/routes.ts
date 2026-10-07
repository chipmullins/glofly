import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { alias } from "drizzle-orm/pg-core";
import {
  attachments,
  conversationMembers,
  conversations,
  messageReactions,
  messages,
  users,
} from "../db/schema";
import { storage } from "../storage";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENTS_PER_MESSAGE,
  UNSENT_PER_PERSON,
  attachmentsOf,
  cleanFileName,
  isBlocked,
  keyFor,
  processUpload,
  removeFiles,
  storeUpload,
  unsentCount,
  webpName,
  type Variant,
} from "./attachments";
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
  replyToId: messages.replyToId,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  deletedAt: messages.deletedAt,
};
type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
};

const messageBody = z
  .string()
  .transform((s) => s.replace(/\r\n/g, "\n").trim())
  .pipe(z.string().min(1).max(MESSAGE_MAX));
/** Text with photos or files: a caption, which can be empty. */
const captionBody = z
  .string()
  .optional()
  .transform((s) => (s ?? "").replace(/\r\n/g, "\n").trim())
  .pipe(z.string().max(MESSAGE_MAX));

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of files at once. Wait a minute and try again." },
});

/** A single emoji (including ones built from several characters, like 👍🏽 or 👨‍👩‍👧). */
const emojiParam = z
  .string()
  .min(1)
  .max(32)
  .refine(
    (e) =>
      /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3)+$/u.test(e) &&
      /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e) &&
      !/^[0-9#*]+$/.test(e),
  );
const MAX_REACTIONS_PER_PERSON = 20;

/**
 * Adds everything the app shows with a message: the message it replies to, and reactions.
 * Deleted messages are sent without their text.
 */
async function hydrate(rows: MessageRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];

  const reactions = await db
    .select({ messageId: messageReactions.messageId, emoji: messageReactions.emoji, userId: messageReactions.userId })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, ids))
    .orderBy(messageReactions.createdAt);

  const files = await attachmentsOf([...ids, ...replyIds]);

  const original = alias(messages, "original");
  const replies = replyIds.length
    ? await db
        .select({ id: original.id, senderId: original.senderId, body: original.body, deletedAt: original.deletedAt })
        .from(original)
        .where(inArray(original.id, replyIds))
    : [];

  return rows.map((r) => {
    const deleted = r.deletedAt !== null;
    const grouped: { emoji: string; userIds: string[] }[] = [];
    if (!deleted) {
      for (const x of reactions.filter((x) => x.messageId === r.id)) {
        const g = grouped.find((g) => g.emoji === x.emoji);
        if (g) g.userIds.push(x.userId);
        else grouped.push({ emoji: x.emoji, userIds: [x.userId] });
      }
    }
    const reply = r.replyToId ? replies.find((x) => x.id === r.replyToId) : undefined;
    return {
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      body: deleted ? "" : r.body,
      createdAt: r.createdAt,
      editedAt: deleted ? null : r.editedAt,
      deleted,
      replyTo: reply
        ? {
            id: reply.id,
            senderId: reply.senderId,
            body: reply.deletedAt ? "" : reply.body.slice(0, 200),
            deleted: reply.deletedAt !== null,
            // So a reply to a photo can say "Photo" when there's no text.
            attachment: reply.deletedAt ? null : quoteOf(files.get(reply.id)),
          }
        : null,
      reactions: grouped,
      attachments: deleted ? [] : (files.get(r.id) ?? []),
    };
  });
}

function quoteOf(list: { kind: "image" | "file"; name: string }[] | undefined) {
  const first = list?.[0];
  return first ? { kind: first.kind, name: first.name, count: list.length } : null;
}

/** Sends an event to everyone in a conversation. */
async function broadcast(conversationId: string, event: string, payload: unknown) {
  const members = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  for (const m of members) emitToUser(m.userId, event, payload);
}

/** Loads one message of a conversation (only if you're in that conversation). */
async function findMessage(conversationId: string, messageId: string) {
  const [row] = await db
    .select(messageFields)
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
  return row ?? null;
}

/** Read receipts only show when both people allow them (Settings → Privacy). */
async function receiptsAllowed(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ readReceipts: users.readReceipts })
    .from(users)
    .where(inArray(users.id, [a, b]));
  return rows.length === 2 && rows.every((r) => r.readReceipts);
}

/** Tells the other person "I've read up to here", if both allow read receipts. */
async function shareReadPosition(conversationId: string, readerId: string, partnerId: string, readAt: Date) {
  if (await receiptsAllowed(readerId, partnerId)) {
    emitToUser(partnerId, "conversation:read", {
      conversationId,
      userId: readerId,
      readAt: readAt.toISOString(),
    });
  }
}

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
      avatarVersion: users.avatarVersion,
      readReceipts: users.readReceipts,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(inArray(conversationMembers.conversationId, ids), ne(conversationMembers.userId, myId)));

  const [mySettings] = await db
    .select({ readReceipts: users.readReceipts })
    .from(users)
    .where(eq(users.id, myId));

  // Newest message in each conversation.
  const latest = await hydrate(
    await db
      .selectDistinctOn([messages.conversationId], messageFields)
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id)),
  );

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
      partner: {
        id: partner.id,
        username: partner.username,
        displayName: partner.displayName,
        avatarVersion: partner.avatarVersion,
      },
      lastMessage: latest.find((m) => m.conversationId === c.id) ?? null,
      unreadCount: unread.find((u) => u.conversationId === c.id)?.count ?? 0,
      canMessage: await canMessage(myId, partner.id),
      // How far they've read, shown as "Seen". Only when both people allow read receipts.
      partnerReadAt:
        mySettings?.readReceipts && partner.readReceipts ? partner.lastReadAt.toISOString() : null,
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

  res.json({ messages: await hydrate(rows.slice(0, limit).reverse()), hasMore: rows.length > limit });
});

// POST /conversations/:id/messages  { body } — send a message.
conversationsRouter.post("/:id/messages", sendLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const files = z
    .array(z.uuid())
    .max(ATTACHMENTS_PER_MESSAGE)
    .optional()
    .safeParse(req.body?.attachmentIds ?? undefined);
  const attachmentIds = files.success ? [...new Set(files.data ?? [])] : [];
  const body = (attachmentIds.length ? captionBody : messageBody).safeParse(req.body?.body);
  const replyTo = z.uuid().optional().safeParse(req.body?.replyToId ?? undefined);
  const myId = me(res).id;

  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!files.success) {
    res.status(400).json({
      error: "invalid",
      message: `You can send up to ${ATTACHMENTS_PER_MESSAGE} files at a time.`,
    });
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
  // A reply must point at a message in this same chat that still exists.
  const replyToId = replyTo.success ? (replyTo.data ?? null) : null;
  if (replyToId) {
    const original = await findMessage(id.data, replyToId);
    if (!original || original.deletedAt) {
      res.status(400).json({ error: "invalid", message: "That message isn't available to reply to." });
      return;
    }
  }

  let inserted: MessageRow;
  try {
    inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({ conversationId: id.data, senderId: myId, body: body.data, replyToId })
        .returning(messageFields);
      const inserted = row;
      // Attach your uploads, in the order given. Each must be yours, for this chat, and unsent.
      for (const [position, attachmentId] of attachmentIds.entries()) {
        const claimed = await tx
          .update(attachments)
          .set({ messageId: inserted.id, position })
          .where(
            and(
              eq(attachments.id, attachmentId),
              eq(attachments.conversationId, id.data),
              eq(attachments.uploaderId, myId),
              isNull(attachments.messageId),
            ),
          )
          .returning({ id: attachments.id });
        if (!claimed.length) throw new AttachmentGone();
      }
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
  } catch (err) {
    if (err instanceof AttachmentGone) {
      res.status(400).json({
        error: "invalid",
        message: "One of those files is no longer available. Attach it again.",
      });
      return;
    }
    throw err;
  }

  const [message] = await hydrate([inserted]);
  // Instantly to both people (all their signed-in devices).
  for (const userId of [myId, partner]) emitToUser(userId, "message:new", { message });
  // Replying means you've read everything before it.
  await shareReadPosition(id.data, myId, partner, inserted.createdAt);
  res.status(201).json({ message });
});

class AttachmentGone extends Error {}

/** Shared checks for changing a message: it exists in a chat you're in, and messaging is allowed. */
async function loadForChange(conversationIdRaw: unknown, messageIdRaw: unknown, myId: string) {
  const conversationId = idParam.safeParse(conversationIdRaw);
  const messageId = idParam.safeParse(messageIdRaw);
  if (!conversationId.success || !messageId.success) return { status: 404 as const };
  const partner = await dmPartner(conversationId.data, myId);
  if (partner === null) return { status: 404 as const };
  const message = await findMessage(conversationId.data, messageId.data);
  if (!message) return { status: 404 as const };
  return { status: 200 as const, message, partner, conversationId: conversationId.data };
}

async function sendUpdated(messageId: string, conversationId: string) {
  const [row] = await db.select(messageFields).from(messages).where(eq(messages.id, messageId));
  const [message] = await hydrate([row]);
  await broadcast(conversationId, "message:updated", { message });
  return message;
}

// PATCH /conversations/:id/messages/:messageId  { body } — edit your own message.
conversationsRouter.patch("/:id/messages/:messageId", sendLimiter, async (req, res) => {
  const myId = me(res).id;
  const found = await loadForChange(req.params.id, req.params.messageId, myId);
  if (found.status !== 200) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { message, partner, conversationId } = found;
  if (message.senderId !== myId || message.deletedAt) {
    res.status(403).json({ error: "forbidden", message: "You can only edit your own messages." });
    return;
  }
  if (!(await canMessage(myId, partner))) {
    res.status(403).json({ error: "forbidden", message: "You can only message your friends." });
    return;
  }
  const hasFiles = (await attachmentsOf([message.id])).has(message.id);
  const body = (hasFiles ? captionBody : messageBody).safeParse(req.body?.body);
  if (!body.success) {
    res.status(400).json({
      error: "invalid",
      message: `Messages can be 1 to ${MESSAGE_MAX.toLocaleString()} characters.`,
    });
    return;
  }
  if (body.data !== message.body) {
    await db
      .update(messages)
      .set({ body: body.data, editedAt: new Date() })
      .where(eq(messages.id, message.id));
  }
  res.json({ message: await sendUpdated(message.id, conversationId) });
});

// DELETE /conversations/:id/messages/:messageId — delete your own message.
// Its text and reactions are removed for good; a "deleted" placeholder keeps its place.
conversationsRouter.delete("/:id/messages/:messageId", async (req, res) => {
  const myId = me(res).id;
  const found = await loadForChange(req.params.id, req.params.messageId, myId);
  if (found.status !== 200) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const { message, conversationId } = found;
  if (message.senderId !== myId) {
    res.status(403).json({ error: "forbidden", message: "You can only delete your own messages." });
    return;
  }
  if (!message.deletedAt) {
    const removed = await db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ body: "", deletedAt: new Date(), editedAt: null })
        .where(eq(messages.id, message.id));
      await tx.delete(messageReactions).where(eq(messageReactions.messageId, message.id));
      // Photos and files go too, for good.
      return tx
        .delete(attachments)
        .where(eq(attachments.messageId, message.id))
        .returning({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind });
    });
    await removeFiles(removed);
  }
  res.json({ message: await sendUpdated(message.id, conversationId) });
});

// PUT /conversations/:id/messages/:messageId/reactions/:emoji — add your reaction.
conversationsRouter.put("/:id/messages/:messageId/reactions/:emoji", sendLimiter, async (req, res) => {
  const myId = me(res).id;
  const found = await loadForChange(req.params.id, req.params.messageId, myId);
  const emoji = emojiParam.safeParse(req.params.emoji);
  if (found.status !== 200 || found.message.deletedAt) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!emoji.success) {
    res.status(400).json({ error: "invalid", message: "That isn't an emoji." });
    return;
  }
  if (!(await canMessage(myId, found.partner))) {
    res.status(403).json({ error: "forbidden", message: "You can only react in chats with friends." });
    return;
  }
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messageReactions)
    .where(and(eq(messageReactions.messageId, found.message.id), eq(messageReactions.userId, myId)));
  if (count >= MAX_REACTIONS_PER_PERSON) {
    res.status(400).json({ error: "invalid", message: "That's a lot of reactions on one message!" });
    return;
  }
  await db
    .insert(messageReactions)
    .values({ messageId: found.message.id, userId: myId, emoji: emoji.data })
    .onConflictDoNothing();
  res.json({ message: await sendUpdated(found.message.id, found.conversationId) });
});

// DELETE /conversations/:id/messages/:messageId/reactions/:emoji — remove your reaction.
conversationsRouter.delete("/:id/messages/:messageId/reactions/:emoji", async (req, res) => {
  const myId = me(res).id;
  const found = await loadForChange(req.params.id, req.params.messageId, myId);
  if (found.status !== 200) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db
    .delete(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, found.message.id),
        eq(messageReactions.userId, myId),
        eq(messageReactions.emoji, req.params.emoji),
      ),
    );
  res.json({ message: await sendUpdated(found.message.id, found.conversationId) });
});

// POST /conversations/:id/read — I've seen everything in this chat.
conversationsRouter.post("/:id/read", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  if (id.success) {
    const now = new Date();
    const updated = await db
      .update(conversationMembers)
      .set({ lastReadAt: now })
      .where(
        and(eq(conversationMembers.conversationId, id.data), eq(conversationMembers.userId, myId)),
      )
      .returning({ conversationId: conversationMembers.conversationId });
    if (updated.length) {
      const partner = await dmPartner(id.data, myId);
      if (partner) await shareReadPosition(id.data, myId, partner, now);
    }
  }
  res.status(204).end();
});

// POST /conversations/:id/attachments?name=<file name> — upload a photo or file to send.
// The file itself is the request body. Returns its id, to include when sending the message.
conversationsRouter.post(
  "/:id/attachments",
  uploadLimiter,
  express.raw({ type: () => true, limit: ATTACHMENT_MAX_BYTES }),
  async (req, res) => {
    const id = idParam.safeParse(req.params.id);
    const myId = me(res).id;
    const partner = id.success ? await dmPartner(id.data, myId) : null;
    if (!id.success || partner === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!(await canMessage(myId, partner))) {
      res.status(403).json({ error: "forbidden", message: "You can only send files to friends." });
      return;
    }
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "invalid", message: "That file is empty." });
      return;
    }
    const rawName = z.string().max(1000).catch("file").parse(req.query.name);
    const name = cleanFileName(rawName);
    if (isBlocked(name, data)) {
      res.status(400).json({
        error: "invalid",
        message: `For safety, Glofly doesn't send programs or scripts (${name}).`,
      });
      return;
    }
    if ((await unsentCount(myId)) >= UNSENT_PER_PERSON) {
      res.status(429).json({
        error: "too_many_requests",
        message: "Send or remove the files you've already added first.",
      });
      return;
    }
    const attachment = await storeUpload(id.data, myId, name, await processUpload(data));
    res.status(201).json({ attachment });
  },
);

/** Loads an attachment you're allowed to see: it's in your chat and sent (or you uploaded it). */
async function loadAttachment(conversationIdRaw: unknown, attachmentIdRaw: unknown, myId: string) {
  const conversationId = idParam.safeParse(conversationIdRaw);
  const attachmentId = idParam.safeParse(attachmentIdRaw);
  if (!conversationId.success || !attachmentId.success) return null;
  if ((await dmPartner(conversationId.data, myId)) === null) return null;
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, attachmentId.data), eq(attachments.conversationId, conversationId.data)));
  if (!row || (row.messageId === null && row.uploaderId !== myId)) return null;
  return row;
}

// DELETE /conversations/:id/attachments/:attachmentId — remove an upload you haven't sent.
conversationsRouter.delete("/:id/attachments/:attachmentId", async (req, res) => {
  const myId = me(res).id;
  const row = await loadAttachment(req.params.id, req.params.attachmentId, myId);
  if (!row || row.uploaderId !== myId || row.messageId !== null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await db.delete(attachments).where(eq(attachments.id, row.id));
  await removeFiles([row]);
  res.status(204).end();
});

// GET /conversations/:id/attachments/:attachmentId/:variant — preview | full (photos), file (files).
conversationsRouter.get("/:id/attachments/:attachmentId/:variant", async (req, res) => {
  const row = await loadAttachment(req.params.id, req.params.attachmentId, me(res).id);
  const variant = z.enum(["preview", "full", "file"]).safeParse(req.params.variant);
  const key = row && variant.success ? keyFor(row, variant.data as Variant) : null;
  const file = key ? await storage.get(key) : null;
  if (!row || !file) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  const downloadName = row.kind === "image" ? webpName(row.name) : row.name;
  if (row.kind === "image") {
    res.setHeader("Content-Type", "image/webp");
    // An attachment never changes, so it can be kept.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  } else {
    // Files are only ever downloads: never shown or run by anything that fetches them.
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Cache-Control", "private, no-store");
  }
  res.setHeader(
    "Content-Disposition",
    `${row.kind === "image" && variant.data !== "file" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
  );
  file.stream.pipe(res);
});

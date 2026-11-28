import { Router, type Request, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { and, asc, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { CLEAR_UNDO_MS, notClearedBy } from "./cleared";
import { z } from "zod";
import {
  MESSAGE_MAX,
  PINS_MAX,
  SCHEDULE_MAX_MS,
  SCHEDULE_MIN_MS,
  SCHEDULED_PER_CHAT_MAX,
  type PinnedMessage,
  type ScheduledMessage,
} from "@glofly/shared";
import { db } from "../db";
import { conversationMembers, messages, pinnedMessages, scheduledMessages } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { emitToUser } from "../realtime";
import { access, hydrate, markUnreadFrom, messageFields, postScheduledText, type Access } from "./routes";
import { nebulaOfChat } from "../constellations/chats";
import { can, standingOf } from "../constellations/perms";

// 0.7.3: pinned messages, mark as unread, and send later.
//
//   GET    /conversations/:id/pins                       PinnedMessage[]
//   POST   /conversations/:id/messages/:mid/pin          · DELETE (unpin)
//   POST   /conversations/:id/unread  { messageId }      from that message on is unread again (me only)
//   GET    /conversations/scheduled                      every message I've set to send later
//   GET    /conversations/:id/scheduled                  mine in this chat
//   POST   /conversations/:id/scheduled  { body, sendAt, replyToId? }
//   PATCH  /conversations/:id/scheduled/:sid  { body?, sendAt? } · DELETE
//   POST   /conversations/:id/clear                      0.12.0: clear the chat for me only
//   POST   /conversations/:id/clear/undo  { clearedAt, previous }
//
// Live events (only newer apps listen; older ones ignore unknown events): "pins:changed"
// { conversationId } to everyone in the chat, "conversation:unread" { conversationId, lastReadAt }
// and "scheduled:changed" { conversationId } to my own devices.

export const chatToolsRouter = Router();
chatToolsRouter.use(requireAuth);

const me = (res: Response) => (res.locals.user as { id: string }).id;
const uuid = z.uuid();
const notFound = (res: Response) => res.status(404).json({ error: "not_found" });

const changeLimiter = rateLimit("chat-tools:change", {
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

async function chatFor(req: Request, res: Response): Promise<Access | null> {
  const id = uuid.safeParse(req.params.id);
  const chat = id.success ? await access(id.data, me(res)) : null;
  if (!chat) notFound(res);
  return chat;
}

// ---------------------------------------------------------------------------------------------
// Pins

/** Anyone in a DM or group can pin; in a nebula, people who can delete messages there. */
async function mayPin(chat: Access, userId: string): Promise<boolean> {
  if (chat.kind !== "nebula") return true;
  const nebula = await nebulaOfChat(chat.conversationId);
  if (!nebula) return false;
  const s = await standingOf(nebula.constellationId, userId);
  return !!s && can(s, "deleteMessages");
}

async function pinsOf(conversationId: string, viewerId: string): Promise<PinnedMessage[]> {
  const rows = await db
    .select({ messageId: pinnedMessages.messageId, pinnedBy: pinnedMessages.pinnedBy, pinnedAt: pinnedMessages.pinnedAt })
    .from(pinnedMessages)
    .where(eq(pinnedMessages.conversationId, conversationId))
    .orderBy(desc(pinnedMessages.pinnedAt));
  if (!rows.length) return [];
  const msgs = await db
    .select(messageFields)
    .from(messages)
    .where(and(inArray(messages.id, rows.map((r) => r.messageId)), isNull(messages.deletedAt), notClearedBy(viewerId)));
  const hydrated = new Map((await hydrate(msgs)).map((m) => [m.id, m]));
  return rows
    .filter((r) => hydrated.has(r.messageId))
    .map((r) => ({ message: hydrated.get(r.messageId)! as unknown as PinnedMessage["message"], pinnedBy: r.pinnedBy, pinnedAt: r.pinnedAt.toISOString() }));
}

const pinsChanged = (chat: Access) => {
  for (const userId of chat.memberIds) emitToUser(userId, "pins:changed", { conversationId: chat.conversationId }, chat.kind === "nebula");
};

chatToolsRouter.get("/:id/pins", async (req, res) => {
  const chat = await chatFor(req, res);
  if (!chat) return;
  res.json({ pins: await pinsOf(chat.conversationId, me(res)), canPin: await mayPin(chat, me(res)) });
});

async function setPin(req: Request, res: Response, pin: boolean) {
  const chat = await chatFor(req, res);
  if (!chat) return;
  const mid = uuid.safeParse(req.params.mid);
  if (!mid.success) return void notFound(res);
  if (!(await mayPin(chat, me(res)))) {
    res.status(403).json({ error: "forbidden", message: "Only people who can manage messages here can pin them." });
    return;
  }
  const [msg] = await db
    .select({ id: messages.id, deletedAt: messages.deletedAt, event: messages.event })
    .from(messages)
    .where(and(eq(messages.id, mid.data), eq(messages.conversationId, chat.conversationId)));
  if (!msg) return void notFound(res);
  if (pin) {
    if (msg.deletedAt || msg.event) {
      res.status(400).json({ error: "invalid", message: "That message can't be pinned." });
      return;
    }
    const count = await db.$count(pinnedMessages, eq(pinnedMessages.conversationId, chat.conversationId));
    if (count >= PINS_MAX) {
      res.status(409).json({ error: "too_many", message: `A chat can have up to ${PINS_MAX} pins. Unpin one first.` });
      return;
    }
    await db.insert(pinnedMessages).values({ conversationId: chat.conversationId, messageId: msg.id, pinnedBy: me(res) }).onConflictDoNothing();
  } else {
    await db.delete(pinnedMessages).where(and(eq(pinnedMessages.conversationId, chat.conversationId), eq(pinnedMessages.messageId, msg.id)));
  }
  pinsChanged(chat);
  res.json({ pins: await pinsOf(chat.conversationId, me(res)) });
}
chatToolsRouter.post("/:id/messages/:mid/pin", changeLimiter, (req, res) => setPin(req, res, true));
chatToolsRouter.delete("/:id/messages/:mid/pin", changeLimiter, (req, res) => setPin(req, res, false));

// ---------------------------------------------------------------------------------------------
// Mark as unread

chatToolsRouter.post("/:id/unread", changeLimiter, async (req, res) => {
  const chat = await chatFor(req, res);
  if (!chat) return;
  const mid = uuid.safeParse(req.body?.messageId);
  if (!mid.success) return void notFound(res);
  const at = await markUnreadFrom(chat.conversationId, me(res), mid.data);
  if (!at) return void notFound(res);
  emitToUser(me(res), "conversation:unread", { conversationId: chat.conversationId, lastReadAt: at.toISOString() }, true);
  res.json({ lastReadAt: at.toISOString() });
});

// ---------------------------------------------------------------------------------------------
// Clear chat (0.12.0): the chat starts empty for me on all my devices. Nothing is deleted and the
// other people see every message. Clearing also marks it read. Live event to my own devices
// (newer apps): "conversation:cleared" { conversationId, clearedAt }; older apps get the usual
// "conversations:changed" and the server already filters their history.

const clearedEvent = (userId: string, conversationId: string, clearedAt: Date | null) => {
  emitToUser(userId, "conversation:cleared", { conversationId, clearedAt: clearedAt?.toISOString() ?? null }, true);
  emitToUser(userId, "conversations:changed", {});
};

chatToolsRouter.post("/:id/clear", changeLimiter, async (req, res) => {
  const chat = await chatFor(req, res);
  if (!chat) return;
  const now = new Date();
  const where = and(eq(conversationMembers.conversationId, chat.conversationId), eq(conversationMembers.userId, me(res)));
  const [before] = await db.select({ clearedAt: conversationMembers.clearedAt }).from(conversationMembers).where(where);
  await db.update(conversationMembers).set({ clearedAt: now, lastReadAt: now }).where(where);
  clearedEvent(me(res), chat.conversationId, now);
  res.json({ clearedAt: now.toISOString(), previous: before?.clearedAt?.toISOString() ?? null });
});

const undoBody = z.object({ clearedAt: z.iso.datetime({ offset: true }), previous: z.iso.datetime({ offset: true }).nullable() });

chatToolsRouter.post("/:id/clear/undo", changeLimiter, async (req, res) => {
  const chat = await chatFor(req, res);
  if (!chat) return;
  const body = undoBody.safeParse(req.body);
  if (!body.success) return void res.status(400).json({ error: "invalid" });
  const clearedAt = new Date(body.data.clearedAt);
  const previous = body.data.previous ? new Date(body.data.previous) : null;
  const where = and(eq(conversationMembers.conversationId, chat.conversationId), eq(conversationMembers.userId, me(res)));
  const [row] = await db.select({ clearedAt: conversationMembers.clearedAt }).from(conversationMembers).where(where);
  // Only the clear just made (not a newer one), only for a while, and only back to an earlier point.
  if (!row?.clearedAt || Math.abs(row.clearedAt.getTime() - clearedAt.getTime()) > 1 || Date.now() - clearedAt.getTime() > CLEAR_UNDO_MS || (previous && previous >= row.clearedAt)) {
    res.status(409).json({ error: "too_late", message: "This chat can't be brought back any more." });
    return;
  }
  await db.update(conversationMembers).set({ clearedAt: previous }).where(where);
  clearedEvent(me(res), chat.conversationId, previous);
  res.json({ clearedAt: previous?.toISOString() ?? null });
});

// ---------------------------------------------------------------------------------------------
// Send later

const view = (r: typeof scheduledMessages.$inferSelect): ScheduledMessage => ({
  id: r.id,
  conversationId: r.conversationId,
  body: r.body,
  replyToId: r.replyToId,
  sendAt: r.sendAt.toISOString(),
  failed: r.failed,
  createdAt: r.createdAt.toISOString(),
});

const bodyField = z.string().trim().min(1).max(MESSAGE_MAX);
function sendAtField(raw: unknown): Date | string {
  const t = typeof raw === "string" ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) return "Pick when to send it.";
  if (t < Date.now() + SCHEDULE_MIN_MS - 5000) return "Pick a time at least a minute from now.";
  if (t > Date.now() + SCHEDULE_MAX_MS) return "Pick a time within the next year.";
  return new Date(t);
}
const scheduledChanged = (userId: string, conversationId: string) => emitToUser(userId, "scheduled:changed", { conversationId }, true);

chatToolsRouter.get("/scheduled", async (_req, res) => {
  const rows = await db.select().from(scheduledMessages).where(eq(scheduledMessages.senderId, me(res))).orderBy(asc(scheduledMessages.sendAt));
  res.json({ scheduled: rows.map(view) });
});

chatToolsRouter.get("/:id/scheduled", async (req, res) => {
  const chat = await chatFor(req, res);
  if (!chat) return;
  const rows = await db
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.senderId, me(res)), eq(scheduledMessages.conversationId, chat.conversationId)))
    .orderBy(asc(scheduledMessages.sendAt));
  res.json({ scheduled: rows.map(view) });
});

chatToolsRouter.post("/:id/scheduled", changeLimiter, async (req, res) => {
  const chat = await chatFor(req, res);
  if (!chat) return;
  const body = bodyField.safeParse(req.body?.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid", message: `Messages can be 1 to ${MESSAGE_MAX.toLocaleString()} characters.` });
    return;
  }
  const sendAt = sendAtField(req.body?.sendAt);
  if (typeof sendAt === "string") {
    res.status(400).json({ error: "invalid", message: sendAt });
    return;
  }
  const replyTo = req.body?.replyToId ? uuid.safeParse(req.body.replyToId) : null;
  const waiting = await db.$count(
    scheduledMessages,
    and(eq(scheduledMessages.senderId, me(res)), eq(scheduledMessages.conversationId, chat.conversationId), isNull(scheduledMessages.failed)),
  );
  if (waiting >= SCHEDULED_PER_CHAT_MAX) {
    res.status(409).json({ error: "too_many", message: `You can have up to ${SCHEDULED_PER_CHAT_MAX} messages waiting in one chat.` });
    return;
  }
  const [row] = await db
    .insert(scheduledMessages)
    .values({
      conversationId: chat.conversationId,
      senderId: me(res),
      body: body.data,
      replyToId: replyTo?.success ? replyTo.data : null,
      sendAt,
    })
    .returning();
  scheduledChanged(me(res), chat.conversationId);
  res.status(201).json({ scheduled: view(row) });
});

async function mine(req: Request, res: Response) {
  const chat = await chatFor(req, res);
  if (!chat) return null;
  const sid = uuid.safeParse(req.params.sid);
  if (!sid.success) return void notFound(res), null;
  const [row] = await db
    .select()
    .from(scheduledMessages)
    .where(and(eq(scheduledMessages.id, sid.data), eq(scheduledMessages.senderId, me(res)), eq(scheduledMessages.conversationId, chat.conversationId)));
  if (!row) return void notFound(res), null;
  return row;
}

chatToolsRouter.patch("/:id/scheduled/:sid", changeLimiter, async (req, res) => {
  const row = await mine(req, res);
  if (!row) return;
  const set: Partial<typeof scheduledMessages.$inferInsert> = { failed: null };
  if (req.body?.body !== undefined) {
    const body = bodyField.safeParse(req.body.body);
    if (!body.success) {
      res.status(400).json({ error: "invalid", message: `Messages can be 1 to ${MESSAGE_MAX.toLocaleString()} characters.` });
      return;
    }
    set.body = body.data;
  }
  if (req.body?.sendAt !== undefined) {
    const sendAt = sendAtField(req.body.sendAt);
    if (typeof sendAt === "string") {
      res.status(400).json({ error: "invalid", message: sendAt });
      return;
    }
    set.sendAt = sendAt;
  }
  const [updated] = await db.update(scheduledMessages).set(set).where(eq(scheduledMessages.id, row.id)).returning();
  scheduledChanged(me(res), row.conversationId);
  res.json({ scheduled: view(updated) });
});

chatToolsRouter.delete("/:id/scheduled/:sid", changeLimiter, async (req, res) => {
  const row = await mine(req, res);
  if (!row) return;
  await db.delete(scheduledMessages).where(eq(scheduledMessages.id, row.id));
  scheduledChanged(me(res), row.conversationId);
  res.status(204).end();
});

/** POST /conversations/:id/scheduled/:sid/send — send it right now */
chatToolsRouter.post("/:id/scheduled/:sid/send", changeLimiter, async (req, res) => {
  const row = await mine(req, res);
  if (!row) return;
  const gone = await db.delete(scheduledMessages).where(eq(scheduledMessages.id, row.id)).returning({ id: scheduledMessages.id });
  if (!gone.length) return void notFound(res);
  const r = await postScheduledText(row.conversationId, row.senderId, row.body, row.replyToId);
  if (!r.ok) {
    await db.insert(scheduledMessages).values({ ...row, failed: r.reason });
    scheduledChanged(row.senderId, row.conversationId);
    res.status(403).json({ error: "forbidden", message: r.reason });
    return;
  }
  scheduledChanged(row.senderId, row.conversationId);
  res.status(204).end();
});

// ---------------------------------------------------------------------------------------------
// The sweep: sends what's due (every 15 seconds; index.ts starts it). Each row is taken by
// deleting it first, so two servers (or two sweeps) never send the same one twice.

let sweeping = false;
export async function sendDueMessages(): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  let sent = 0;
  try {
    const due = await db
      .select({ id: scheduledMessages.id })
      .from(scheduledMessages)
      .where(and(lte(scheduledMessages.sendAt, new Date()), isNull(scheduledMessages.failed)))
      .orderBy(asc(scheduledMessages.sendAt))
      .limit(100);
    for (const { id } of due) {
      const [row] = await db.delete(scheduledMessages).where(eq(scheduledMessages.id, id)).returning();
      if (!row) continue;
      try {
        const r = await postScheduledText(row.conversationId, row.senderId, row.body, row.replyToId);
        if (r.ok) sent++;
        else await db.insert(scheduledMessages).values({ ...row, failed: r.reason });
      } catch (err) {
        console.error("A scheduled message couldn't be sent", err);
        await db.insert(scheduledMessages).values({ ...row, failed: "Something went wrong sending it. Try Send now." });
      }
      scheduledChanged(row.senderId, row.conversationId);
    }
  } finally {
    sweeping = false;
  }
  return sent;
}

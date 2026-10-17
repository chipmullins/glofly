import { randomUUID } from "node:crypto";
import express, { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { alias } from "drizzle-orm/pg-core";
import {
  attachments,
  conversationMembers,
  conversations,
  messageReactions,
  messages,
  pollVotes,
  users,
  type ChatEvent,
  type GameInfo,
  type GifInfo,
  type LinkPreviewInfo,
  type PollInfo,
  type VoiceInfo,
} from "../db/schema";
import { storage } from "../storage";
import {
  ATTACHMENT_MAX_BYTES,
  VIDEO_MAX_BYTES,
  ATTACHMENTS_PER_MESSAGE,
  UNSENT_PER_PERSON,
  VOICE_MAX_BYTES,
  VOICE_MAX_MS,
  VOICE_PEAKS_MAX,
  attachmentsOf,
  voiceFormat,
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
import { blockedEitherWay, canMessage, deletionPending, groupBreaksRestriction, pair } from "../friends/rules";
import { emitToUser } from "../realtime";
import { removeFromChatCall } from "../calls/service";
import { mentionsIn } from "./mentions";
import { voiceAsM4a } from "./voiceM4a";
import { examineVideo, videoContainer } from "./video";
import { pollView, votesFor } from "./polls";
import { gifById } from "./gifs";
import { addLinkPreview, removePreviewImage } from "./previews";
import { firstLink } from "./links";
import { inBackground, notifyMessage, notifyRead } from "../push/notify";
import {
  GROUP_MAX,
  GROUP_NAME_MAX,
  legacyEventBody,
  eventField,
  MAX_PINNED,
  MAX_REACTIONS_PER_PERSON,
  MESSAGE_MAX,
  gifFallback,
  publicGame,
  type GameState,
} from "@glofly/shared";
import { groupPhotoKey, PHOTO_UPLOAD_MAX, squarePhoto } from "../profile/photo";

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

type Me = { id: string; username: string; displayName: string };
const me = (res: Response): Me => res.locals.user as Me;

export { MESSAGE_MAX, MAX_PINNED, GROUP_MAX, GROUP_NAME_MAX } from "@glofly/shared";

const sendLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 20,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "You're sending messages very fast. Take a breath and try again." },
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of searching. Try again in a minute." },
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
  event: messages.event,
  mentions: messages.mentions,
  gif: messages.gif,
  linkPreview: messages.linkPreview,
  poll: messages.poll,
  game: messages.game,
  lantern: messages.lantern,
  lanternFadeAt: messages.lanternFadeAt,
};
export type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  replyToId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  event: ChatEvent | null;
  mentions: string[];
  gif: GifInfo | null;
  linkPreview: LinkPreviewInfo | null;
  poll: PollInfo | null;
  game: GameInfo | null;
  lantern: boolean;
  lanternFadeAt: Date | null;
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

/** A single emoji (including ones built from several characters, like 👍🏽, 👨‍👩‍👧 or the keycap 1️⃣). */
const emojiParam = z
  .string()
  .min(1)
  .max(32)
  .refine(
    (e) =>
      /^[0-9#*]\ufe0f?\u20e3$/u.test(e) ||
      (/^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\p{Regional_Indicator}|\u200d|\ufe0f|\u20e3)+$/u.test(e) &&
        /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(e) &&
        !/^[0-9#*]+$/.test(e)),
  );

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
  const votes = await votesFor(rows.filter((r) => r.poll && !r.deletedAt).map((r) => r.id));

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
    const legacy = legacyEvent(r.event);
    return {
      id: r.id,
      conversationId: r.conversationId,
      senderId: r.senderId,
      body: deleted ? "" : (legacy?.body ?? r.body),
      createdAt: r.createdAt,
      editedAt: deleted ? null : r.editedAt,
      deleted,
      // Group events ("Chip renamed the group"): shown as a line, not a message bubble.
      event: legacy ? null : (r.event ?? null),
      // Event lines added after 0.2.0 (a group photo): 0.2.1+ apps show these as lines; older
      // apps don't know them, so for them it's a plain message ("changed the group photo").
      // Lines newer than 0.4.0 (Watch Together) go as `eventLine2`, so 0.2.1–0.4.0 apps show the
      // plain message too instead of an empty line (packages/shared/src/events.ts).
      ...(legacy ? { [eventField(r.event)]: r.event } : {}),
      // Group members this message @mentions.
      mentions: deleted ? [] : (r.mentions ?? []),
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
      // 0.5.0 (older apps ignore these and show the body, which carries a text version).
      gif: deleted ? null : r.gif,
      linkPreview: deleted ? null : r.linkPreview,
      poll: deleted || !r.poll ? null : pollView(r.poll, votes.get(r.id) ?? []),
      game: deleted || !r.game ? null : publicGame(r.game as unknown as GameState),
      lantern: r.lantern,
      lanternFadeAt: r.lanternFadeAt?.toISOString() ?? null,
    };
  });
}

/** Event types every app version knows. */
function legacyEvent(event: ChatEvent | null): { body: string } | null {
  const body = legacyEventBody(event);
  return body === null ? null : { body };
}

function quoteOf(list: { kind: "image" | "file"; name: string; voice?: unknown; video?: unknown }[] | undefined) {
  const first = list?.[0];
  // voice: so a reply to a voice message can say "Voice message" (0.2.1+; older apps show the name).
  // video (0.5.0): likewise "Video".
  return first
    ? { kind: first.kind, name: first.name, count: list.length, voice: !!first.voice, video: !!first.video }
    : null;
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

export type Access = {
  kind: "dm" | "group";
  memberIds: string[];
  /** DMs: the other person */
  partner: string | null;
  /** Groups: who can remove people */
  createdBy: string | null;
  name: string | null;
  /** Groups: the group photo's version (null = members' faces) */
  photoVersion: string | null;
};

/** A chat I'm in (null if it doesn't exist or I'm not a member). */
export async function access(conversationId: string, myId: string): Promise<Access | null> {
  const [conversation] = await db
    .select({
      kind: conversations.kind,
      createdBy: conversations.createdBy,
      name: conversations.name,
      photoVersion: conversations.photoVersion,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  if (!conversation) return null;
  const members = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId));
  const memberIds = members.map((m) => m.userId);
  if (!memberIds.includes(myId)) return null; // not your chat
  return {
    kind: conversation.kind,
    memberIds,
    partner: conversation.kind === "dm" ? (memberIds.find((id) => id !== myId) ?? null) : null,
    createdBy: conversation.createdBy,
    name: conversation.name,
    photoVersion: conversation.photoVersion,
  };
}

/** Can I post here? DMs need us to be friends (and not blocked); groups just need me in it. */
export async function canPost(chat: Access, myId: string): Promise<boolean> {
  if (chat.kind === "group") return !(await deletionPending(myId));
  return chat.partner !== null && (await canMessage(myId, chat.partner));
}

const CANT_POST = "You can only message your friends.";

/** Everything the sidebar needs about some of my conversations. */
async function summaries(myId: string, conversationIds?: string[]) {
  const mine = await db
    .select({
      id: conversations.id,
      kind: conversations.kind,
      name: conversations.name,
      photoVersion: conversations.photoVersion,
      createdBy: conversations.createdBy,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      lastReadAt: conversationMembers.lastReadAt,
      pinnedAt: conversationMembers.pinnedAt,
      joinedAt: conversationMembers.joinedAt,
      groupPosition: conversationMembers.groupPosition,
      mutedUntil: conversationMembers.mutedUntil,
      closedAt: conversationMembers.closedAt,
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

  // Everyone else in these chats (DMs: the other person; groups: the other members).
  const others = await db
    .select({
      conversationId: conversationMembers.conversationId,
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
      readReceipts: users.readReceipts,
      lastReadAt: conversationMembers.lastReadAt,
      joinedAt: conversationMembers.joinedAt,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(inArray(conversationMembers.conversationId, ids), ne(conversationMembers.userId, myId)))
    .orderBy(conversationMembers.joinedAt, users.username);

  const [mySettings] = await db
    .select({ readReceipts: users.readReceipts })
    .from(users)
    .where(eq(users.id, myId));
  const iAmLeaving = await deletionPending(myId);

  // Newest message in each conversation.
  const latest = await hydrate(
    await db
      .selectDistinctOn([messages.conversationId], messageFields)
      .from(messages)
      .where(inArray(messages.conversationId, ids))
      .orderBy(messages.conversationId, desc(messages.createdAt), desc(messages.id)),
  );

  // Messages from other people since I last read the chat. Lines like "Chip added Maya" don't
  // count; a call you missed does.
  const unread = await db
    .select({
      conversationId: messages.conversationId,
      count: sql<number>`count(*)::int`,
      // Of those, the ones that @mention me.
      mentions: sql<number>`count(*) filter (where ${myId}::uuid = any(${messages.mentions}))::int`,
    })
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
        or(
          isNull(messages.event),
          sql`(${messages.event}->>'type' = 'call' and ${messages.event}->>'status' = 'missed')`,
        ),
        gt(messages.createdAt, conversationMembers.lastReadAt),
      ),
    )
    .groupBy(messages.conversationId);

  const person = (p: (typeof others)[number]) => ({
    id: p.id,
    username: p.username,
    displayName: p.displayName,
    avatarVersion: p.avatarVersion,
  });

  const result = [];
  for (const c of mine) {
    const members = others.filter((p) => p.conversationId === c.id);
    const common = {
      id: c.id,
      lastMessage: latest.find((m) => m.conversationId === c.id) ?? null,
      unreadCount: unread.find((u) => u.conversationId === c.id)?.count ?? 0,
      mentionCount: unread.find((u) => u.conversationId === c.id)?.mentions ?? 0,
      // Muted by me until then (null once it's over).
      mutedUntil: c.mutedUntil && c.mutedUntil.getTime() > Date.now() ? c.mutedUntil.toISOString() : null,
      activityAt: (c.lastMessageAt ?? c.createdAt).toISOString(),
      // Pinned chats sit at the top of the sidebar, in the order they were pinned.
      pinnedAt: c.pinnedAt?.toISOString() ?? null,
      // When I joined (groups page: groups never moved sit at the top, newest first).
      joinedAt: c.joinedAt.toISOString(),
      // When I closed it in my sidebar. The app hides it until a newer message arrives.
      closedAt: c.closedAt?.toISOString() ?? null,
    };
    if (c.kind === "group") {
      result.push({
        ...common,
        kind: "group" as const,
        partner: null,
        name: c.name,
        // The group photo (null = shown as two members' faces).
        photoVersion: c.photoVersion,
        // The other members, longest-standing first.
        members: members.map(person),
        memberCount: members.length + 1,
        createdBy: c.createdBy,
        canMessage: !iAmLeaving,
        partnerReadAt: null,
        // Where I dragged it on the Groups page (null = never moved).
        groupPosition: c.groupPosition,
      });
      continue;
    }
    const partner = members[0];
    if (!partner) continue;
    result.push({
      ...common,
      kind: "dm" as const,
      partner: person(partner),
      name: null,
      members: [person(partner)],
      memberCount: 2,
      createdBy: null,
      canMessage: await canMessage(myId, partner.id),
      // How far they've read, shown as "Seen". Only when both people allow read receipts.
      partnerReadAt:
        mySettings?.readReceipts && partner.readReceipts ? partner.lastReadAt.toISOString() : null,
      groupPosition: null,
    });
  }
  return result.sort((a, b) => b.activityAt.localeCompare(a.activityAt));
}

// GET /conversations — my chats, most recent first.
conversationsRouter.get("/", async (_req, res) => {
  res.json({ conversations: await summaries(me(res).id) });
});


/** Pins or unpins a chat for me; my other devices update right away. */
async function setPinned(myId: string, conversationId: string, pinned: boolean) {
  const updated = await db
    .update(conversationMembers)
    .set(pinned ? { pinnedAt: new Date(), closedAt: null } : { pinnedAt: null }) // pinning reopens a closed chat
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, myId)))
    .returning({ id: conversationMembers.conversationId });
  if (updated.length) emitToUser(myId, "conversations:changed", {});
  return updated.length > 0;
}

// PUT /conversations/:id/pin — pin a chat to the top of my sidebar (up to 10).
conversationsRouter.put("/:id/pin", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [mine] = await db
    .select({ pinnedAt: conversationMembers.pinnedAt })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, id.data), eq(conversationMembers.userId, myId)));
  if (!mine) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!mine.pinnedAt) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.userId, myId), isNotNull(conversationMembers.pinnedAt)));
    if (count >= MAX_PINNED) {
      res.status(409).json({
        error: "too_many_pinned",
        message: `You can pin up to ${MAX_PINNED} chats. Unpin one first.`,
      });
      return;
    }
    await setPinned(myId, id.data, true);
  }
  res.status(204).end();
});

// DELETE /conversations/:id/pin — unpin it.
conversationsRouter.delete("/:id/pin", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (id.success) await setPinned(me(res).id, id.data, false);
  res.status(204).end();
});

/** Closes or reopens a chat in my sidebar; my other devices update right away. */
async function setClosed(myId: string, conversationId: string, closed: boolean) {
  const now = new Date();
  const updated = await db
    .update(conversationMembers)
    // Closing also marks it read, so it can't keep counting on the unread badge while hidden.
    .set(closed ? { closedAt: now, lastReadAt: now } : { closedAt: null })
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, myId),
        closed ? undefined : isNotNull(conversationMembers.closedAt),
      ),
    )
    .returning({ id: conversationMembers.conversationId });
  if (updated.length) emitToUser(myId, "conversations:changed", {});
  return updated.length > 0;
}

// PUT /conversations/:id/close — hide a chat from my sidebar (nothing is deleted). It comes
// back by itself when a new message arrives. Pinned chats have to be unpinned first.
conversationsRouter.put("/:id/close", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [mine] = await db
    .select({ pinnedAt: conversationMembers.pinnedAt })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, id.data), eq(conversationMembers.userId, myId)));
  if (!mine) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (mine.pinnedAt) {
    res.status(409).json({ error: "pinned", message: "Unpin this chat before closing it." });
    return;
  }
  await setClosed(myId, id.data, true);
  res.status(204).end();
});

// DELETE /conversations/:id/close — open it again (from search, Friends or Groups).
conversationsRouter.delete("/:id/close", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (id.success) await setClosed(me(res).id, id.data, false);
  res.status(204).end();
});

/** "Until I turn it back on": far enough ahead to never run out. */
export const MUTED_FOREVER = new Date("2100-01-01T00:00:00Z");
const MUTE_HOURS = { "1h": 1, "8h": 8, "24h": 24 } as const;

// PUT /conversations/:id/mute  { duration: "1h" | "8h" | "24h" | "forever" } — no sounds or
// notifications from this chat for a while (mentions of me still get through).
conversationsRouter.put("/:id/mute", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const duration = z.object({ duration: z.enum(["1h", "8h", "24h", "forever"]) }).safeParse(req.body);
  if (!id.success) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!duration.success) {
    res.status(400).json({ error: "invalid", message: "Pick how long to mute it for." });
    return;
  }
  const d = duration.data.duration;
  const until = d === "forever" ? MUTED_FOREVER : new Date(Date.now() + MUTE_HOURS[d] * 60 * 60 * 1000);
  const myId = me(res).id;
  const updated = await db
    .update(conversationMembers)
    .set({ mutedUntil: until })
    .where(and(eq(conversationMembers.conversationId, id.data), eq(conversationMembers.userId, myId)))
    .returning({ id: conversationMembers.conversationId });
  if (!updated.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  emitToUser(myId, "conversations:changed", {});
  res.json({ mutedUntil: until.toISOString() });
});

// DELETE /conversations/:id/mute — unmute.
conversationsRouter.delete("/:id/mute", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  if (id.success) {
    const updated = await db
      .update(conversationMembers)
      .set({ mutedUntil: null })
      .where(and(eq(conversationMembers.conversationId, id.data), eq(conversationMembers.userId, myId)))
      .returning({ id: conversationMembers.conversationId });
    if (updated.length) emitToUser(myId, "conversations:changed", {});
  }
  res.json({ mutedUntil: null });
});

// PUT /conversations/groups/order  { ids } — my order for the Groups page (drag to reorder).
// Groups listed get positions 0, 1, 2…; groups I'm in but not listed keep theirs.
conversationsRouter.put("/groups/order", async (req, res) => {
  const myId = me(res).id;
  const parsed = z.object({ ids: z.array(idParam).min(1).max(1000) }).safeParse(req.body);
  if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    res.status(400).json({ error: "invalid", message: "That order didn't make sense. Try again." });
    return;
  }
  const ids = parsed.data.ids;
  const mine = await db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.userId, myId),
        eq(conversations.kind, "group"),
        inArray(conversationMembers.conversationId, ids),
      ),
    );
  const allowed = new Set(mine.map((m) => m.id));
  await db.transaction(async (tx) => {
    let position = 0;
    for (const id of ids) {
      if (!allowed.has(id)) continue; // not mine (or left meanwhile): skipped
      await tx
        .update(conversationMembers)
        .set({ groupPosition: position++ })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, myId)));
    }
  });
  emitToUser(myId, "conversations:changed", {});
  res.status(204).end();
});

// PUT /conversations/pins/order  { ids } — my order for the pinned chats in the sidebar (drag to
// reorder). Pins are shown oldest pin first on every app, so the new order is saved by giving the
// listed pins new pinned times in that order (starting from the earliest of them). Older apps then
// show the new order too, with nothing new to learn. Chats not pinned by me are skipped.
conversationsRouter.put("/pins/order", async (req, res) => {
  const myId = me(res).id;
  const parsed = z.object({ ids: z.array(idParam).min(1).max(50) }).safeParse(req.body);
  if (!parsed.success || new Set(parsed.data.ids).size !== parsed.data.ids.length) {
    res.status(400).json({ error: "invalid", message: "That order didn't make sense. Try again." });
    return;
  }
  const ids = parsed.data.ids;
  const pins = await db
    .select({ id: conversationMembers.conversationId, pinnedAt: conversationMembers.pinnedAt })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.userId, myId),
        isNotNull(conversationMembers.pinnedAt),
        inArray(conversationMembers.conversationId, ids),
      ),
    );
  if (pins.length === 0) {
    res.status(204).end();
    return;
  }
  const allowed = new Set(pins.map((p) => p.id));
  const base = Math.min(...pins.map((p) => p.pinnedAt!.getTime()));
  await db.transaction(async (tx) => {
    let step = 0;
    for (const id of ids) {
      if (!allowed.has(id)) continue; // unpinned (or left) meanwhile: skipped
      await tx
        .update(conversationMembers)
        .set({ pinnedAt: new Date(base + step++) })
        .where(and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, myId)));
    }
  });
  emitToUser(myId, "conversations:changed", {});
  res.status(204).end();
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

  // Opening a chat I'd closed brings it back to my sidebar.
  await setClosed(myId, conversationId, false);
  const [summary] = await summaries(myId, [conversationId]);
  res.json({ conversation: summary });
});

// ---------------------------------------------------------------------------------------
// Group chats. Up to 25 people, all added by a friend. Anyone in the group can rename it and
// add their friends; the person who made it can remove people. Anyone can leave. If the
// creator leaves, whoever has been in the group longest takes over.

const GROUP_HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/;

const groupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 40,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of group changes. Wait a few minutes and try again." },
});

/** A group name: trimmed, up to 50 characters, no hidden characters. Empty = no name. */
const groupName = z
  .string()
  .nullable()
  .optional()
  .transform((s) => (s ?? "").trim())
  .pipe(
    z
      .string()
      .max(GROUP_NAME_MAX, `Group names can be up to ${GROUP_NAME_MAX} characters.`)
      .refine((n) => !GROUP_HIDDEN_CHARS.test(n), "Group names can't contain hidden characters."),
  )
  .transform((s) => (s === "" ? null : s));

const peopleIds = z.array(idParam).min(1).max(GROUP_MAX);

/** The people mentioned by some messages (senders, and anyone a group event names). */
async function peopleFor(rows: { senderId: string; event: ChatEvent | null }[]) {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.senderId);
    if (r.event?.type === "added") r.event.userIds.forEach((id) => ids.add(id));
    if (r.event?.type === "removed") ids.add(r.event.userId);
  }
  if (!ids.size) return [];
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarVersion: users.avatarVersion,
    })
    .from(users)
    .where(inArray(users.id, [...ids]));
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Adds a line like "Chip renamed the group" (or a call) to a chat. */
export async function postEvent(tx: Tx, conversationId: string, actorId: string, event: ChatEvent) {
  const [row] = await tx
    .insert(messages)
    .values({ conversationId, senderId: actorId, body: "", event })
    .returning(messageFields);
  await tx.update(conversations).set({ lastMessageAt: row.createdAt }).where(eq(conversations.id, conversationId));
  // Your own change doesn't make the chat unread for you.
  await tx
    .update(conversationMembers)
    .set({ lastReadAt: row.createdAt })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actorId)));
  return row;
}

/** Tells everyone affected: the new line appears and their chat lists refresh. */
export async function announce(row: MessageRow, userIds: string[]) {
  const [message] = await hydrate([row]);
  const people = await peopleFor([row]);
  for (const userId of new Set(userIds)) {
    emitToUser(userId, "message:new", { message, people });
    emitToUser(userId, "conversations:changed", {});
  }
}

/** Checks I can add each of these people: they're my friends (not blocked, not leaving). */
async function addable(myId: string, userIds: string[]): Promise<boolean> {
  for (const id of userIds) if (id === myId || !(await canMessage(myId, id))) return false;
  return true;
}

class GroupFull extends Error {}

const NOT_FRIENDS = "You can only add your friends to a group.";
// Restricted (family-managed) accounts are only ever in groups with their own friends.
const RESTRICTED_GROUP = "Someone here can only be in groups where everyone is their friend.";
const groupFull = (n = GROUP_MAX) => `Groups can have up to ${n} people.`;

// POST /conversations/group  { name?, userIds } — start a group with at least two friends.
conversationsRouter.post("/group", groupLimiter, async (req, res) => {
  const myId = me(res).id;
  const parsed = z.object({ name: groupName, userIds: peopleIds }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Pick friends to add." });
    return;
  }
  const userIds = [...new Set(parsed.data.userIds)];
  if (userIds.length < 2) {
    res.status(400).json({ error: "invalid", message: "Pick at least two friends for a group. (For one, just message them!)" });
    return;
  }
  if (userIds.length + 1 > GROUP_MAX) {
    res.status(400).json({ error: "invalid", message: groupFull() });
    return;
  }
  if ((await deletionPending(myId)) || !(await addable(myId, userIds))) {
    res.status(403).json({ error: "forbidden", message: NOT_FRIENDS });
    return;
  }
  if (await groupBreaksRestriction([myId, ...userIds])) {
    res.status(403).json({ error: "restricted", message: RESTRICTED_GROUP });
    return;
  }
  const { conversationId, row } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversations)
      .values({ kind: "group", name: parsed.data.name, createdBy: myId })
      .returning({ id: conversations.id });
    const now = Date.now();
    // The creator joined first, then everyone in the order picked (that's who takes over).
    await tx.insert(conversationMembers).values([
      { conversationId: created.id, userId: myId, joinedAt: new Date(now) },
      ...userIds.map((userId, i) => ({ conversationId: created.id, userId, joinedAt: new Date(now + 1 + i) })),
    ]);
    const row = await postEvent(tx, created.id, myId, { type: "created", name: parsed.data.name });
    return { conversationId: created.id, row };
  });
  await announce(row, [myId, ...userIds]);
  const [summary] = await summaries(myId, [conversationId]);
  res.status(201).json({ conversation: summary });
});

/** The group I'm in (404s anything else). */
async function myGroup(idRaw: unknown, myId: string) {
  const id = idParam.safeParse(idRaw);
  if (!id.success) return null;
  const chat = await access(id.data, myId);
  return chat?.kind === "group" ? { id: id.data, ...chat } : null;
}

// PATCH /conversations/:id  { name } — rename a group (empty or null clears the name).
conversationsRouter.patch("/:id", groupLimiter, async (req, res) => {
  const myId = me(res).id;
  const chat = await myGroup(req.params.id, myId);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = z.object({ name: groupName }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "That name won't work." });
    return;
  }
  if (await deletionPending(myId)) {
    res.status(403).json({ error: "forbidden", message: CANT_POST });
    return;
  }
  const name = parsed.data.name;
  if (name !== chat.name) {
    const row = await db.transaction(async (tx) => {
      await tx.update(conversations).set({ name }).where(eq(conversations.id, chat.id));
      return postEvent(tx, chat.id, myId, { type: "renamed", name });
    });
    await announce(row, chat.memberIds);
  }
  const [summary] = await summaries(myId, [chat.id]);
  res.json({ conversation: summary });
});

// ---------------------------------------------------------------------------------------
// Group photos (0.2.1). Anyone in the group can set or remove it; a line in the chat says so.

/** Removes a group photo file (a new one replaced it, or the group is gone). */
export async function removeGroupPhoto(conversationId: string, version: string): Promise<void> {
  await storage
    .remove(groupPhotoKey(conversationId, version))
    .catch((err) => console.error("Couldn't remove a group photo", err));
}

/** Sets (or, with null, removes) a group's photo and posts the line about it. */
async function changeGroupPhoto(
  chat: { id: string; memberIds: string[] },
  myId: string,
  photo: Buffer | null,
): Promise<string | null> {
  const version = photo ? randomUUID() : null;
  if (photo && version) await storage.put(groupPhotoKey(chat.id, version), photo, "image/webp");
  const { row, before } = await db.transaction(async (tx) => {
    const [old] = await tx
      .select({ photoVersion: conversations.photoVersion })
      .from(conversations)
      .where(eq(conversations.id, chat.id))
      .for("update");
    await tx.update(conversations).set({ photoVersion: version }).where(eq(conversations.id, chat.id));
    const row =
      photo || old?.photoVersion ? await postEvent(tx, chat.id, myId, { type: "photo", removed: !photo }) : null;
    return { row, before: old?.photoVersion ?? null };
  });
  if (before) await removeGroupPhoto(chat.id, before);
  if (row) await announce(row, chat.memberIds);
  return version;
}

// PUT /conversations/:id/photo — a new group photo (the image itself is the request body).
conversationsRouter.put(
  "/:id/photo",
  groupLimiter,
  express.raw({ type: "image/*", limit: PHOTO_UPLOAD_MAX }),
  async (req, res) => {
    const myId = me(res).id;
    const chat = await myGroup(req.params.id, myId);
    if (!chat) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (await deletionPending(myId)) {
      res.status(403).json({ error: "forbidden", message: CANT_POST });
      return;
    }
    const input = req.body;
    const photo = Buffer.isBuffer(input) && input.length > 0 ? await squarePhoto(input) : null;
    if (!photo) {
      res.status(400).json({ error: "invalid", message: "That file isn't a photo Glofly can use." });
      return;
    }
    const photoVersion = await changeGroupPhoto(chat, myId, photo);
    res.json({ photoVersion });
  },
);

// DELETE /conversations/:id/photo — back to the members' faces.
conversationsRouter.delete("/:id/photo", groupLimiter, async (req, res) => {
  const myId = me(res).id;
  const chat = await myGroup(req.params.id, myId);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (await deletionPending(myId)) {
    res.status(403).json({ error: "forbidden", message: CANT_POST });
    return;
  }
  await changeGroupPhoto(chat, myId, null);
  res.json({ photoVersion: null });
});

// GET /conversations/:id/photo/:version — the group photo (people in the group only). The
// version changes with every new photo, so it can be kept for good.
conversationsRouter.get("/:id/photo/:version", async (req, res) => {
  const chat = await myGroup(req.params.id, me(res).id);
  const version = z.uuid().safeParse(req.params.version);
  if (!chat || !version.success) {
    res.status(404).end();
    return;
  }
  const [row] = await db
    .select({ photoVersion: conversations.photoVersion })
    .from(conversations)
    .where(eq(conversations.id, chat.id));
  const file = row?.photoVersion === version.data ? await storage.get(groupPhotoKey(chat.id, version.data)) : null;
  if (!file) {
    res.status(404).end();
    return;
  }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Content-Length", String(file.size));
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  file.stream.pipe(res);
});

// POST /conversations/:id/members  { userIds } — add friends to a group.
conversationsRouter.post("/:id/members", groupLimiter, async (req, res) => {
  const myId = me(res).id;
  const chat = await myGroup(req.params.id, myId);
  if (!chat) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const parsed = z.object({ userIds: peopleIds }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Pick friends to add." });
    return;
  }
  const userIds = [...new Set(parsed.data.userIds)].filter((id) => !chat.memberIds.includes(id));
  if (!userIds.length) {
    res.status(400).json({ error: "invalid", message: "They're already in the group." });
    return;
  }
  if ((await deletionPending(myId)) || !(await addable(myId, userIds))) {
    res.status(403).json({ error: "forbidden", message: NOT_FRIENDS });
    return;
  }
  if (await groupBreaksRestriction([...chat.memberIds, ...userIds])) {
    res.status(403).json({ error: "restricted", message: RESTRICTED_GROUP });
    return;
  }
  let result: { row: MessageRow; memberIds: string[] };
  try {
    result = await db.transaction(async (tx) => {
      // Lock the group so two people adding at once can't go past 25.
      await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, chat.id)).for("update");
      const current = await tx
        .select({ userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(eq(conversationMembers.conversationId, chat.id));
      const currentIds = current.map((m) => m.userId);
      const fresh = userIds.filter((id) => !currentIds.includes(id));
      if (!currentIds.includes(myId)) throw new GroupFull(); // left in the meantime
      if (currentIds.length + fresh.length > GROUP_MAX) throw new GroupFull();
      const now = Date.now();
      if (fresh.length) {
        await tx.insert(conversationMembers).values(
          fresh.map((userId, i) => ({ conversationId: chat.id, userId, joinedAt: new Date(now + i) })),
        );
      }
      const row = await postEvent(tx, chat.id, myId, { type: "added", userIds: fresh });
      return { row, memberIds: [...currentIds, ...fresh] };
    });
  } catch (err) {
    if (err instanceof GroupFull) {
      res.status(409).json({ error: "group_full", message: groupFull() });
      return;
    }
    throw err;
  }
  await announce(result.row, result.memberIds);
  const [summary] = await summaries(myId, [chat.id]);
  res.json({ conversation: summary });
});

/**
 * Takes someone out of a group: they left (actor = themselves) or were removed. The last one out
 * removes the group. Also used by Glofly Control (restricted accounts, admin/family.ts).
 */
export async function removeGroupMember(chatId: string, userId: string, actorId: string): Promise<void> {
  const outcome = await db.transaction(async (tx) => {
    await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, chatId)).for("update");
    const removed = await tx
      .delete(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, chatId), eq(conversationMembers.userId, userId)))
      .returning({ userId: conversationMembers.userId });
    if (!removed.length) return { kind: "gone" as const };
    // Their unsent uploads for this group go too.
    const unsent = await tx
      .delete(attachments)
      .where(
        and(
          eq(attachments.conversationId, chatId),
          eq(attachments.uploaderId, userId),
          isNull(attachments.messageId),
        ),
      )
      .returning({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind });
    const rest = await tx
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, chatId))
      .orderBy(conversationMembers.joinedAt);
    if (!rest.length) {
      // The last person left: the group and everything in it is removed.
      const files = await tx
        .select({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind })
        .from(attachments)
        .where(eq(attachments.conversationId, chatId));
      const [gone] = await tx
        .delete(conversations)
        .where(eq(conversations.id, chatId))
        .returning({ photoVersion: conversations.photoVersion });
      return { kind: "empty" as const, files: [...unsent, ...files], photo: gone?.photoVersion ?? null };
    }
    const [group] = await tx
      .select({ createdBy: conversations.createdBy })
      .from(conversations)
      .where(eq(conversations.id, chatId));
    if (group.createdBy === userId || group.createdBy === null) {
      await tx.update(conversations).set({ createdBy: rest[0].userId }).where(eq(conversations.id, chatId));
    }
    const row = await postEvent(
      tx,
      chatId,
      actorId,
      actorId === userId ? { type: "left" } : { type: "removed", userId: userId },
    );
    return { kind: "posted" as const, row, files: unsent, memberIds: rest.map((m) => m.userId) };
  });

  if (outcome.kind !== "gone") await removeFiles(outcome.files);
  if (outcome.kind === "empty" && outcome.photo) await removeGroupPhoto(chatId, outcome.photo);
  // Someone who leaves (or is removed) drops out of the group's call straight away.
  if (outcome.kind !== "gone") await removeFromChatCall(chatId, userId);
  if (outcome.kind === "posted") await announce(outcome.row, outcome.memberIds);
  // The person who left (or was removed) sees the group disappear on all their devices.
  emitToUser(userId, "conversations:changed", {});
}

// DELETE /conversations/:id/members/:userId — leave (yourself) or remove someone (creator only).
conversationsRouter.delete("/:id/members/:userId", groupLimiter, async (req, res) => {
  const myId = me(res).id;
  const chat = await myGroup(req.params.id, myId);
  const target = idParam.safeParse(req.params.userId);
  if (!chat || !target.success || !chat.memberIds.includes(target.data)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const leaving = target.data === myId;
  if (!leaving && chat.createdBy !== myId) {
    res.status(403).json({ error: "forbidden", message: "Only the person who made the group can remove people." });
    return;
  }

  await removeGroupMember(chat.id, target.data, myId);
  res.status(204).end();
});

// GET /conversations/:id/messages?before=<messageId>&limit=50 — history, oldest first.
// GET /conversations/messages/search?q=&chat=&before= — find messages containing these words,
// newest first, 25 at a time. Only chats you're in now; never deleted messages or event lines.
// chat: one chat only. before: the last result you have (for "Show more").
conversationsRouter.get("/messages/search", searchLimiter, async (req, res) => {
  const myId = me(res).id;
  const q = z.string().trim().min(2).max(100).safeParse(req.query.q);
  if (!q.success) {
    res.status(400).json({ error: "invalid", message: "Type at least 2 characters to search." });
    return;
  }
  const chat = req.query.chat === undefined ? null : idParam.safeParse(req.query.chat);
  if (chat && !chat.success) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  if (chat && (await access(chat.data, myId)) === null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const before = idParam.safeParse(req.query.before);
  const PAGE = 25;

  // Words are matched as typed, anywhere in the message, ignoring case. % and _ match literally.
  const pattern = `%${q.data.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const myChats = db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, myId));

  let olderThan = undefined;
  if (before.success) {
    const [anchor] = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(eq(messages.id, before.data));
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
    .where(
      and(
        chat ? eq(messages.conversationId, chat.data) : inArray(messages.conversationId, myChats),
        isNull(messages.deletedAt),
        isNull(messages.event),
        ilike(messages.body, pattern),
        olderThan,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(PAGE + 1);

  const page = rows.slice(0, PAGE);
  res.json({ results: await hydrate(page), hasMore: rows.length > PAGE, people: await peopleFor(page) });
});

conversationsRouter.get("/:id/messages", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const myId = me(res).id;
  if (!id.success || (await access(id.data, myId)) === null) {
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

  const page = rows.slice(0, limit).reverse();
  // Who's who, including people who've since left a group.
  res.json({ messages: await hydrate(page), hasMore: rows.length > limit, people: await peopleFor(page) });
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
  // 0.5.0: a GIF ({ gif: { id } }: no text; its link goes in the body for older apps), or a
  // lantern message ({ lantern: true }: fades once everyone else has read it).
  const gifId = typeof req.body?.gif?.id === "string" ? (req.body.gif.id as string) : null;
  const lantern = req.body?.lantern === true;
  const body = gifId
    ? ({ success: true, data: "" } as const)
    : (attachmentIds.length ? captionBody : messageBody).safeParse(req.body?.body);
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
  const chat = await access(id.data, myId);
  if (chat === null) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (!(await canPost(chat, myId))) {
    res.status(403).json({ error: "forbidden", message: CANT_POST });
    return;
  }
  // A reply must point at a message in this same chat that still exists.
  const replyToId = replyTo.success ? (replyTo.data ?? null) : null;
  if (replyToId) {
    const original = await findMessage(id.data, replyToId);
    if (!original || original.deletedAt || original.event) {
      res.status(400).json({ error: "invalid", message: "That message isn't available to reply to." });
      return;
    }
  }

  let gif: GifInfo | null = null;
  if (gifId) {
    if (attachmentIds.length) {
      res.status(400).json({ error: "invalid", message: "Send the GIF on its own." });
      return;
    }
    const found = await gifById(gifId, myId);
    if (found === "unavailable") {
      res.status(503).json({ error: "gifs_unavailable", message: "GIFs aren't available right now. Try again in a moment." });
      return;
    }
    if (!found) {
      res.status(400).json({ error: "invalid", message: "That GIF isn't available." });
      return;
    }
    gif = found;
  }
  const text = gif ? gifFallback(gif) : body.data;

  // Groups: who this @mentions (only people in the group right now).
  const mentions = chat.kind === "group" && !gif ? await mentionsIn(text, chat.memberIds, myId) : [];

  let inserted: MessageRow;
  try {
    inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(messages)
        .values({ conversationId: id.data, senderId: myId, body: text, replyToId, mentions, gif, lantern })
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
  // Instantly to everyone in the chat (all their signed-in devices).
  for (const userId of chat.memberIds) emitToUser(userId, "message:new", { message });
  // Replying means you've read everything before it ("Seen" is for DMs).
  if (chat.partner) await shareReadPosition(id.data, myId, chat.partner, inserted.createdAt);
  res.status(201).json({ message });
  // Phones: a notification for everyone else, and this chat's notification cleared on your others.
  // A lantern message's words stay in the chat (the notification just says there's one).
  inBackground(notifyMessage(lantern ? { ...message, body: "🏮 Lantern message", attachments: [] } : message, chat));
  inBackground(notifyRead(myId, id.data, res.locals.sessionId));
  // 0.5.0: the first link gets a preview a moment later (message:updated).
  if (!gif && !lantern) inBackground(addLinkPreview(inserted.id, id.data, text));
});

class AttachmentGone extends Error {}

/**
 * 0.5.0: posts a special message (a poll, a game) the way sending does: the chat moves to the
 * top, it counts as read for the sender, everyone gets it live, phones get a notification.
 */
export async function postSpecial(
  chat: Access,
  conversationId: string,
  myId: string,
  values: { body: string; poll?: PollInfo; game?: GameInfo },
  sessionId?: string,
) {
  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(messages)
      .values({ conversationId, senderId: myId, body: values.body, poll: values.poll ?? null, game: values.game ?? null })
      .returning(messageFields);
    await tx.update(conversations).set({ lastMessageAt: row.createdAt }).where(eq(conversations.id, conversationId));
    await tx
      .update(conversationMembers)
      .set({ lastReadAt: row.createdAt })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, myId)));
    return row;
  });
  const [message] = await hydrate([inserted]);
  for (const userId of chat.memberIds) emitToUser(userId, "message:new", { message });
  if (chat.partner) await shareReadPosition(conversationId, myId, chat.partner, inserted.createdAt);
  inBackground(notifyMessage(message, chat));
  if (sessionId) inBackground(notifyRead(myId, conversationId, sessionId));
  return message;
}

/** 0.5.0: a message in a chat I'm in (null otherwise). */
export async function messageIn(conversationId: string, messageId: string) {
  return findMessage(conversationId, messageId);
}

/** Shared checks for changing a message: it exists in a chat you're in, and messaging is allowed. */
async function loadForChange(conversationIdRaw: unknown, messageIdRaw: unknown, myId: string) {
  const conversationId = idParam.safeParse(conversationIdRaw);
  const messageId = idParam.safeParse(messageIdRaw);
  if (!conversationId.success || !messageId.success) return { status: 404 as const };
  const chat = await access(conversationId.data, myId);
  if (chat === null) return { status: 404 as const };
  const message = await findMessage(conversationId.data, messageId.data);
  // Group events ("Chip renamed the group") can't be edited, deleted or reacted to.
  if (!message || message.event) return { status: 404 as const };
  return { status: 200 as const, message, chat, conversationId: conversationId.data };
}

export async function sendUpdated(messageId: string, conversationId: string) {
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
  const { message, chat, conversationId } = found;
  if (message.senderId !== myId || message.deletedAt) {
    res.status(403).json({ error: "forbidden", message: "You can only edit your own messages." });
    return;
  }
  if (message.gif || message.poll || message.game) {
    res.status(400).json({ error: "invalid", message: "This kind of message can't be edited." });
    return;
  }
  if (!(await canPost(chat, myId))) {
    res.status(403).json({ error: "forbidden", message: CANT_POST });
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
    // Mentions follow the new text (an edit doesn't notify anyone again).
    const mentions = chat.kind === "group" ? await mentionsIn(body.data, chat.memberIds, myId) : [];
    await db
      .update(messages)
      .set({ body: body.data, editedAt: new Date(), mentions })
      .where(eq(messages.id, message.id));
    // The link changed: a new preview (or none).
    if (firstLink(body.data) !== (message.linkPreview?.url ?? null)) {
      await db.update(messages).set({ linkPreview: null }).where(eq(messages.id, message.id));
      await removePreviewImage(message.id);
      if (!message.lantern) inBackground(addLinkPreview(message.id, conversationId, body.data));
    }
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
  if (!message.deletedAt) await wipeMessage(message.id);
  res.json({ message: await sendUpdated(message.id, conversationId) });
});

/** Deletes a message's text, reactions and files for good (its "deleted" placeholder stays). */
async function wipeMessage(messageId: string): Promise<void> {
  const removed = await db.transaction(async (tx) => {
    await tx
      .update(messages)
      .set({ body: "", deletedAt: new Date(), editedAt: null, mentions: [], gif: null, linkPreview: null, poll: null, game: null })
      .where(eq(messages.id, messageId));
    await tx.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
    await tx.delete(pollVotes).where(eq(pollVotes.messageId, messageId));
    // Photos and files go too, for good.
    return tx
      .delete(attachments)
      .where(eq(attachments.messageId, messageId))
      .returning({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind });
  });
  await removeFiles(removed);
  await removePreviewImage(messageId);
}

/**
 * Removes a reported message (Glofly Control): the same as its sender deleting it, and
 * everyone in the chat sees it go. False if it was already gone.
 */
export async function removeMessageForGood(messageId: string): Promise<boolean> {
  const [row] = await db
    .select({ conversationId: messages.conversationId, deletedAt: messages.deletedAt, event: messages.event })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!row || row.deletedAt || row.event) return false;
  await wipeMessage(messageId);
  await sendUpdated(messageId, row.conversationId);
  return true;
}

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
  if (!(await canPost(found.chat, myId))) {
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
      const chat = await access(id.data, myId);
      if (chat?.partner) await shareReadPosition(id.data, myId, chat.partner, now);
      // Read here: the chat's notification goes away on your other phones.
      inBackground(notifyRead(myId, id.data, res.locals.sessionId));
    }
  }
  res.status(204).end();
});

// POST /conversations/:id/attachments?name=<file name> — upload a photo or file to send.
// The file itself is the request body. Returns its id, to include when sending the message.
conversationsRouter.post(
  "/:id/attachments",
  uploadLimiter,
  // Videos may be bigger than other files (VIDEO_MAX_BYTES); everything else is checked below.
  express.raw({ type: () => true, limit: VIDEO_MAX_BYTES }),
  async (req, res) => {
    const id = idParam.safeParse(req.params.id);
    const myId = me(res).id;
    const chat = id.success ? await access(id.data, myId) : null;
    if (!id.success || chat === null) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    if (!(await canPost(chat, myId))) {
      res.status(403).json({ error: "forbidden", message: "You can only send files to friends." });
      return;
    }
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "invalid", message: "That file is empty." });
      return;
    }
    // A voice message (?voice=1&duration=<ms>&peaks=<0–100,…>): Opus audio Glofly recorded.
    // Stored like any file (old apps offer it as a download), with its length and waveform.
    let voice: VoiceInfo | null = null;
    if (req.query.voice !== undefined) {
      const parsed = voiceQuery.safeParse(req.query);
      const format = voiceFormat(data);
      if (!parsed.success || !format || data.length > VOICE_MAX_BYTES) {
        res.status(400).json({ error: "invalid", message: "That voice message couldn't be sent. Try recording it again." });
        return;
      }
      voice = parsed.data;
    }
    const rawName = voice
      ? `Voice message.${voiceFormat(data)}`
      : z.string().max(1000).catch("file").parse(req.query.name);
    const name = cleanFileName(rawName);
    if (isBlocked(name, data)) {
      res.status(400).json({
        error: "invalid",
        message: `For safety, Glofly doesn't send programs or scripts (${name}).`,
      });
      return;
    }
    // 0.5.0 videos: MP4 / MOV / WebM that ffmpeg can read, up to 3 minutes, played in the chat.
    // Anything else bigger than a normal file is refused.
    const container = voice ? null : videoContainer(data);
    const looked = container && data.length <= VIDEO_MAX_BYTES ? await examineVideo(data) : null;
    if (!looked && data.length > ATTACHMENT_MAX_BYTES) {
      res.status(413).json({
        error: "too_big",
        message: container
          ? "Videos can be up to 3 minutes and 64 MB."
          : "Too big. Files can be up to 25 MB (videos up to 64 MB).",
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
    const attachment = await storeUpload(
      id.data,
      myId,
      name,
      voice
        ? { kind: "file", data }
        : looked && container
          ? { kind: "file", data, video: { info: { ...looked.info, mime: container }, poster: looked.poster } }
          : await processUpload(data),
      voice,
    );
    res.status(201).json({ attachment });
  },
);

const voiceQuery = z
  .object({
    voice: z.literal("1"),
    duration: z.coerce.number().int().min(200).max(VOICE_MAX_MS + 5000),
    peaks: z
      .string()
      .max(VOICE_PEAKS_MAX * 4)
      .transform((s) => s.split(",").map(Number))
      .pipe(z.array(z.number().int().min(0).max(100)).min(1).max(VOICE_PEAKS_MAX)),
  })
  .transform((q) => ({ durationMs: Math.min(q.duration, VOICE_MAX_MS), peaks: q.peaks }));

/** Loads an attachment you're allowed to see: it's in your chat and sent (or you uploaded it). */
async function loadAttachment(conversationIdRaw: unknown, attachmentIdRaw: unknown, myId: string) {
  const conversationId = idParam.safeParse(conversationIdRaw);
  const attachmentId = idParam.safeParse(attachmentIdRaw);
  if (!conversationId.success || !attachmentId.success) return null;
  if ((await access(conversationId.data, myId)) === null) return null;
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

// GET /conversations/:id/attachments/:attachmentId/m4a — a voice message as AAC (.m4a) for
// iPhones, which can't play the Opus audio the desktop and Android apps record (converted once).
conversationsRouter.get("/:id/attachments/:attachmentId/m4a", async (req, res) => {
  const row = await loadAttachment(req.params.id, req.params.attachmentId, me(res).id);
  const data = row?.kind === "file" && row.voice ? await voiceAsM4a(row) : null;
  if (!data) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.setHeader("Content-Type", "audio/mp4");
  res.setHeader("Content-Length", String(data.length));
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", "attachment; filename=\"Voice message.m4a\"");
  res.end(data);
});

// GET /conversations/:id/attachments/:attachmentId/video — a video (0.5.0), played in the chat:
// its real type, shown inline, and in pieces (Range) so it can start before it has all loaded.
conversationsRouter.get("/:id/attachments/:attachmentId/video", async (req, res) => {
  const row = await loadAttachment(req.params.id, req.params.attachmentId, me(res).id);
  const key = row?.video ? keyFor(row, "file") : null;
  const file = key ? await storage.get(key) : null;
  if (!row?.video || !key || !file) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const total = file.size;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", row.video.mime);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`);
  const range = typeof req.headers.range === "string" ? req.headers.range.match(/^bytes=(\d*)-(\d*)$/) : null;
  if (!range || (!range[1] && !range[2])) {
    res.setHeader("Content-Length", String(total));
    file.stream.pipe(res);
    return;
  }
  file.stream.destroy();
  let start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
  let end = range[1] && range[2] ? Number(range[2]) : total - 1;
  end = Math.min(end, total - 1);
  if (!(start >= 0) || start > end) {
    res.setHeader("Content-Range", `bytes */${total}`);
    res.status(416).end();
    return;
  }
  start = Math.floor(start);
  end = Math.floor(end);
  const part = await storage.getRange(key, start, end);
  if (!part) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
  res.setHeader("Content-Length", String(end - start + 1));
  part.pipe(res);
});

// GET /conversations/:id/attachments/:attachmentId/:variant — preview | full (photos), file
// (files), poster (a video's picture, 0.5.0).
conversationsRouter.get("/:id/attachments/:attachmentId/:variant", async (req, res) => {
  const row = await loadAttachment(req.params.id, req.params.attachmentId, me(res).id);
  const variant = z.enum(["preview", "full", "file", "poster"]).safeParse(req.params.variant);
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
  if (row.kind === "image" || variant.data === "poster") {
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
    `${(row.kind === "image" && variant.data !== "file") || variant.data === "poster" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(variant.data === "poster" ? webpName(row.name) : downloadName)}`,
  );
  file.stream.pipe(res);
});

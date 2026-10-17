import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { attachmentSummary, isConstellationColor, shortBody, type NebulaMention, type PinnedNebula } from "@glofly/shared";
import { db } from "../db";
import { attachments, constellationMembers, constellations, conversationMembers, messages, nebulaPins, nebulas } from "../db/schema";
import { publicUsers, unreadFor } from "./views";

// The nebula dock on Glofly home (2.0, approved Oct 17 boards 9–14): nebulas you pinned there,
// and every @mention of you across your constellations. Only constellations you're in and that
// aren't taken down count.

const colorOf = (x: string) => (isConstellationColor(x) ? x : "ember");

/** Your pinned nebulas, in your order, with their unread counts. */
export async function pinsFor(userId: string): Promise<PinnedNebula[]> {
  const rows = await db
    .select({
      nebulaId: nebulas.id,
      name: nebulas.name,
      kind: nebulas.kind,
      conversationId: nebulas.conversationId,
      constellationId: constellations.id,
      constellationName: constellations.name,
      color: constellations.color,
      iconVersion: constellations.iconVersion,
    })
    .from(nebulaPins)
    .innerJoin(nebulas, eq(nebulas.id, nebulaPins.nebulaId))
    .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
    .innerJoin(
      constellationMembers,
      and(eq(constellationMembers.constellationId, constellations.id), eq(constellationMembers.userId, userId)),
    )
    .where(and(eq(nebulaPins.userId, userId), isNull(constellations.takenDownAt)))
    .orderBy(asc(nebulaPins.position), asc(nebulaPins.createdAt));
  const unread = await unreadFor(userId, rows.map((r) => r.conversationId));
  return rows.map((r) => ({
    constellationId: r.constellationId,
    constellationName: r.constellationName,
    color: colorOf(r.color),
    iconVersion: r.iconVersion,
    nebula: {
      id: r.nebulaId,
      name: r.name,
      kind: r.kind,
      conversationId: r.conversationId,
      unreadCount: unread.get(r.conversationId)?.unread ?? 0,
      mentionCount: unread.get(r.conversationId)?.mentions ?? 0,
    },
  }));
}

/** Pins it at the end (no-op if it's already pinned). */
export async function pinNebula(userId: string, nebulaId: string): Promise<void> {
  const [last] = await db
    .select({ max: sql<number>`coalesce(max(${nebulaPins.position}), -1)::int` })
    .from(nebulaPins)
    .where(eq(nebulaPins.userId, userId));
  await db
    .insert(nebulaPins)
    .values({ userId, nebulaId, position: (last?.max ?? -1) + 1 })
    .onConflictDoNothing();
}

export async function unpinNebula(userId: string, nebulaId: string): Promise<void> {
  await db.delete(nebulaPins).where(and(eq(nebulaPins.userId, userId), eq(nebulaPins.nebulaId, nebulaId)));
}

export async function pinCount(userId: string): Promise<number> {
  return db.$count(nebulaPins, eq(nebulaPins.userId, userId));
}

/** My nebula conversations (constellations I'm in, not taken down) with when I last read each. */
async function myNebulaChats(userId: string) {
  return db
    .select({
      conversationId: nebulas.conversationId,
      nebulaId: nebulas.id,
      nebulaName: nebulas.name,
      constellationId: constellations.id,
      constellationName: constellations.name,
      color: constellations.color,
      iconVersion: constellations.iconVersion,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(nebulas)
    .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, nebulas.conversationId), eq(conversationMembers.userId, userId)),
    )
    .where(isNull(constellations.takenDownAt));
}

const MENTIONS_PAGE = 30;
/** How far back Mentions looks. */
const MENTIONS_DAYS = 30;

/** @mentions of me, newest first (30 at a time; `before` = the oldest one shown so far). */
export async function mentionsFor(
  userId: string,
  before?: Date,
): Promise<{ mentions: NebulaMention[]; unread: number; more: boolean }> {
  const chats = await myNebulaChats(userId);
  if (!chats.length) return { mentions: [], unread: 0, more: false };
  const byChat = new Map(chats.map((c) => [c.conversationId, c]));
  const since = new Date(Date.now() - MENTIONS_DAYS * 24 * 60 * 60 * 1000);
  const mentionsMe = sql`${userId}::uuid = any(${messages.mentions})`;
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, [...byChat.keys()]),
        mentionsMe,
        isNull(messages.deletedAt),
        isNull(messages.event),
        gt(messages.createdAt, since),
        before ? lt(messages.createdAt, before) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(MENTIONS_PAGE + 1);
  const page = rows.slice(0, MENTIONS_PAGE);
  const people = await publicUsers(page.map((r) => r.senderId).filter((x): x is string => !!x));
  const files = page.length
    ? await db
        .select({ messageId: attachments.messageId, kind: attachments.kind, name: attachments.name, voice: attachments.voice, video: attachments.video, sticker: attachments.sticker })
        .from(attachments)
        .where(inArray(attachments.messageId, page.map((r) => r.id)))
    : [];
  // Unread mentions everywhere (not just this page): the badge on the dock's Mentions item.
  const unreadCounts = await unreadFor(userId, [...byChat.keys()]);
  let unread = 0;
  for (const c of unreadCounts.values()) unread += c.mentions;

  const mentions: NebulaMention[] = [];
  for (const r of page) {
    const chat = byChat.get(r.conversationId);
    const sender = r.senderId ? people.get(r.senderId) : undefined;
    if (!chat || !sender) continue;
    const mine = files.filter((f) => f.messageId === r.id);
    mentions.push({
      id: r.id,
      conversationId: r.conversationId,
      constellation: {
        id: chat.constellationId,
        name: chat.constellationName,
        color: colorOf(chat.color),
        iconVersion: chat.iconVersion,
      },
      nebula: { id: chat.nebulaId, name: chat.nebulaName },
      sender,
      text: (shortBody(r.body) || attachmentSummary(mine)).replace(/\s+/g, " ").trim().slice(0, 300),
      createdAt: r.createdAt.toISOString(),
      unread: r.createdAt > chat.lastReadAt,
    });
  }
  return { mentions, unread, more: rows.length > MENTIONS_PAGE };
}

/** "Mark all read": every nebula with an unread @mention of me counts as read now. */
export async function readAllMentions(userId: string): Promise<string[]> {
  const chats = await myNebulaChats(userId);
  const unread = await unreadFor(userId, chats.map((c) => c.conversationId));
  const ids = chats.filter((c) => (unread.get(c.conversationId)?.mentions ?? 0) > 0).map((c) => c.conversationId);
  if (ids.length) {
    await db
      .update(conversationMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, ids)));
  }
  return [...new Set(chats.filter((c) => ids.includes(c.conversationId)).map((c) => c.constellationId))];
}

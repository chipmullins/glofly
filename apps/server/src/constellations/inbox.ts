import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  attachmentSummary,
  isConstellationColor,
  shortBody,
  type InboxItem,
  type InboxPage,
  type InboxTab,
  type RsvpAnswer,
} from "@glofly/shared";
import { db } from "../db";
import {
  attachments,
  constellationEventRsvps,
  constellationEvents,
  constellationJoinRequests,
  constellationMembers,
  constellations,
  conversationMembers,
  inboxReads,
  inboxState,
  messages,
  nebulas,
} from "../db/schema";
import { emitToUser } from "../realtime";
import { can, standingOf } from "./perms";
import { publicUsers } from "./views";

// The Inbox (0.8.0, approved Oct 20 board 15): @mentions, replies to your messages, events you're
// going to and join requests you can let in, across all your constellations. An item is unread
// until you mark it (or everything) read; a mention or reply also counts as read once you've read
// its nebula. Join requests stay until someone lets them in or declines.

const DAYS = 30;
const PAGE = 30;
const colorOf = (x: string) => (isConstellationColor(x) ? x : "ember");

type Where = { id: string; name: string; color: ReturnType<typeof colorOf>; iconVersion: string | null };

/** Everything in my Inbox, newest first (all tabs; the caller filters and pages). */
async function allItems(userId: string): Promise<InboxItem[]> {
  const chats = await db
    .select({
      conversationId: nebulas.conversationId,
      nebulaId: nebulas.id,
      nebulaName: nebulas.name,
      nebulaKind: nebulas.kind,
      constellationId: constellations.id,
      constellationName: constellations.name,
      color: constellations.color,
      iconVersion: constellations.iconVersion,
      lastReadAt: conversationMembers.lastReadAt,
    })
    .from(nebulas)
    .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
    .innerJoin(constellationMembers, and(eq(constellationMembers.constellationId, constellations.id), eq(constellationMembers.userId, userId)))
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, nebulas.conversationId), eq(conversationMembers.userId, userId)))
    .where(isNull(constellations.takenDownAt));
  const constellationIds = [...new Set(chats.map((c) => c.constellationId))];
  if (!constellationIds.length) return [];
  const where = new Map<string, Where>();
  for (const c of chats) where.set(c.constellationId, { id: c.constellationId, name: c.constellationName, color: colorOf(c.color), iconVersion: c.iconVersion });
  const byChat = new Map(chats.map((c) => [c.conversationId, c]));
  const since = new Date(Date.now() - DAYS * 86_400_000);
  const [state] = await db.select({ clearedAt: inboxState.clearedAt }).from(inboxState).where(eq(inboxState.userId, userId));
  const clearedAt = state?.clearedAt ?? new Date(0);
  const reads = new Set(
    (await db.select({ key: inboxReads.itemKey }).from(inboxReads).where(and(eq(inboxReads.userId, userId), gt(inboxReads.readAt, since)))).map((r) => r.key),
  );
  const fresh = (key: string, at: Date) => at > clearedAt && !reads.has(key);
  const items: InboxItem[] = [];

  // @mentions and replies to my messages
  const original = alias(messages, "original");
  const rows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      senderId: messages.senderId,
      body: messages.body,
      createdAt: messages.createdAt,
      mentionsMe: sql<boolean>`${userId}::uuid = any(${messages.mentions})`,
      replyToMine: sql<boolean>`${original.senderId} = ${userId}::uuid`,
      originalBody: original.body,
    })
    .from(messages)
    .leftJoin(original, eq(original.id, messages.replyToId))
    .where(
      and(
        inArray(messages.conversationId, [...byChat.keys()]),
        ne(messages.senderId, userId),
        isNull(messages.deletedAt),
        isNull(messages.event),
        gt(messages.createdAt, since),
        or(sql`${userId}::uuid = any(${messages.mentions})`, eq(original.senderId, userId)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(200);
  const files = rows.length
    ? await db
        .select({ messageId: attachments.messageId, kind: attachments.kind, name: attachments.name, voice: attachments.voice, video: attachments.video, sticker: attachments.sticker })
        .from(attachments)
        .where(inArray(attachments.messageId, rows.map((r) => r.id)))
    : [];
  const people = await publicUsers(rows.map((r) => r.senderId));
  for (const r of rows) {
    const chat = byChat.get(r.conversationId);
    const sender = people.get(r.senderId);
    if (!chat || !sender) continue;
    const mine = files.filter((f) => f.messageId === r.id);
    const kind = r.mentionsMe ? "mention" : "reply";
    const key = `${kind === "mention" ? "m" : "r"}:${r.id}`;
    items.push({
      key,
      kind,
      createdAt: r.createdAt.toISOString(),
      unread: fresh(key, r.createdAt) && r.createdAt > chat.lastReadAt,
      constellation: where.get(chat.constellationId)!,
      nebula: { id: chat.nebulaId, name: chat.nebulaName, conversationId: chat.conversationId, kind: chat.nebulaKind },
      messageId: r.id,
      sender,
      text: (shortBody(r.body) || attachmentSummary(mine as never)).replace(/\s+/g, " ").trim().slice(0, 300),
      ...(kind === "reply" && r.originalBody ? { repliedTo: shortBody(r.originalBody).replace(/\s+/g, " ").trim().slice(0, 120) } : {}),
    });
  }

  // Events: ones I'm going to (or might), and new ones I haven't answered
  const now = Date.now();
  const soonest = new Date(now - 6 * 3_600_000);
  const events = await db
    .select({
      e: constellationEvents,
      answer: constellationEventRsvps.answer,
      voiceName: nebulas.name,
    })
    .from(constellationEvents)
    .leftJoin(constellationEventRsvps, and(eq(constellationEventRsvps.eventId, constellationEvents.id), eq(constellationEventRsvps.userId, userId)))
    .leftJoin(nebulas, eq(nebulas.id, constellationEvents.voiceNebulaId))
    .where(
      and(
        inArray(constellationEvents.constellationId, constellationIds),
        isNull(constellationEvents.cancelledAt),
        gt(constellationEvents.startsAt, soonest),
        gt(constellationEvents.createdAt, since),
      ),
    )
    .limit(100);
  const eventIds = events.map((x) => x.e.id);
  const goingCounts = new Map<string, number>();
  if (eventIds.length) {
    const counts = await db
      .select({ eventId: constellationEventRsvps.eventId, n: sql<number>`count(*)::int` })
      .from(constellationEventRsvps)
      .where(and(inArray(constellationEventRsvps.eventId, eventIds), eq(constellationEventRsvps.answer, "going")))
      .groupBy(constellationEventRsvps.eventId);
    for (const c of counts) goingCounts.set(c.eventId, c.n);
  }
  // 0.8.0: events in role-only nebulas I can't see aren't mine to know about.
  const visibleNebulaIds = new Set(chats.map((c) => c.nebulaId));
  for (const { e, answer, voiceName } of events) {
    if (!visibleNebulaIds.has(e.nebulaId)) continue;
    const end = e.endsAt ? e.endsAt.getTime() : e.startsAt.getTime() + 3 * 3_600_000;
    if (end <= now) continue;
    const mine = answer === "going" || answer === "maybe" || answer === "no" ? (answer as RsvpAnswer) : null;
    if (mine === "no") continue;
    let phase: "new" | "soon" | "live";
    let at: Date;
    if (e.startedAt && (mine === "going" || mine === "maybe")) {
      phase = "live";
      at = e.startedAt;
    } else if (e.remindedAt && (mine === "going" || mine === "maybe")) {
      phase = "soon";
      at = e.remindedAt;
    } else if (!mine && e.hostId !== userId && !e.startedAt) {
      phase = "new";
      at = e.createdAt;
    } else if (mine && !e.startedAt && e.hostId !== userId) {
      phase = "new";
      at = e.createdAt;
    } else continue;
    const key = `e:${e.id}:${phase}`;
    const n = chats.find((c) => c.nebulaId === e.nebulaId);
    items.push({
      key,
      kind: "event",
      createdAt: at.toISOString(),
      unread: fresh(key, at),
      constellation: where.get(e.constellationId)!,
      ...(n ? { nebula: { id: n.nebulaId, name: n.nebulaName, conversationId: n.conversationId, kind: n.nebulaKind } } : {}),
      ...(e.messageId ? { messageId: e.messageId } : {}),
      event: {
        id: e.id,
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        going: goingCounts.get(e.id) ?? 0,
        mine,
        where: (e.voiceNebulaId && visibleNebulaIds.has(e.voiceNebulaId) ? voiceName : null) ?? n?.nebulaName ?? "",
        started: !!e.startedAt,
      },
    });
  }

  // Join requests I can let in
  const requests = await db
    .select()
    .from(constellationJoinRequests)
    .where(inArray(constellationJoinRequests.constellationId, constellationIds))
    .orderBy(desc(constellationJoinRequests.createdAt))
    .limit(100);
  if (requests.length) {
    const allowed = new Set<string>();
    for (const cid of new Set(requests.map((r) => r.constellationId))) {
      const s = await standingOf(cid, userId);
      if (s && can(s, "approveRequests")) allowed.add(cid);
    }
    const who = await publicUsers(requests.filter((r) => allowed.has(r.constellationId)).map((r) => r.userId));
    for (const r of requests) {
      const user = who.get(r.userId);
      if (!allowed.has(r.constellationId) || !user) continue;
      const key = `j:${r.constellationId}:${r.userId}`;
      items.push({
        key,
        kind: "request",
        createdAt: r.createdAt.toISOString(),
        unread: fresh(key, r.createdAt),
        constellation: where.get(r.constellationId)!,
        request: { user, note: r.note },
      });
    }
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items;
}

const TAB_KIND: Record<Exclude<InboxTab, "all">, InboxItem["kind"]> = {
  mentions: "mention",
  replies: "reply",
  events: "event",
  requests: "request",
};

/** One page of a tab, with the unread counts for every tab. */
export async function inboxFor(userId: string, tab: InboxTab, before?: string): Promise<InboxPage> {
  const all = await allItems(userId);
  const counts: InboxPage["counts"] = { all: 0, mentions: 0, replies: 0, events: 0, requests: 0 };
  for (const i of all) {
    if (!i.unread) continue;
    counts.all++;
    for (const [t, k] of Object.entries(TAB_KIND)) if (i.kind === k) counts[t as Exclude<InboxTab, "all">]++;
  }
  const list = all.filter((i) => (tab === "all" || i.kind === TAB_KIND[tab]) && (!before || i.createdAt < before));
  return { items: list.slice(0, PAGE), counts, more: list.length > PAGE };
}

/** Marks items read (keys as the Inbox gave them). */
export async function markInboxRead(userId: string, keys: string[]): Promise<void> {
  const clean = [...new Set(keys.filter((k) => /^[mrej]:[0-9a-f-]{36}(?::[0-9a-z-]{3,36})?$/.test(k)))].slice(0, 200);
  if (clean.length) {
    await db
      .insert(inboxReads)
      .values(clean.map((itemKey) => ({ userId, itemKey })))
      .onConflictDoNothing();
  }
  emitToUser(userId, "inbox:changed", {}, true);
}

/** "Mark all read". */
export async function markInboxAllRead(userId: string): Promise<void> {
  await db.insert(inboxState).values({ userId, clearedAt: new Date() }).onConflictDoUpdate({ target: inboxState.userId, set: { clearedAt: new Date() } });
  // Old one-by-one marks aren't needed any more.
  await db.delete(inboxReads).where(eq(inboxReads.userId, userId));
  emitToUser(userId, "inbox:changed", {}, true);
}


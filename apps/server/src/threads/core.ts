import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ForumSettings, ForumTag, ThreadSummary } from "@glofly/shared";
import { isForumTagColor } from "@glofly/shared";
import { db } from "../db";
import { messages, nebulaThreads, nebulas, threadFollows } from "../db/schema";

// Communities round (Nov 2026): threads + forum posts, the shared pieces (no routes here, so the
// message routes can use it without an import cycle).

export type ThreadRow = typeof nebulaThreads.$inferSelect;

const DAY = 86_400_000;

/** Closed by hand, or quiet for longer than the nebula allows. */
export const isClosed = (t: Pick<ThreadRow, "closedAt" | "lastMessageAt">, closeDays: number) =>
  !!t.closedAt || Date.now() - t.lastMessageAt.getTime() > closeDays * DAY;

export function forumSettingsOf(n: { forumTags: unknown; forumGuidelines: string | null; forumRequireTag: boolean; forumSort: string }): ForumSettings {
  const tags = (Array.isArray(n.forumTags) ? n.forumTags : []).filter(
    (t): t is ForumTag => !!t && typeof t.id === "string" && typeof t.name === "string" && isForumTagColor(t.color),
  );
  return { tags, guidelines: n.forumGuidelines, requireTag: n.forumRequireTag, sort: n.forumSort === "newest" ? "newest" : "activity" };
}

/** Thread rows → what apps see, for one person (following + unread are theirs). */
export async function summaries(rows: ThreadRow[], userId: string | null, closeDays: Map<string, number>): Promise<ThreadSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const follows = userId
    ? await db.select().from(threadFollows).where(and(eq(threadFollows.userId, userId), inArray(threadFollows.threadId, ids)))
    : [];
  // The last few people who replied, newest first.
  const recent = await db.execute<{ thread_id: string; sender_id: string }>(sql`
    select thread_id, sender_id from (
      select m.thread_id, m.sender_id, row_number() over (partition by m.thread_id order by max(m.created_at) desc) as n
      from messages m where m.thread_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and m.deleted_at is null
      group by m.thread_id, m.sender_id
    ) x where n <= 3 order by thread_id, n`);
  const firstIds = rows.map((r) => r.firstMessageId).filter((x): x is string => !!x);
  const firsts = firstIds.length ? await db.select({ id: messages.id, body: messages.body, deletedAt: messages.deletedAt }).from(messages).where(inArray(messages.id, firstIds)) : [];
  // Unread replies for threads I follow.
  const unread = new Map<string, number>();
  const followed = follows.filter((f) => f.following);
  if (userId && followed.length) {
    const counts = await db.execute<{ thread_id: string; n: number }>(sql`
      select m.thread_id, count(*)::int as n from messages m
      join thread_follows f on f.thread_id = m.thread_id and f.user_id = ${userId}::uuid
      where m.thread_id in (${sql.join(followed.map((f) => sql`${f.threadId}::uuid`), sql`, `)})
        and m.created_at > f.last_read_at and m.sender_id <> ${userId}::uuid and m.deleted_at is null
      group by m.thread_id`);
    for (const r of counts.rows) unread.set(r.thread_id, Number(r.n));
  }
  return rows.map((t) => {
    const f = follows.find((x) => x.threadId === t.id);
    const first = t.firstMessageId ? firsts.find((m) => m.id === t.firstMessageId) : undefined;
    return {
      id: t.id,
      nebulaId: t.nebulaId,
      parentMessageId: t.parentMessageId,
      title: t.title,
      tagIds: t.tagIds,
      authorId: t.authorId,
      replyCount: t.replyCount,
      createdAt: t.createdAt.toISOString(),
      lastMessageAt: t.lastMessageAt.toISOString(),
      closed: isClosed(t, closeDays.get(t.nebulaId) ?? 7),
      pinned: !!t.pinnedAt,
      answerMessageId: t.answerMessageId,
      preview: first ? (first.deletedAt ? null : first.body.slice(0, 200)) : null,
      recentIds: recent.rows.filter((r) => r.thread_id === t.id).map((r) => r.sender_id),
      following: !!f?.following,
      unread: f?.following ? (unread.get(t.id) ?? 0) : 0,
    };
  });
}

/** Close days for these nebulas (id → days). */
export async function closeDaysOf(nebulaIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!nebulaIds.length) return out;
  for (const n of await db.select({ id: nebulas.id, days: nebulas.threadCloseDays }).from(nebulas).where(inArray(nebulas.id, [...new Set(nebulaIds)]))) out.set(n.id, n.days);
  return out;
}

/** The thread chips on messages threads were started from (message list, live events). */
export async function chipsFor(messageIds: string[]): Promise<Map<string, ThreadSummary>> {
  const out = new Map<string, ThreadSummary>();
  if (!messageIds.length) return out;
  const rows = await db.select().from(nebulaThreads).where(inArray(nebulaThreads.parentMessageId, messageIds));
  if (!rows.length) return out;
  for (const s of await summaries(rows, null, await closeDaysOf(rows.map((r) => r.nebulaId)))) out.set(s.parentMessageId!, s);
  return out;
}

/** A thread of this conversation (a reply's thread must be in the chat it's sent to). */
export async function threadIn(conversationId: string, threadId: string): Promise<(ThreadRow & { nebulaKind: string; closeDays: number }) | null> {
  const [row] = await db
    .select({ t: nebulaThreads, kind: nebulas.kind, closeDays: nebulas.threadCloseDays })
    .from(nebulaThreads)
    .innerJoin(nebulas, eq(nebulas.id, nebulaThreads.nebulaId))
    .where(and(eq(nebulaThreads.id, threadId), eq(nebulaThreads.conversationId, conversationId)));
  return row ? { ...row.t, nebulaKind: row.kind, closeDays: row.closeDays } : null;
}

export async function threadRowOf(id: string): Promise<ThreadRow | null> {
  const [row] = await db.select().from(nebulaThreads).where(eq(nebulaThreads.id, id));
  return row ?? null;
}

/** After a reply: counts, activity (reopens it), and the sender follows it. */
export async function noteReply(thread: ThreadRow, messageId: string, senderId: string, at: Date): Promise<void> {
  const opening = !thread.firstMessageId && !thread.parentMessageId && senderId === thread.authorId;
  await db
    .update(nebulaThreads)
    .set(
      opening
        ? { firstMessageId: messageId, lastMessageAt: at, closedAt: null }
        : { replyCount: sql`${nebulaThreads.replyCount} + 1`, lastMessageAt: at, closedAt: null },
    )
    .where(eq(nebulaThreads.id, thread.id));
  await follow(thread.id, senderId, true, at);
}

export async function follow(threadId: string, userId: string, following: boolean, readAt?: Date): Promise<void> {
  await db
    .insert(threadFollows)
    .values({ threadId, userId, following, lastReadAt: readAt ?? new Date() })
    .onConflictDoUpdate({
      target: [threadFollows.threadId, threadFollows.userId],
      set: readAt ? { following, lastReadAt: readAt } : { following },
    });
}

/** Followers to tell about a reply (besides the sender). */
export async function followersOf(threadId: string): Promise<string[]> {
  const rows = await db.select({ userId: threadFollows.userId }).from(threadFollows).where(and(eq(threadFollows.threadId, threadId), eq(threadFollows.following, true)));
  return rows.map((r) => r.userId);
}

/** My followed, still-open threads in these text nebulas (the sidebar), newest activity first. */
export async function myOpenThreads(userId: string, nebulaIds: string[]): Promise<ThreadSummary[]> {
  if (!nebulaIds.length) return [];
  const rows = await db
    .select({ t: nebulaThreads })
    .from(nebulaThreads)
    .innerJoin(threadFollows, and(eq(threadFollows.threadId, nebulaThreads.id), eq(threadFollows.userId, userId), eq(threadFollows.following, true)))
    .where(and(inArray(nebulaThreads.nebulaId, nebulaIds), isNull(nebulaThreads.closedAt), sql`${nebulaThreads.parentMessageId} is not null`))
    .orderBy(desc(nebulaThreads.lastMessageAt))
    .limit(60);
  const days = await closeDaysOf(nebulaIds);
  return (await summaries(rows.map((r) => r.t), userId, days)).filter((s) => !s.closed);
}

import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { and, desc, eq, ilike, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { POST_TAGS_MAX, THREAD_TITLE_MAX, threadTitleFrom, type ThreadSummary } from "@glofly/shared";
import { db } from "../db";
import { messages, nebulaThreads, nebulas } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { can, frozen, standingOf, type Standing } from "../constellations/perms";
import { seesNebulaChat, viewersOf } from "../constellations/access";
import { logModeration } from "../constellations/activity";
import { automodWordInEdit } from "../constellations/automod";
import { emitToUser } from "../realtime";
import { access, canPost, cantPostMessage, hydrate, messageFields } from "../messages/routes";
import { follow, forumSettingsOf, summaries, type ThreadRow } from "./core";

// Communities round (Nov 2026): threads + forum posts (approved canvas boards 16–22).
//
//   GET    /constellations/:id/nebulas/:nid/threads?q=&tag=&sort=&offset=   a forum's posts, or a
//                                                    text nebula's threads (open ones unless closed=1)
//   POST   /constellations/:id/nebulas/:nid/threads  { title?, parentMessageId?, tagIds? }
//          Text nebula: a thread off a message. Forum: a post (its opening message is then sent
//          like any message, with threadId; a post without one isn't listed and is swept).
//   GET    /constellations/:id/threads/:tid
//   PATCH  /constellations/:id/threads/:tid         { title?, tagIds?, closed?, pinned?, answerMessageId? }
//   DELETE /constellations/:id/threads/:tid
//   PUT    /constellations/:id/threads/:tid/follow  { following }
//   POST   /constellations/:id/threads/:tid/read
// Replies: POST /conversations/:nebulaChat/messages { body, threadId, alsoInNebula? } and
// GET /conversations/:nebulaChat/messages?thread=<tid>. Everything is checked on the server: who can
// see the nebula, who can post (time-outs, read-only, frozen, Lockdown, AutoMod), staff powers.
// Live events (modern apps only, people who can see the nebula): thread:updated, thread:deleted.

export const threadsRouter = Router();
threadsRouter.use(requireAuth);

const me = (res: Response) => res.locals.user as { id: string };
const bad = (res: Response, message: string, status = 400) => void res.status(status).json({ error: status === 404 ? "not_found" : "invalid", message });
const idParam = z.uuid();
const PAGE = 30;

/** Staff here: can manage nebulas or delete messages (moderators and up). */
const isStaff = (s: Standing) => can(s, "manageNebulas") || can(s, "deleteMessages");

const cleanTitle = (v: string) =>
  v.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, THREAD_TITLE_MAX);

async function standing(req: Request, res: Response): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) bad(res, "That constellation isn't available.", 404);
  return s;
}

async function nebulaHere(req: Request, res: Response, s: Standing) {
  const nid = idParam.safeParse(req.params.nid);
  const [n] = nid.success ? await db.select().from(nebulas).where(and(eq(nebulas.id, nid.data), eq(nebulas.constellationId, s.constellationId))) : [];
  if (!n || n.kind === "voice" || !(await seesNebulaChat(s.userId, n.conversationId))) {
    bad(res, "That nebula isn't there any more.", 404);
    return null;
  }
  return n;
}

async function threadHere(req: Request, res: Response, s: Standing) {
  const tid = idParam.safeParse(req.params.tid);
  const [row] = tid.success
    ? await db
        .select({ t: nebulaThreads, n: nebulas })
        .from(nebulaThreads)
        .innerJoin(nebulas, eq(nebulas.id, nebulaThreads.nebulaId))
        .where(and(eq(nebulaThreads.id, tid.data), eq(nebulaThreads.constellationId, s.constellationId)))
    : [];
  if (!row || !(await seesNebulaChat(s.userId, row.n.conversationId))) {
    bad(res, "That trail isn't there any more.", 404);
    return null;
  }
  return row;
}

async function oneSummary(t: ThreadRow, userId: string | null, closeDays: number): Promise<ThreadSummary> {
  return (await summaries([t], userId, new Map([[t.nebulaId, closeDays]])))[0];
}

/** Tell everyone who can see the nebula (modern apps); following/unread are each app's own. */
async function announce(t: ThreadRow, conversationId: string, closeDays: number): Promise<void> {
  const thread = await oneSummary(t, null, closeDays);
  for (const userId of await viewersOf(conversationId)) emitToUser(userId, "thread:updated", { constellationId: t.constellationId, thread }, true);
}

/** Tags for a forum post: known ids, staff-only ones only for staff, 0–3, required if set. */
function checkTags(n: typeof nebulas.$inferSelect, tagIds: string[], staff: boolean, previous: string[] = [], mine = false): string | string[] {
  const forum = forumSettingsOf(n);
  const ids = [...new Set(tagIds)];
  if (ids.length > POST_TAGS_MAX) return `Pick up to ${POST_TAGS_MAX} tags.`;
  for (const id of ids) {
    const tag = forum.tags.find((t) => t.id === id);
    if (!tag) return "One of those tags isn't there any more.";
    // A post's own author may mark it Solved (or not) even when that tag is staff-only.
    const solvedByAuthor = mine && tag.name.toLowerCase() === "solved";
    if (tag.staffOnly && !staff && !solvedByAuthor && !previous.includes(id)) return `Only staff can add the ${tag.name} tag.`;
  }
  // Someone who isn't staff can't take a staff-only tag off either.
  if (!staff)
    for (const id of previous) {
      const t = forum.tags.find((x) => x.id === id);
      if (t?.staffOnly && !ids.includes(id) && !(mine && t.name.toLowerCase() === "solved")) return "Only staff can take that tag off.";
    }
  if (forum.requireTag && !ids.length && forum.tags.some((t) => !t.staffOnly || staff)) return "Pick at least one tag.";
  return ids;
}

// ───────────── Lists ─────────────

threadsRouter.get("/:id/nebulas/:nid/threads", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const n = await nebulaHere(req, res, s);
  if (!n) return;
  const forum = n.kind === "forum";
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const tag = typeof req.query.tag === "string" ? req.query.tag.slice(0, 64) : "";
  const sort = req.query.sort === "newest" || req.query.sort === "activity" ? req.query.sort : forumSettingsOf(n).sort;
  const offset = Math.min(1000, Math.max(0, Number(req.query.offset) || 0));
  const quietBefore = new Date(Date.now() - n.threadCloseDays * 86_400_000);
  const where = and(
    eq(nebulaThreads.nebulaId, n.id),
    forum ? isNotNull(nebulaThreads.firstMessageId) : isNotNull(nebulaThreads.parentMessageId),
    !forum && req.query.closed !== "1" ? and(isNull(nebulaThreads.closedAt), sql`${nebulaThreads.lastMessageAt} > ${quietBefore}`) : undefined,
    tag ? sql`${tag} = any(${nebulaThreads.tagIds})` : undefined,
    q
      ? or(
          ilike(nebulaThreads.title, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`),
          sql`exists (select 1 from messages m where m.id = ${nebulaThreads.firstMessageId} and m.deleted_at is null and m.body ilike ${`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`})`,
        )
      : undefined,
  );
  const rows = await db
    .select()
    .from(nebulaThreads)
    .where(where)
    .orderBy(
      ...(forum ? [sql`${nebulaThreads.pinnedAt} is null`, desc(nebulaThreads.pinnedAt)] : []),
      sort === "newest" ? desc(nebulaThreads.createdAt) : desc(nebulaThreads.lastMessageAt),
      desc(nebulaThreads.id),
    )
    .limit(PAGE + 1)
    .offset(offset);
  const page = rows.slice(0, PAGE);
  res.json({ threads: await summaries(page, s.userId, new Map([[n.id, n.threadCloseDays]])), hasMore: rows.length > PAGE });
});

// ───────────── Start one ─────────────

const startBody = z.object({
  title: z.string().max(500).optional(),
  parentMessageId: idParam.optional(),
  tagIds: z.array(z.string().max(64)).max(10).default([]),
});

threadsRouter.post("/:id/nebulas/:nid/threads", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const n = await nebulaHere(req, res, s);
  if (!n) return;
  const body = startBody.safeParse(req.body);
  if (!body.success) return bad(res, "Send a title (and a message for a trail).");
  const chat = await access(n.conversationId, s.userId);
  if (!chat || !(await canPost(chat, s.userId))) return bad(res, chat ? await cantPostMessage(chat, s.userId) : "You can't post here.", 403);
  const staff = isStaff(s);
  let title = cleanTitle(body.data.title ?? "");
  let parent: { id: string; body: string } | null = null;
  let tagIds: string[] = [];
  if (n.kind === "text") {
    if (n.threadsStaffOnly && !staff) return bad(res, "Only staff can start trails here.", 403);
    if (!body.data.parentMessageId) return bad(res, "Pick a message to start the trail from.");
    const [m] = await db
      .select({ id: messages.id, body: messages.body, deletedAt: messages.deletedAt, event: messages.event, threadId: messages.threadId, lantern: messages.lantern })
      .from(messages)
      .where(and(eq(messages.id, body.data.parentMessageId), eq(messages.conversationId, n.conversationId)));
    if (!m || m.deletedAt || m.event || m.threadId || m.lantern) return bad(res, "You can't start a trail from that message.");
    const [already] = await db.select().from(nebulaThreads).where(eq(nebulaThreads.parentMessageId, m.id));
    if (already) return void res.json({ thread: await oneSummary(already, s.userId, n.threadCloseDays), existed: true });
    parent = m;
    if (!title) title = threadTitleFrom(m.body);
  } else {
    if (!title) return bad(res, "Give your signal a title.");
    const checked = checkTags(n, body.data.tagIds, staff);
    if (typeof checked === "string") return bad(res, checked);
    tagIds = checked;
  }
  const blocked = await automodWordInEdit(n.conversationId, s.userId, title);
  if (blocked) return bad(res, blocked, 403);
  // A forum post waiting for its opening message counts too (no flooding with empty posts).
  const waiting = await db.$count(nebulaThreads, and(eq(nebulaThreads.authorId, s.userId), isNull(nebulaThreads.firstMessageId), isNull(nebulaThreads.parentMessageId)));
  if (waiting >= 5) return bad(res, "Finish the signals you started first.", 429);
  const [t] = await db
    .insert(nebulaThreads)
    .values({ id: randomUUID(), constellationId: s.constellationId, nebulaId: n.id, conversationId: n.conversationId, parentMessageId: parent?.id ?? null, title, tagIds, authorId: s.userId })
    .onConflictDoNothing()
    .returning();
  if (!t) {
    const [again] = parent ? await db.select().from(nebulaThreads).where(eq(nebulaThreads.parentMessageId, parent.id)) : [];
    return again ? void res.json({ thread: await oneSummary(again, s.userId, n.threadCloseDays), existed: true }) : bad(res, "Try again.");
  }
  await follow(t.id, s.userId, true);
  if (parent) await announce(t, n.conversationId, n.threadCloseDays);
  res.status(201).json({ thread: await oneSummary(t, s.userId, n.threadCloseDays) });
});

// ───────────── One thread ─────────────

threadsRouter.get("/:id/threads/:tid", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const row = await threadHere(req, res, s);
  if (!row) return;
  // 0.9.1: the message a trail was started from, however old (apps used to look for it only in the
  // nebula's newest page, so older parents went missing).
  let parent = null;
  if (row.t.parentMessageId) {
    const [m] = await db.select(messageFields).from(messages).where(and(eq(messages.id, row.t.parentMessageId), eq(messages.conversationId, row.n.conversationId)));
    if (m) [parent] = await hydrate([m]);
  }
  res.json({ thread: await oneSummary(row.t, s.userId, row.n.threadCloseDays), parent, nebula: { id: row.n.id, kind: row.n.kind, name: row.n.name, conversationId: row.n.conversationId } });
});

const changeBody = z.object({
  title: z.string().max(500).optional(),
  tagIds: z.array(z.string().max(64)).max(10).optional(),
  closed: z.boolean().optional(),
  pinned: z.boolean().optional(),
  answerMessageId: idParam.nullable().optional(),
});

threadsRouter.patch("/:id/threads/:tid", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const row = await threadHere(req, res, s);
  if (!row) return;
  const { t, n } = row;
  const body = changeBody.safeParse(req.body);
  if (!body.success) return bad(res, "Nothing to change.");
  if (await frozen(s.constellationId)) return bad(res, "This constellation is paused by the Glofly team.", 403);
  const staff = isStaff(s);
  const mine = t.authorId === s.userId;
  const d = body.data;
  const set: Partial<typeof nebulaThreads.$inferInsert> = {};
  if (d.title !== undefined || d.tagIds !== undefined || d.closed !== undefined) {
    if (!staff && !mine) return bad(res, "Only who started it or staff can change that.", 403);
  }
  if (d.title !== undefined) {
    const title = cleanTitle(d.title);
    if (!title) return bad(res, "Give it a name.");
    const blocked = await automodWordInEdit(n.conversationId, s.userId, title);
    if (blocked) return bad(res, blocked, 403);
    set.title = title;
  }
  if (d.tagIds !== undefined) {
    if (n.kind !== "forum") return bad(res, "Only signals in a star chart have tags.");
    const checked = checkTags(n, d.tagIds, staff, t.tagIds, mine);
    if (typeof checked === "string") return bad(res, checked, 403);
    set.tagIds = checked;
  }
  if (d.closed !== undefined) set.closedAt = d.closed ? new Date() : null;
  if (d.closed === false) set.lastMessageAt = new Date();
  if (d.pinned !== undefined) {
    if (!staff) return bad(res, "Only staff can pin signals.", 403);
    set.pinnedAt = d.pinned ? new Date() : null;
  }
  if (d.answerMessageId !== undefined) {
    if (n.kind !== "forum") return bad(res, "Only signals in a star chart have answers.");
    if (!staff && !mine) return bad(res, "Only who sent it or staff can mark the answer.", 403);
    if (d.answerMessageId) {
      const [m] = await db
        .select({ id: messages.id, deletedAt: messages.deletedAt })
        .from(messages)
        .where(and(eq(messages.id, d.answerMessageId), eq(messages.threadId, t.id)));
      if (!m || m.deletedAt || m.id === t.firstMessageId) return bad(res, "Pick a reply in this signal.");
    }
    set.answerMessageId = d.answerMessageId;
    // "Solved": the forum's tag named Solved goes on with an answer and off without one.
    const solved = forumSettingsOf(n).tags.find((x) => x.name.toLowerCase() === "solved");
    if (solved) {
      const tags = new Set(set.tagIds ?? t.tagIds);
      if (d.answerMessageId) tags.add(solved.id);
      else tags.delete(solved.id);
      set.tagIds = [...tags].slice(0, POST_TAGS_MAX + 1);
    }
  }
  if (!Object.keys(set).length) return void res.json({ thread: await oneSummary(t, s.userId, n.threadCloseDays) });
  const [changed] = await db.update(nebulaThreads).set(set).where(eq(nebulaThreads.id, t.id)).returning();
  if (!mine && (d.title !== undefined || d.closed !== undefined || d.pinned !== undefined || d.tagIds !== undefined)) {
    await logModeration(s.constellationId, s.userId, "thread_changed", t.authorId, { thread: changed.title, nebulaId: n.id });
  }
  await announce(changed, n.conversationId, n.threadCloseDays);
  res.json({ thread: await oneSummary(changed, s.userId, n.threadCloseDays) });
});

threadsRouter.delete("/:id/threads/:tid", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const row = await threadHere(req, res, s);
  if (!row) return;
  const { t, n } = row;
  const staff = isStaff(s);
  // Who started it may delete it while nobody else has replied; staff any time.
  const others = await db.$count(messages, and(eq(messages.threadId, t.id), sql`${messages.senderId} <> ${s.userId}::uuid`, isNull(messages.deletedAt)));
  if (!staff && !(t.authorId === s.userId && others === 0)) return bad(res, "Only staff can delete a trail others have replied in.", 403);
  if (await frozen(s.constellationId)) return bad(res, "This constellation is paused by the Glofly team.", 403);
  await db.delete(nebulaThreads).where(eq(nebulaThreads.id, t.id));
  if (t.authorId !== s.userId) await logModeration(s.constellationId, s.userId, "thread_deleted", t.authorId, { thread: t.title, nebulaId: n.id });
  for (const userId of await viewersOf(n.conversationId)) emitToUser(userId, "thread:deleted", { constellationId: s.constellationId, nebulaId: n.id, threadId: t.id, parentMessageId: t.parentMessageId }, true);
  res.json({ ok: true });
});

threadsRouter.put("/:id/threads/:tid/follow", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const row = await threadHere(req, res, s);
  if (!row) return;
  const following = req.body?.following !== false;
  await follow(row.t.id, s.userId, following, new Date());
  res.json({ thread: await oneSummary(row.t, s.userId, row.n.threadCloseDays) });
});

threadsRouter.post("/:id/threads/:tid/read", async (req, res) => {
  const s = await standing(req, res);
  if (!s) return;
  const row = await threadHere(req, res, s);
  if (!row) return;
  const [f] = await db.execute<{ following: boolean }>(sql`
    insert into thread_follows (thread_id, user_id, following, last_read_at) values (${row.t.id}::uuid, ${s.userId}::uuid, false, now())
    on conflict (thread_id, user_id) do update set last_read_at = now() returning following`).then((r) => r.rows);
  res.json({ ok: true, following: !!f?.following });
});

/** Forum posts nobody finished (no opening message after 30 minutes) are removed. */
export async function sweepUnfinishedPosts(): Promise<void> {
  await db
    .delete(nebulaThreads)
    .where(and(isNull(nebulaThreads.firstMessageId), isNull(nebulaThreads.parentMessageId), lt(nebulaThreads.createdAt, new Date(Date.now() - 30 * 60_000))));
}

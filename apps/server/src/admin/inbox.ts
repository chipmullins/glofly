import { Router } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { teamReplies, userNotices, users } from "../db/schema";
import { emitToUser } from "../realtime";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip } from "./routes";

// 0.8.2: "Message as Glofly team" and Control's Inbox.
//
// A team message is a user notice of kind "message": the apps show it as a message from the
// Glofly Team (apps from 0.8.2 with a reply box when replies are allowed; older apps show it like a
// warning, "A message from the Glofly team" + I understand). Replies (POST /notices/:id/reply,
// safety/routes.ts) land here.

export const inboxRouter = Router();

export const TEAM_MESSAGE_MAX = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /admin/accounts/:id/message  { body, allowReply, note }
inboxRouter.post("/accounts/:id/message", async (req, res) => {
  const parsed = z
    .object({
      body: z.string({ error: "Write the message." }).trim().min(1, "Write the message.").max(TEAM_MESSAGE_MAX, `Keep it under ${TEAM_MESSAGE_MAX} characters.`),
      allowReply: z.boolean().default(true),
      note: noteSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = String(req.params.id);
  const [user] = UUID.test(id)
    ? await db.select({ id: users.id, username: users.username, deleteAfter: users.deleteAfter }).from(users).where(eq(users.id, id))
    : [];
  if (!user || user.deleteAfter) {
    res.status(404).json({ error: "not_found", message: "That account is gone or being deleted." });
    return;
  }
  const me = admin(res);
  const [notice] = await db
    .insert(userNotices)
    .values({ userId: user.id, kind: "message", body: parsed.data.body, allowReply: parsed.data.allowReply, sentBy: me.id })
    .returning({ id: userNotices.id, kind: userNotices.kind, body: userNotices.body, createdAt: userNotices.createdAt, allowReply: userNotices.allowReply });
  emitToUser(user.id, "notice:new", { notice });
  await logAction({
    adminId: me.id,
    action: "Sent a Glofly Team message",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    details: { noticeId: notice.id, allowReply: parsed.data.allowReply, length: parsed.data.body.length },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.status(201).json({ ok: true, message: `Sent to @${user.username}. They'll see it next time Glofly is open.` });
});

// GET /admin/inbox — everyone you've messaged or who replied, newest first.
inboxRouter.get("/inbox", async (_req, res) => {
  const sent = db
    .select({ userId: userNotices.userId, at: userNotices.createdAt, body: userNotices.body, fromTeam: sql<boolean>`true`.as("from_team") })
    .from(userNotices)
    .where(eq(userNotices.kind, "message"));
  const replies = db
    .select({ userId: teamReplies.userId, at: teamReplies.createdAt, body: teamReplies.body, fromTeam: sql<boolean>`false`.as("from_team") })
    .from(teamReplies);
  const all = await sent.unionAll(replies);
  const byUser = new Map<string, { lastAt: Date; preview: string; fromTeam: boolean }>();
  for (const row of all) {
    const old = byUser.get(row.userId);
    if (!old || row.at > old.lastAt) byUser.set(row.userId, { lastAt: row.at, preview: row.body, fromTeam: row.fromTeam });
  }
  const ids = [...byUser.keys()];
  const people = ids.length
    ? await db.select({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion }).from(users).where(inArray(users.id, ids))
    : [];
  const unread = ids.length
    ? await db
        .select({ userId: teamReplies.userId, n: sql<number>`count(*)::int` })
        .from(teamReplies)
        .where(isNull(teamReplies.readAt))
        .groupBy(teamReplies.userId)
    : [];
  const threads = people
    .map((p) => {
      const t = byUser.get(p.id)!;
      return {
        user: p,
        lastAt: t.lastAt.toISOString(),
        preview: t.preview.slice(0, 140),
        lastFromTeam: t.fromTeam,
        unread: unread.find((u) => u.userId === p.id)?.n ?? 0,
      };
    })
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .slice(0, 100);
  res.json({ threads, unreadTotal: unread.reduce((n, u) => n + u.n, 0) });
});

// GET /admin/inbox/:userId — one conversation (and marks their replies read).
inboxRouter.get("/inbox/:userId", async (req, res) => {
  const id = String(req.params.userId);
  const [user] = UUID.test(id)
    ? await db.select({ id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion }).from(users).where(eq(users.id, id))
    : [];
  if (!user) {
    res.status(404).json({ error: "not_found", message: "That account is gone." });
    return;
  }
  const notes = await db
    .select({ id: userNotices.id, body: userNotices.body, createdAt: userNotices.createdAt, seenAt: userNotices.seenAt, allowReply: userNotices.allowReply })
    .from(userNotices)
    .where(and(eq(userNotices.userId, user.id), eq(userNotices.kind, "message")))
    .orderBy(desc(userNotices.createdAt))
    .limit(100);
  const answers = await db
    .select({ id: teamReplies.id, noticeId: teamReplies.noticeId, body: teamReplies.body, createdAt: teamReplies.createdAt, readAt: teamReplies.readAt })
    .from(teamReplies)
    .where(eq(teamReplies.userId, user.id))
    .orderBy(desc(teamReplies.createdAt))
    .limit(100);
  await db.update(teamReplies).set({ readAt: new Date() }).where(and(eq(teamReplies.userId, user.id), isNull(teamReplies.readAt)));
  const items = [
    ...notes.map((n) => ({ id: n.id, from: "team" as const, body: n.body, createdAt: n.createdAt.toISOString(), seen: !!n.seenAt, allowReply: n.allowReply })),
    ...answers.map((a) => ({ id: a.id, from: "user" as const, body: a.body, createdAt: a.createdAt.toISOString(), unread: !a.readAt, noticeId: a.noticeId })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  res.json({ user, items });
});

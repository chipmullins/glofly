import { Router, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  announcements,
  conversationMembers,
  conversations,
  messages,
  reports,
  userNotices,
  users,
  type ReportSnapshot,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { attachmentsOf } from "../messages/attachments";
import { blockPerson } from "../friends/routes";
import { pair } from "../friends/rules";

// Reporting messages and people, messages from the Glofly team (warnings), and the
// announcement banner. Reports are reviewed in Glofly Control.

export const reportsRouter = Router();
export const noticesRouter = Router();
reportsRouter.use(requireAuth);
noticesRouter.use(requireAuth);

type Me = { id: string; username: string };
const me = (res: Response): Me => res.locals.user as Me;

export const REPORT_REASONS = ["spam", "harassment", "hate", "sexual", "violence", "self_harm", "other"] as const;

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "You've sent a lot of reports. Try again in a little while." },
});

const reportBody = z
  .object({
    messageId: z.uuid().optional(),
    conversationId: z.uuid().optional(),
    userId: z.uuid().optional(),
    reason: z.enum(REPORT_REASONS, { error: "Pick what's wrong." }),
    details: z
      .string()
      .optional()
      .transform((s) => (s ?? "").replace(/\r\n/g, "\n").trim())
      .pipe(z.string().max(1000, "Keep the details under 1,000 characters.")),
    block: z.boolean().optional(),
  })
  .strict()
  .refine((b) => b.messageId || b.userId, "Pick a message or a person to report.");

const CONTEXT_EACH_SIDE = 5;

type Row = { id: string; senderId: string; body: string; createdAt: Date; deletedAt: Date | null };

/** The people a snapshot names, as they're called now. */
async function peopleOf(ids: string[]): Promise<ReportSnapshot["people"]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  return db
    .select({ id: users.id, username: users.username, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, unique));
}

async function snapshotRows(rows: Row[]) {
  const files = await attachmentsOf(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    senderId: r.senderId,
    body: r.deletedAt ? "" : r.body,
    createdAt: r.createdAt.toISOString(),
    deleted: r.deletedAt !== null,
    attachments: r.deletedAt ? [] : (files.get(r.id) ?? []).map((f) => f.name),
  }));
}

const rowFields = {
  id: messages.id,
  senderId: messages.senderId,
  body: messages.body,
  createdAt: messages.createdAt,
  deletedAt: messages.deletedAt,
};

// POST /reports  { messageId + conversationId | userId, reason, details?, block? }
// Saves a copy of what was reported, as the reporter saw it, so it can be reviewed even if
// it's edited or deleted later.
reportsRouter.post("/", reportLimiter, async (req, res) => {
  const myId = me(res).id;
  const parsed = reportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "That report didn't work." });
    return;
  }
  const { messageId, reason, details, block } = parsed.data;
  let reportedUserId: string;
  let conversationId: string | null = null;
  let snapshot: ReportSnapshot;

  if (messageId) {
    // A message: it must be in a chat I'm in, from someone else, and not a line like "Chip added Maya".
    const [row] = await db
      .select({ ...rowFields, conversationId: messages.conversationId, event: messages.event })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, myId)),
      )
      .where(eq(messages.id, messageId));
    if (!row || row.event || (parsed.data.conversationId && parsed.data.conversationId !== row.conversationId)) {
      res.status(404).json({ error: "not_found", message: "That message isn't available any more." });
      return;
    }
    if (row.senderId === myId) {
      res.status(400).json({ error: "invalid", message: "You can't report your own message." });
      return;
    }
    if (row.deletedAt) {
      res.status(400).json({ error: "invalid", message: "That message was already deleted." });
      return;
    }
    reportedUserId = row.senderId;
    conversationId = row.conversationId;
    const [before, after, [chat]] = await Promise.all([
      db
        .select(rowFields)
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, row.conversationId),
            isNull(messages.event),
            ne(messages.id, row.id), // (dates come back to the millisecond; the database keeps more)
            or(lt(messages.createdAt, row.createdAt), and(eq(messages.createdAt, row.createdAt), lt(messages.id, row.id))),
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(CONTEXT_EACH_SIDE),
      db
        .select(rowFields)
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, row.conversationId),
            isNull(messages.event),
            ne(messages.id, row.id),
            or(gt(messages.createdAt, row.createdAt), and(eq(messages.createdAt, row.createdAt), gt(messages.id, row.id))),
          ),
        )
        .orderBy(messages.createdAt, messages.id)
        .limit(CONTEXT_EACH_SIDE),
      db
        .select({ kind: conversations.kind, name: conversations.name })
        .from(conversations)
        .where(eq(conversations.id, row.conversationId)),
    ]);
    const [reported] = await snapshotRows([row]);
    const context = await snapshotRows([...before.reverse(), row, ...after]);
    snapshot = {
      message: {
        id: reported.id,
        senderId: reported.senderId,
        body: reported.body,
        createdAt: reported.createdAt,
        attachments: reported.attachments,
      },
      context,
      people: await peopleOf([myId, ...context.map((c) => c.senderId)]),
      chat: chat ?? null,
    };
    const duplicate = await db
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.reporterId, myId), eq(reports.messageId, messageId), eq(reports.status, "open")));
    if (duplicate.length) {
      if (block) await blockPerson(myId, reportedUserId);
      res.json({ ok: true, alreadyReported: true });
      return;
    }
  } else {
    // A person (from their profile card). Their recent messages with me, if we have a DM.
    const userId = parsed.data.userId as string;
    if (userId === myId) {
      res.status(400).json({ error: "invalid", message: "You can't report yourself." });
      return;
    }
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!exists) {
      res.status(404).json({ error: "not_found", message: "That account isn't available any more." });
      return;
    }
    reportedUserId = userId;
    const { userLow, userHigh } = pair(myId, userId);
    const [dm] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.dmKey, `${userLow}:${userHigh}`));
    const recent = dm
      ? await db
          .select(rowFields)
          .from(messages)
          .where(and(eq(messages.conversationId, dm.id), isNull(messages.event)))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(CONTEXT_EACH_SIDE * 2)
      : [];
    conversationId = dm?.id ?? null;
    const context = await snapshotRows(recent.reverse());
    snapshot = {
      message: null,
      context,
      people: await peopleOf([myId, userId]),
      chat: dm ? { kind: "dm", name: null } : null,
    };
  }

  try {
    await db.insert(reports).values({
      reporterId: myId,
      reportedUserId,
      conversationId,
      messageId: messageId ?? null,
      reason,
      details: details || null,
      snapshot,
    });
  } catch (err) {
    // Two reports of the same message at once: the unique index keeps just one.
    if ((err as { code?: string })?.code !== "23505") throw err;
  }
  if (block) await blockPerson(myId, reportedUserId);
  res.status(201).json({ ok: true });
});

// ───────────── Messages from the Glofly team, and the announcement banner ─────────────

/** The announcement showing right now, if any. */
export async function currentAnnouncement() {
  const now = new Date();
  const [row] = await db
    .select({
      id: announcements.id,
      body: announcements.body,
      tone: announcements.tone,
      linkUrl: announcements.linkUrl,
      linkLabel: announcements.linkLabel,
      createdAt: announcements.createdAt,
      endsAt: announcements.endsAt,
    })
    .from(announcements)
    .where(and(isNull(announcements.endedAt), or(isNull(announcements.endsAt), gt(announcements.endsAt, now))))
    .orderBy(desc(announcements.createdAt))
    .limit(1);
  return row ?? null;
}

// GET /notices — warnings I haven't acknowledged yet, and the current announcement.
noticesRouter.get("/", async (_req, res) => {
  const myId = me(res).id;
  const unseen = await db
    .select({ id: userNotices.id, kind: userNotices.kind, body: userNotices.body, createdAt: userNotices.createdAt })
    .from(userNotices)
    .where(and(eq(userNotices.userId, myId), isNull(userNotices.seenAt)))
    .orderBy(userNotices.createdAt);
  res.json({ notices: unseen, announcement: await currentAnnouncement() });
});

// POST /notices/:id/seen — "I understand".
noticesRouter.post("/:id/seen", async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  if (id.success) {
    await db
      .update(userNotices)
      .set({ seenAt: new Date() })
      .where(and(eq(userNotices.id, id.data), eq(userNotices.userId, me(res).id), isNull(userNotices.seenAt)));
  }
  res.status(204).end();
});

/** Resolved reports (and their copy of the messages) are kept a year, then removed (hourly). */
export async function purgeOldReports(): Promise<void> {
  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  await db.delete(reports).where(and(eq(reports.status, "resolved"), lt(reports.resolvedAt, cutoff)));
}

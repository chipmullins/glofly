import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  BLOCKED_WORDS_MAX,
  EVENT_DESCRIPTION_MAX,
  EVENT_MAX_AHEAD_DAYS,
  EVENT_TITLE_MAX,
  NEW_MEMBER_WAIT_CHOICES,
  blockedWordIn,
  cleanBlockedWord,
  isInboxTab,
  isSearchHas,
  isSlowModeChoice,
  type ConstellationPermission,
} from "@glofly/shared";
import { db } from "../db";
import { automodHeld, constellationAutomod, constellationEventRsvps, constellationEvents, messages, nebulas } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { access, hydrate, postSpecial, type MessageRow, messageFields } from "../messages/routes";
import { can, canPostInNebula, outranks, standingOf, type Standing } from "./perms";
import { logModeration } from "./activity";
import { publicUsers } from "./views";
import { automodLog, automodRow, forgetAutomod, nebulasOf, settingsOf, waiveWait } from "./automod";
import { cardText, eventChanged, eventsOf, eventViews, refreshCard, visibleEvents } from "./events";
import { seesNebulaChat, visibleChats } from "./access";
import { inboxFor, markInboxAllRead, markInboxRead } from "./inbox";

// Constellations community tools (0.8.0, approved Oct 20 boards 9, 13, 14, 15). Mounted at
// /constellations (communityToolsRouter) before the main constellations router (so /constellations/inbox isn't taken
// for a constellation id). Restricted (family) accounts can't use any of it.
//
//   GET    /constellations/inbox?tab=&before=           the Inbox (one tab, newest first)
//   POST   /constellations/inbox/read                   { keys }  mark items read
//   POST   /constellations/inbox/read-all               "Mark all read"
//   GET    /constellations/:id/search?q=&from=&in=&has=&before=&after=&cursor=
//   GET    /constellations/:id/events                   upcoming, happening, and the last day's
//   POST   /constellations/:id/events                   { nebulaId, title, description?, startsAt, endsAt?, voiceNebulaId?, timeZone? }
//   PATCH  /constellations/:id/events/:eid              (host, or a moderator above them)
//   DELETE /constellations/:id/events/:eid              cancel (same)
//   PUT    /constellations/:id/events/:eid/rsvp         { answer: going | maybe | no | null }
//   GET    /constellations/:id/automod                  settings + what AutoMod did lately
//   PUT    /constellations/:id/automod                  { wordsOn?, words?, linkGuardOn?, slowModeOn?, slowMode?, newMemberWaitMinutes? }
//   POST   /constellations/:id/automod/held/:hid/release   Undo: post the held message
//   POST   /constellations/:id/automod/wait/:uid/waive     Undo: let a new member post now

export const communityToolsRouter = Router();
communityToolsRouter.use(requireAuth);

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;

communityToolsRouter.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

const limiter = (limit: number, windowMs: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    keyGenerator: (_req, res) => me(res).id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "too_many_requests", message },
  });
const changeLimiter = limiter(120, 10 * 60 * 1000, "That's a lot of changes. Wait a few minutes and try again.");
const searchLimiter = limiter(40, 60 * 1000, "That's a lot of searching. Try again in a minute.");
const eventLimiter = limiter(20, 60 * 60 * 1000, "That's a lot of new events. Try again later.");
const rsvpLimiter = limiter(120, 10 * 60 * 1000, "That's a lot of answers. Wait a few minutes and try again.");

const idParam = z.uuid();
const HIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/;
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : "invalid", message });
const notFound = (res: Response, message = "That constellation isn't available.") => res.status(404).json({ error: "not_found", message });

/** I'm in this constellation (and, if asked, may do this). Answers the request otherwise. */
async function standingFor(req: Request, res: Response, permission?: ConstellationPermission | ConstellationPermission[]): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    notFound(res);
    return null;
  }
  const need = permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];
  if (need.length && !need.some((p) => can(s, p))) {
    bad(res, "Your role doesn't allow that here.", 403);
    return null;
  }
  return s;
}

// ───────────── Inbox ─────────────

communityToolsRouter.get("/inbox", async (req, res) => {
  const tab = isInboxTab(req.query.tab) ? req.query.tab : "all";
  const before = typeof req.query.before === "string" && !Number.isNaN(Date.parse(req.query.before)) ? new Date(req.query.before).toISOString() : undefined;
  res.json(await inboxFor(me(res).id, tab, before));
});

communityToolsRouter.post("/inbox/read", async (req, res) => {
  const keys = z.array(z.string().max(120)).max(200).safeParse(req.body?.keys);
  if (!keys.success) {
    bad(res, "Pick what to mark read.");
    return;
  }
  await markInboxRead(me(res).id, keys.data);
  res.status(204).end();
});

communityToolsRouter.post("/inbox/read-all", async (_req, res) => {
  await markInboxAllRead(me(res).id);
  res.status(204).end();
});

// ───────────── Search across a constellation ─────────────

communityToolsRouter.get("/:id/search", searchLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const q = typeof req.query.q === "string" ? req.query.q.normalize("NFKC").trim().slice(0, 100) : "";
  const from = req.query.from === undefined ? null : idParam.safeParse(req.query.from);
  const inNebula = req.query.in === undefined ? null : idParam.safeParse(req.query.in);
  const has = req.query.has === undefined ? null : isSearchHas(req.query.has) ? req.query.has : false;
  const date = (x: unknown) => (typeof x === "string" && !Number.isNaN(Date.parse(x)) ? new Date(x) : x === undefined ? null : false);
  const before = date(req.query.before);
  const after = date(req.query.after);
  const cursor = req.query.cursor === undefined ? null : idParam.safeParse(req.query.cursor);
  if ((from && !from.success) || (inNebula && !inNebula.success) || has === false || before === false || after === false || (cursor && !cursor.success)) {
    bad(res, "That search didn't work. Check the filters.");
    return;
  }
  const words = q.split(/\s+/).filter((w) => w.length >= 1).slice(0, 8);
  if (q.length < 2 && !from && !has && !inNebula) {
    bad(res, "Type at least 2 characters, or pick a filter.");
    return;
  }

  // Every nebula of this constellation I can see (0.8.0: not role-only ones without the role).
  const all = await db
    .select({ id: nebulas.id, name: nebulas.name, kind: nebulas.kind, conversationId: nebulas.conversationId })
    .from(nebulas)
    .where(eq(nebulas.constellationId, s.constellationId));
  const seen = await visibleChats(s.userId, all.map((n) => n.conversationId));
  const list = all.filter((n) => seen.has(n.conversationId));
  const shown = inNebula ? list.filter((n) => n.id === inNebula.data) : list;
  if (!shown.length) {
    res.json({ results: [], hasMore: false });
    return;
  }
  const byChat = new Map(shown.map((n) => [n.conversationId, n]));

  let olderThan = undefined;
  if (cursor) {
    const [anchor] = await db.select({ createdAt: messages.createdAt }).from(messages).where(eq(messages.id, cursor.data));
    if (anchor) olderThan = or(lt(messages.createdAt, anchor.createdAt), and(eq(messages.createdAt, anchor.createdAt), lt(messages.id, cursor.data)));
  }
  const escape = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const hasFilter =
    has === "image"
      ? sql`exists (select 1 from attachments a where a.message_id = ${messages.id} and a.kind = 'image' and not a.sticker)`
      : has === "file"
        ? sql`exists (select 1 from attachments a where a.message_id = ${messages.id} and a.kind <> 'image')`
        : has === "link"
          ? sql`${messages.body} ~* '(https?://|www\\.)'`
          : undefined;
  const PAGE = 25;
  const rows: MessageRow[] = await db
    .select(messageFields)
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, [...byChat.keys()]),
        isNull(messages.deletedAt),
        isNull(messages.event),
        ...words.map((w) => ilike(messages.body, escape(w))),
        from ? eq(messages.senderId, from.data) : undefined,
        hasFilter,
        before ? lt(messages.createdAt, before) : undefined,
        after ? gte(messages.createdAt, after) : undefined,
        olderThan,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const full = await hydrate(page);
  const people = await publicUsers(page.map((r) => r.senderId));
  res.json({
    results: full.map((m) => {
      const n = byChat.get(m.conversationId)!;
      return { message: m, nebula: { id: n.id, name: n.name, kind: n.kind, conversationId: n.conversationId }, sender: people.get(m.senderId) ?? null };
    }),
    hasMore: rows.length > PAGE,
  });
});

// ───────────── Events with RSVP ─────────────

const plainText = (max: number, label: string) =>
  z
    .string()
    .transform((t) => t.normalize("NFKC").trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(1, `${label} can't be empty.`)
        .max(max, `${label} can be up to ${max} characters.`)
        .refine((t) => !HIDDEN_CHARS.test(t), `${label} can't contain hidden characters.`),
    );
const optionalText = (max: number, label: string) =>
  z
    .string()
    .nullable()
    .transform((t) => (t ?? "").replace(/\r\n/g, "\n").trim())
    .pipe(z.string().max(max, `${label} can be up to ${max} characters.`))
    .transform((t) => t || null);
const when = z.iso.datetime({ offset: true }).transform((t) => new Date(t));
const timeZoneField = z
  .string()
  .max(64)
  .nullable()
  .refine((tz) => {
    if (!tz) return true;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "That time zone isn't known.");

const eventFields = z.object({
  nebulaId: idParam,
  title: plainText(EVENT_TITLE_MAX, "The title"),
  description: optionalText(EVENT_DESCRIPTION_MAX, "The description").optional(),
  startsAt: when,
  endsAt: when.nullable().optional(),
  voiceNebulaId: idParam.nullable().optional(),
  timeZone: timeZoneField.optional(),
});

/** Checks an event's times (new or changed). */
function timesProblem(startsAt: Date, endsAt: Date | null | undefined, isNew: boolean): string | null {
  const now = Date.now();
  if (isNew && startsAt.getTime() < now - 60_000) return "Pick a time that hasn't passed yet.";
  if (startsAt.getTime() > now + EVENT_MAX_AHEAD_DAYS * 86_400_000) return "Events can be planned up to a year ahead.";
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) return "It has to end after it starts.";
  if (endsAt && endsAt.getTime() - startsAt.getTime() > 24 * 3_600_000) return "Events can last up to 24 hours.";
  return null;
}

/** A blocked word in an event's text (AutoMod), or null. */
async function eventWordProblem(s: Standing, ...texts: (string | null | undefined)[]): Promise<string | null> {
  if (s.owner || can(s, "deleteMessages")) return null;
  const set = settingsOf(await automodRow(s.constellationId));
  if (!set.wordsOn || !set.words.length) return null;
  return blockedWordIn(texts.filter(Boolean).join("\n"), set.words)
    ? "AutoMod: that has a word this constellation doesn't allow."
    : null;
}

async function eventIn(s: Standing, eid: unknown) {
  const id = idParam.safeParse(eid);
  if (!id.success) return null;
  const [row] = await db
    .select()
    .from(constellationEvents)
    .where(and(eq(constellationEvents.id, id.data), eq(constellationEvents.constellationId, s.constellationId)));
  // 0.8.0: an event in a role-only nebula I can't see isn't there for me.
  if (!row || !(await visibleEvents([row], s.userId)).length) return null;
  return row;
}

async function nebulaIn(constellationId: string, nebulaId: string) {
  const [n] = await db
    .select({ id: nebulas.id, kind: nebulas.kind, conversationId: nebulas.conversationId, name: nebulas.name })
    .from(nebulas)
    .where(and(eq(nebulas.id, nebulaId), eq(nebulas.constellationId, constellationId)));
  return n ?? null;
}

communityToolsRouter.get("/:id/events", async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  res.json({ events: await eventViews(await visibleEvents(await eventsOf(s.constellationId), s.userId), s) });
});

communityToolsRouter.post("/:id/events", eventLimiter, async (req, res) => {
  const s = await standingFor(req, res, "events");
  if (!s) return;
  if (s.timedOutUntil) {
    bad(res, "You're timed out for now, so you can't plan events.", 403);
    return;
  }
  const parsed = eventFields.safeParse(req.body);
  if (!parsed.success) {
    bad(res, parsed.error.issues[0]?.message ?? "That event didn't work. Check it and try again.");
    return;
  }
  const v = parsed.data;
  const problem = timesProblem(v.startsAt, v.endsAt, true);
  if (problem) {
    bad(res, problem);
    return;
  }
  const where = await nebulaIn(s.constellationId, v.nebulaId);
  if (!where || where.kind !== "text") {
    bad(res, "Pick a text nebula to post the event in.");
    return;
  }
  if (!(await canPostInNebula(where.conversationId, s.userId))) {
    bad(res, "You can't post in that nebula.", 403);
    return;
  }
  if (v.voiceNebulaId) {
    const voice = await nebulaIn(s.constellationId, v.voiceNebulaId);
    if (!voice || voice.kind !== "voice" || !(await seesNebulaChat(s.userId, voice.conversationId))) {
      bad(res, "Pick one of this constellation's voice nebulas.");
      return;
    }
  }
  const word = await eventWordProblem(s, v.title, v.description);
  if (word) {
    bad(res, word, 403);
    return;
  }
  const [row] = await db
    .insert(constellationEvents)
    .values({
      constellationId: s.constellationId,
      nebulaId: where.id,
      voiceNebulaId: v.voiceNebulaId ?? null,
      title: v.title,
      description: v.description ?? null,
      startsAt: v.startsAt,
      endsAt: v.endsAt ?? null,
      timeZone: v.timeZone ?? null,
      hostId: s.userId,
    })
    .returning();
  // The host is going (they can change it).
  await db.insert(constellationEventRsvps).values({ eventId: row.id, userId: s.userId, answer: "going" }).onConflictDoNothing();
  // The card in the nebula: plain text for apps that don't know events.
  const chat = await access(where.conversationId, s.userId);
  if (chat) {
    const message = await postSpecial(chat, where.conversationId, s.userId, { body: await cardText(row) }, res.locals.sessionId as string | undefined);
    await db.update(constellationEvents).set({ messageId: message.id }).where(eq(constellationEvents.id, row.id));
    row.messageId = message.id;
  }
  await eventChanged(s.constellationId, row.id);
  const [view] = await eventViews([row], s);
  res.status(201).json({ event: view });
});

communityToolsRouter.patch("/:id/events/:eid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const row = await eventIn(s, req.params.eid);
  if (!row) {
    notFound(res, "That event isn't there any more.");
    return;
  }
  const [view] = await eventViews([row], s);
  if (!view.canManage) {
    bad(res, "Only the host (or a moderator above them) can change this event.", 403);
    return;
  }
  if (row.cancelledAt) {
    bad(res, "This event was cancelled.");
    return;
  }
  const parsed = eventFields.omit({ nebulaId: true }).partial().safeParse(req.body ?? {});
  if (!parsed.success) {
    bad(res, parsed.error.issues[0]?.message ?? "That change didn't work.");
    return;
  }
  const v = parsed.data;
  const startsAt = v.startsAt ?? row.startsAt;
  const endsAt = v.endsAt === undefined ? row.endsAt : v.endsAt;
  const moved = v.startsAt !== undefined && v.startsAt.getTime() !== row.startsAt.getTime();
  const problem = timesProblem(startsAt, endsAt, moved);
  if (problem) {
    bad(res, problem);
    return;
  }
  if (v.voiceNebulaId) {
    const voice = await nebulaIn(s.constellationId, v.voiceNebulaId);
    if (!voice || voice.kind !== "voice" || !(await seesNebulaChat(s.userId, voice.conversationId))) {
      bad(res, "Pick one of this constellation's voice nebulas.");
      return;
    }
  }
  const word = await eventWordProblem(s, v.title, v.description);
  if (word) {
    bad(res, word, 403);
    return;
  }
  const [updated] = await db
    .update(constellationEvents)
    .set({
      ...(v.title !== undefined ? { title: v.title } : {}),
      ...(v.description !== undefined ? { description: v.description } : {}),
      ...(v.voiceNebulaId !== undefined ? { voiceNebulaId: v.voiceNebulaId } : {}),
      ...(v.timeZone !== undefined ? { timeZone: v.timeZone } : {}),
      startsAt,
      endsAt,
      // A new time: the reminder and the start happen again.
      ...(moved ? { remindedAt: null, startedAt: null } : {}),
    })
    .where(eq(constellationEvents.id, row.id))
    .returning();
  await refreshCard(updated);
  await eventChanged(s.constellationId, row.id);
  const [out] = await eventViews([updated], s);
  res.json({ event: out });
});

communityToolsRouter.delete("/:id/events/:eid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const row = await eventIn(s, req.params.eid);
  if (!row) {
    notFound(res, "That event isn't there any more.");
    return;
  }
  const [view] = await eventViews([row], s);
  if (!view.canManage) {
    bad(res, "Only the host (or a moderator above them) can cancel this event.", 403);
    return;
  }
  if (!row.cancelledAt) {
    const [updated] = await db.update(constellationEvents).set({ cancelledAt: new Date() }).where(eq(constellationEvents.id, row.id)).returning();
    await refreshCard(updated);
    if (row.hostId !== s.userId) await logModeration(s.constellationId, s.userId, "event_cancelled", row.hostId, { eventId: row.id, title: row.title });
    await eventChanged(s.constellationId, row.id);
  }
  res.status(204).end();
});

communityToolsRouter.put("/:id/events/:eid/rsvp", rsvpLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const row = await eventIn(s, req.params.eid);
  if (!row) {
    notFound(res, "That event isn't there any more.");
    return;
  }
  const answer = z.enum(["going", "maybe", "no"]).nullable().safeParse(req.body?.answer ?? null);
  if (!answer.success) {
    bad(res, "Pick Going, Maybe or Can't go.");
    return;
  }
  if (row.cancelledAt) {
    bad(res, "This event was cancelled.");
    return;
  }
  if (answer.data === null) {
    await db.delete(constellationEventRsvps).where(and(eq(constellationEventRsvps.eventId, row.id), eq(constellationEventRsvps.userId, s.userId)));
  } else {
    await db
      .insert(constellationEventRsvps)
      .values({ eventId: row.id, userId: s.userId, answer: answer.data })
      .onConflictDoUpdate({ target: [constellationEventRsvps.eventId, constellationEventRsvps.userId], set: { answer: answer.data, updatedAt: new Date() } });
  }
  await eventChanged(s.constellationId, row.id);
  const [view] = await eventViews([row], s);
  res.json({ event: view });
});

// ───────────── AutoMod lite ─────────────

/** The AutoMod page: settings, the nebulas for slow mode, and what it did lately. */
async function automodPage(s: Standing) {
  const row = await automodRow(s.constellationId);
  // 0.8.0: nothing from role-only nebulas this moderator can't see (names, previews).
  const allNebulas = await nebulasOf(s.constellationId);
  const seen = await visibleChats(s.userId, allNebulas.map((n) => n.conversationId));
  const hidden = new Set(allNebulas.filter((n) => !seen.has(n.conversationId)).map((n) => n.id));
  const log = (await automodLog(s.constellationId)).filter((l) => {
    const nid = (l.entry.details as { nebulaId?: unknown } | null)?.nebulaId;
    return !(typeof nid === "string" && hidden.has(nid));
  });
  const people = await publicUsers(log.flatMap((l) => [l.entry.targetUserId, l.undone?.by].filter((x): x is string => !!x)));
  const ranks = new Map<string, Standing | null>();
  const list = [];
  for (const l of log) {
    const d = (l.entry.details ?? {}) as Record<string, unknown>;
    const target = l.entry.targetUserId;
    if (target && !ranks.has(target)) ranks.set(target, await standingOf(s.constellationId, target));
    const t = target ? ranks.get(target) : null;
    const canUndo =
      !l.undone &&
      (!t || outranks(s, t)) &&
      (l.entry.action === "automod_wait"
        ? (can(s, "timeoutKick") || can(s, "deleteMessages")) && typeof d.until === "string" && Date.parse(d.until as string) > Date.now()
        : can(s, "deleteMessages") && !!l.held && !l.held.releasedAt);
    list.push({
      id: l.entry.id,
      action: l.entry.action,
      target: target ? (people.get(target) ?? null) : null,
      details: {
        nebulaName: typeof d.nebulaName === "string" ? d.nebulaName : null,
        word: typeof d.word === "string" ? d.word : null,
        rule: typeof d.rule === "string" ? d.rule : null,
        until: typeof d.until === "string" ? d.until : null,
        preview: typeof d.preview === "string" ? d.preview : null,
        heldId: typeof d.heldId === "string" ? d.heldId : null,
      },
      createdAt: l.entry.createdAt.toISOString(),
      undone: l.undone ? { by: l.undone.by ? (people.get(l.undone.by) ?? null) : null, at: l.undone.at } : null,
      canUndo,
    });
  }
  const neb = allNebulas.filter((n) => n.kind === "text" && !hidden.has(n.id));
  return {
    settings: settingsOf(row),
    nebulas: neb.map((n) => ({ id: n.id, name: n.name })),
    log: list,
    canEdit: can(s, "manageConstellation"),
  };
}

communityToolsRouter.get("/:id/automod", async (req, res) => {
  const s = await standingFor(req, res, ["manageConstellation", "deleteMessages"]);
  if (!s) return;
  res.json(await automodPage(s));
});

const automodChanges = z
  .object({
    wordsOn: z.boolean(),
    words: z.array(z.string().max(80)).max(BLOCKED_WORDS_MAX * 2),
    linkGuardOn: z.boolean(),
    slowModeOn: z.boolean(),
    slowMode: z.record(z.string(), z.number()),
    newMemberWaitMinutes: z.number().int(),
  })
  .partial();

communityToolsRouter.put("/:id/automod", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const parsed = automodChanges.safeParse(req.body ?? {});
  if (!parsed.success) {
    bad(res, "That setting didn't work.");
    return;
  }
  const v = parsed.data;
  const current = settingsOf(await automodRow(s.constellationId));
  let words = current.words;
  if (v.words) {
    words = [];
    for (const raw of v.words) {
      const w = cleanBlockedWord(raw);
      if (!w) {
        bad(res, `"${raw.slice(0, 40)}" won't work as a blocked word (at least 2 letters, up to 40 characters).`);
        return;
      }
      if (!words.includes(w)) words.push(w);
    }
    if (words.length > BLOCKED_WORDS_MAX) {
      bad(res, `Up to ${BLOCKED_WORDS_MAX} blocked words.`);
      return;
    }
  }
  let slowMode = current.slowMode;
  if (v.slowMode) {
    const mine = new Set((await nebulasOf(s.constellationId)).map((n) => n.id));
    slowMode = {};
    for (const [nid, secs] of Object.entries(v.slowMode)) {
      if (!mine.has(nid) || !isSlowModeChoice(secs)) {
        bad(res, "Pick a slow mode from the list.");
        return;
      }
      if (secs > 0) slowMode[nid] = secs;
    }
  }
  if (v.newMemberWaitMinutes !== undefined && v.newMemberWaitMinutes !== 0 && !NEW_MEMBER_WAIT_CHOICES.includes(v.newMemberWaitMinutes)) {
    bad(res, "Pick a wait from the list.");
    return;
  }
  const next = {
    wordsOn: v.wordsOn ?? current.wordsOn,
    words,
    linkGuardOn: v.linkGuardOn ?? current.linkGuardOn,
    slowModeOn: v.slowModeOn ?? current.slowModeOn,
    slowMode,
    newMemberWaitMinutes: v.newMemberWaitMinutes ?? current.newMemberWaitMinutes,
    updatedBy: s.userId,
    updatedAt: new Date(),
  };
  await db
    .insert(constellationAutomod)
    .values({ constellationId: s.constellationId, ...next })
    .onConflictDoUpdate({ target: constellationAutomod.constellationId, set: next });
  forgetAutomod(s.constellationId);
  // What changed, for the moderation log (the words themselves aren't repeated there).
  const changed = Object.keys(v).filter((k) => JSON.stringify((current as Record<string, unknown>)[k]) !== JSON.stringify((next as Record<string, unknown>)[k]));
  if (changed.length) await logModeration(s.constellationId, s.userId, "automod_changed", null, { changed });
  res.json(await automodPage(s));
});

communityToolsRouter.post("/:id/automod/held/:hid/release", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "deleteMessages");
  if (!s) return;
  const hid = idParam.safeParse(req.params.hid);
  const [held] = hid.success
    ? await db.select().from(automodHeld).where(and(eq(automodHeld.id, hid.data), eq(automodHeld.constellationId, s.constellationId)))
    : [];
  if (!held) {
    notFound(res, "That held message isn't there any more.");
    return;
  }
  if (!(await seesNebulaChat(s.userId, held.conversationId))) {
    notFound(res, "That held message isn't there any more.");
    return;
  }
  if (held.releasedAt) {
    bad(res, "Someone already let that message through.");
    return;
  }
  const sender = await standingOf(s.constellationId, held.senderId);
  if (sender && !outranks(s, sender)) {
    bad(res, "You can only do that for people with a lower role than yours.", 403);
    return;
  }
  const chat = sender ? await access(held.conversationId, held.senderId) : null;
  if (!chat) {
    bad(res, "They're not in this constellation any more, so it can't be posted.");
    return;
  }
  // Claim it first (two moderators pressing Undo at once post it once).
  const [claimed] = await db
    .update(automodHeld)
    .set({ releasedAt: new Date(), releasedBy: s.userId })
    .where(and(eq(automodHeld.id, held.id), isNull(automodHeld.releasedAt)))
    .returning({ id: automodHeld.id });
  if (!claimed) {
    bad(res, "Someone already let that message through.");
    return;
  }
  const message = await postSpecial(chat, held.conversationId, held.senderId, { body: held.body, replyToId: held.replyToId });
  await db.update(automodHeld).set({ releasedMessageId: message.id }).where(eq(automodHeld.id, held.id));
  const [entry] = await db
    .select({ id: sql<string>`id` })
    .from(sql`constellation_audit_log`)
    .where(sql`constellation_id = ${s.constellationId} and details->>'heldId' = ${held.id}`)
    .limit(1);
  await logModeration(s.constellationId, s.userId, "automod_undo", held.senderId, { undid: entry?.id ?? null, heldId: held.id });
  res.json(await automodPage(s));
});

communityToolsRouter.post("/:id/automod/wait/:uid/waive", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, ["timeoutKick", "deleteMessages"]);
  if (!s) return;
  const uid = idParam.safeParse(req.params.uid);
  const t = uid.success ? await standingOf(s.constellationId, uid.data) : null;
  if (!t) {
    notFound(res, "They're not in this constellation.");
    return;
  }
  if (!outranks(s, t)) {
    bad(res, "You can only do that for people with a lower role than yours.", 403);
    return;
  }
  const set = settingsOf(await automodRow(s.constellationId));
  await waiveWait(s.constellationId, t.userId, Math.max(set.newMemberWaitMinutes, 1));
  const [entry] = await db
    .select({ id: sql<string>`id` })
    .from(sql`constellation_audit_log`)
    .where(sql`constellation_id = ${s.constellationId} and action = 'automod_wait' and target_user_id = ${t.userId}`)
    .orderBy(sql`created_at desc`)
    .limit(1);
  await logModeration(s.constellationId, s.userId, "automod_undo", t.userId, { undid: entry?.id ?? null });
  res.json(await automodPage(s));
});


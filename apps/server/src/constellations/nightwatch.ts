import { Router, type NextFunction, type Request, type Response } from "express";
import { and, count, countDistinct, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  APPEAL_MAX,
  APPEAL_REPLY_MAX,
  MOD_LOG_DAYS,
  MOD_LOG_FILTERS,
  MOD_LOG_KEEP_DAYS,
  MOD_REPORT_REASONS,
  TIMEOUT_LENGTHS,
  appealOpensAt,
  cleanSafety,
  type AppealStatus,
  type BanAppeal,
  type BanAppeals,
  type ConstellationPermission,
  type ModLogEntry,
  type MyBan,
  type NightWatch,
  type PublicUser,
  type QueueItem,
} from "@glofly/shared";
import { db } from "../db";
import {
  automodHeld,
  constellationAppeals,
  constellationAuditLog,
  constellationBans,
  constellationInvites,
  constellationMembers,
  constellationReports,
  constellations,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { emitToUser } from "../realtime";
import { inBackground, notifyModerators } from "../push/notify";
import { removeMessageForGood } from "../messages/routes";
import { can, OWNER_RANK, outranks, ranksOf, standingOf, type Standing } from "./perms";
import { constellationChanged, logModeration } from "./activity";
import { publicUsers } from "./views";
import { removeMember } from "./members";
import { visibleChats } from "./access";
import { forgetSafety, moderatorIds, safetyOf } from "./safety";
import { pokeNightWatch } from "./raid";
import { releaseHeld } from "./communityTools";
import { isModViewer, QUEUE_DAYS } from "./watchSummary";

// Communities round 2 (Nov 11, 2026): Night watch, the mod dashboard (approved boards 1a–1e).
//
//   GET    /constellations/:id/watch                     the dashboard: counts, queue, safety, latest log
//   GET    /constellations/:id/modlog?filter=&actor=&q=&days=&before=   the mod log (board 1b)
//   GET    /constellations/:id/modlog/export?…           the same as a spreadsheet { csv } (up to 5,000 lines)
//   POST   /constellations/:id/modlog/:eid/undo          Undo, when it's still possible for you
//   GET    /constellations/:id/safety · PUT { SafetySettings }   (Edit constellation settings)
//   POST   /constellations/:id/joins/pause { minutes } · DELETE …/joins/pause   pause / reopen joins
//   GET    /constellations/:id/raid/joiners              people held after a raid
//   POST   /constellations/:id/raid/clear { userIds? }   let them talk (all, or some)
//   POST   /constellations/:id/raid/kick { userIds }     kick them
//   POST   /constellations/:id/reports { messageId, reason }   a member reports a nebula message
//   POST   /constellations/:id/reports/:rid/assign       "Assign to me"
//   POST   /constellations/:id/reports/:rid/resolve { action: dismiss|delete|delete_timeout, length? }
//   POST   /constellations/:id/held/:hid/keep            "Keep hidden" (out of the queue for good)
//   GET    /constellations/:id/appeals?status=           (Ban people)
//   POST   /constellations/:id/appeals/:aid { decision: accept|deny, reply? }
//   GET    /constellations/bans/mine                     my bans + appeals (Constellations dashboard)
//   POST   /constellations/:id/appeal { body }           a banned person's appeal

export const nightWatchRouter = Router();
const PATHS = ["/:id/watch", "/:id/modlog", "/:id/modlog/*rest", "/:id/safety", "/:id/joins/*rest", "/:id/raid/*rest", "/:id/reports", "/:id/reports/*rest", "/:id/held/*rest", "/:id/appeals", "/:id/appeals/*rest", "/:id/appeal", "/bans/mine"];
nightWatchRouter.use(PATHS, requireAuth);
nightWatchRouter.use(PATHS, async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const changeLimiter = rateLimit("nightwatch:change", {
  windowMs: 10 * 60 * 1000,
  limit: 300,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of moderating. Wait a few minutes and try again." },
});
const reportLimiter = rateLimit("nightwatch:report", {
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of reports for one hour. Try again later." },
});
const appealLimiter = rateLimit("nightwatch:appeal", {
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Try again later." },
});
const csvLimiter = rateLimit("nightwatch:csv", {
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of exports. Try again later." },
});

const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : "invalid", message });
const NOT_HERE = "That constellation isn't available.";


async function standingFor(req: Request, res: Response, need?: ConstellationPermission | ConstellationPermission[] | "viewer"): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, NOT_HERE, 404);
    return null;
  }
  const ok =
    need === undefined ? true : need === "viewer" ? isModViewer(s) : (Array.isArray(need) ? need : [need]).some((p) => can(s, p));
  if (!ok) {
    bad(res, "Your role doesn't allow that here.", 403);
    return null;
  }
  return s;
}

/** Who did it, for the log's labels. */
function byOf(actorId: string | null, action: string, details: Record<string, unknown> | null): ModLogEntry["by"] {
  if (actorId) return "person";
  if (details?.by === "safety" || action === "joins_locked") return "safety";
  if (details?.by === "automod" || action.startsWith("automod_")) return "automod";
  return "glofly";
}


// ───────────── The dashboard ─────────────

nightWatchRouter.get("/:id/watch", async (req, res) => {
  const s = await standingFor(req, res, "viewer");
  if (!s) return;
  res.json(await nightWatchFor(s));
});

export async function nightWatchFor(s: Standing): Promise<NightWatch> {
  const cid = s.constellationId;
  const now = Date.now();
  const since = new Date(now - QUEUE_DAYS * 86_400_000);
  const weekAgo = new Date(now - 7 * 86_400_000);
  const [reports, held, appeals, [timedOut], [week], [today], [twoWeeks], [c], latestRows] = await Promise.all([
    db
      .select()
      .from(constellationReports)
      .where(and(eq(constellationReports.constellationId, cid), eq(constellationReports.status, "open")))
      .orderBy(desc(constellationReports.createdAt))
      .limit(40),
    db
      .select()
      .from(automodHeld)
      .where(and(eq(automodHeld.constellationId, cid), isNull(automodHeld.releasedAt), isNull(automodHeld.dismissedAt), gt(automodHeld.createdAt, since)))
      .orderBy(desc(automodHeld.createdAt))
      .limit(40),
    can(s, "ban")
      ? db
          .select()
          .from(constellationAppeals)
          .where(and(eq(constellationAppeals.constellationId, cid), eq(constellationAppeals.status, "open")))
          .orderBy(desc(constellationAppeals.createdAt))
          .limit(20)
      : Promise.resolve([] as (typeof constellationAppeals.$inferSelect)[]),
    db
      .select({ n: count() })
      .from(constellationMembers)
      .where(and(eq(constellationMembers.constellationId, cid), gt(constellationMembers.timedOutUntil, new Date(now)))),
    db
      .select({ n: count(), people: countDistinct(constellationAuditLog.actorId) })
      .from(constellationAuditLog)
      .where(
        and(
          eq(constellationAuditLog.constellationId, cid),
          gt(constellationAuditLog.createdAt, weekAgo),
          isNotNull(constellationAuditLog.actorId),
          inArray(constellationAuditLog.action, ["banned", "unbanned", "kicked", "timed_out", "timeout_removed", "message_deleted", "messages_deleted", "automod_undo", "automod_kept", "report_dismissed", "report_actioned", "appeal_accepted", "appeal_denied", "raid_cleared", "raid_kicked", "joins_unlocked"]),
        ),
      ),
    db
      .select({ n: count() })
      .from(constellationAuditLog)
      .where(and(eq(constellationAuditLog.constellationId, cid), eq(constellationAuditLog.action, "joined"), gt(constellationAuditLog.createdAt, new Date(now - 86_400_000)))),
    db
      .select({ n: count() })
      .from(constellationAuditLog)
      .where(and(eq(constellationAuditLog.constellationId, cid), eq(constellationAuditLog.action, "joined"), gt(constellationAuditLog.createdAt, new Date(now - 14 * 86_400_000)))),
    db.select({ pausedUntil: constellations.joinsPausedUntil, raidAt: constellations.raidAt }).from(constellations).where(eq(constellations.id, cid)),
    db
      .select()
      .from(constellationAuditLog)
      .where(and(eq(constellationAuditLog.constellationId, cid), sql`${constellationAuditLog.action} not in ('joined', 'left')`))
      .orderBy(desc(constellationAuditLog.createdAt))
      .limit(6),
  ]);
  const [heldJoiners] = await db
    .select({ n: count() })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, cid), eq(constellationMembers.raidHold, true)));

  // Only messages in nebulas I can see (role-only ones).
  const chats = [...reports.map((r) => r.conversationId), ...held.map((h) => h.conversationId)].filter((x): x is string => !!x);
  const mine = await visibleChats(s.userId, [...new Set(chats)]);
  const seenReports = reports.filter((r) => r.conversationId && mine.has(r.conversationId));
  const seenHeld = held.filter((h) => mine.has(h.conversationId));
  const nebulaRows = chats.length
    ? await db.select({ id: nebulas.id, name: nebulas.name, conversationId: nebulas.conversationId }).from(nebulas).where(inArray(nebulas.conversationId, [...new Set(chats)]))
    : [];
  const nebulaOf = (conversationId: string | null) => {
    const n = nebulaRows.find((x) => x.conversationId === conversationId);
    return n ? { id: n.id, name: n.name } : null;
  };
  const liveIds = seenReports.map((r) => r.messageId).filter((x): x is string => !!x);
  const live = liveIds.length
    ? new Set((await db.select({ id: messages.id }).from(messages).where(and(inArray(messages.id, liveIds), isNull(messages.deletedAt)))).map((m) => m.id))
    : new Set<string>();
  const people = await publicUsers([
    ...seenReports.flatMap((r) => [...r.reporterIds.slice(0, 3), r.reportedUserId, r.assignedTo]),
    ...seenHeld.map((h) => h.senderId),
    ...appeals.map((a) => a.userId),
    ...latestRows.flatMap((r) => [r.actorId, r.targetUserId]),
  ].filter((x): x is string => !!x));
  const bans = appeals.length
    ? await db
        .select()
        .from(constellationBans)
        .where(and(eq(constellationBans.constellationId, cid), inArray(constellationBans.userId, appeals.map((a) => a.userId))))
    : [];

  const queue: QueueItem[] = [
    ...seenReports.map(
      (r): QueueItem => ({
        kind: "report",
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        reason: r.reason,
        reporters: r.reporterIds.slice(0, 3).map((id) => people.get(id)).filter((u): u is PublicUser => !!u),
        reportCount: r.reporterIds.length,
        target: r.reportedUserId ? (people.get(r.reportedUserId) ?? null) : null,
        nebula: nebulaOf(r.conversationId),
        messageId: r.messageId,
        excerpt: r.excerpt,
        messageLive: !!r.messageId && live.has(r.messageId),
        assignedTo: r.assignedTo ? (people.get(r.assignedTo) ?? null) : null,
      }),
    ),
    ...seenHeld.map(
      (h): QueueItem => ({
        kind: "held",
        id: h.id,
        createdAt: h.createdAt.toISOString(),
        reason: h.reason,
        detail: h.detail,
        target: people.get(h.senderId) ?? null,
        nebula: nebulaOf(h.conversationId),
        excerpt: h.body.replace(/\s+/g, " ").slice(0, 300),
      }),
    ),
    ...appeals.flatMap((a): QueueItem[] => {
      const u = people.get(a.userId);
      const ban = bans.find((b) => b.userId === a.userId);
      return u
        ? [{ kind: "appeal", id: a.id, createdAt: a.createdAt.toISOString(), target: u, excerpt: a.body.slice(0, 300), banReason: ban?.reason ?? null, bannedAt: a.banCreatedAt.toISOString() }]
        : [];
    }),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const paused = c?.pausedUntil && c.pausedUntil.getTime() > now ? c.pausedUntil.toISOString() : null;
  return {
    counts: {
      reports: seenReports.length,
      held: seenHeld.length,
      appeals: appeals.length,
      timedOut: timedOut?.n ?? 0,
      actionsWeek: week?.n ?? 0,
      moderatorsWeek: week?.people ?? 0,
    },
    queue,
    safety: await safetyOf(cid),
    raid: { pausedUntil: paused, raidAt: c?.raidAt?.toISOString() ?? null, heldJoiners: heldJoiners?.n ?? 0 },
    joinsToday: today?.n ?? 0,
    joinsUsual: Math.round((twoWeeks?.n ?? 0) / 14),
    latest: (await redactHidden(s, latestRows)).map((r) => ({
      id: r.id,
      actor: r.actorId ? (people.get(r.actorId) ?? null) : null,
      by: byOf(r.actorId, r.action, r.details ?? null),
      action: r.action,
      target: r.targetUserId ? (people.get(r.targetUserId) ?? null) : null,
      details: r.details ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
    can: {
      delete: can(s, "deleteMessages"),
      timeout: can(s, "timeoutKick"),
      ban: can(s, "ban"),
      safety: can(s, "manageConstellation"),
    },
  };
}

// ───────────── The mod log (board 1b) ─────────────

const logQuery = z.object({
  filter: z.enum(MOD_LOG_FILTERS.map((f) => f.id) as [string, ...string[]]).catch("all"),
  actor: z.union([z.uuid(), z.enum(["automod", "safety"])]).optional().catch(undefined),
  q: z.string().max(60).optional().catch(undefined),
  days: z.coerce.number().refine((d) => MOD_LOG_DAYS.some((x) => x.d === d)).catch(30),
  before: z.iso.datetime({ offset: true }).optional().catch(undefined),
});

async function logRows(s: Standing, query: unknown, limit: number) {
  const f = logQuery.parse(query ?? {});
  const actions = MOD_LOG_FILTERS.find((x) => x.id === f.filter)?.actions ?? [];
  const L = constellationAuditLog;
  const conds = [
    eq(L.constellationId, s.constellationId),
    gt(L.createdAt, new Date(Date.now() - f.days * 86_400_000)),
    sql`${L.action} not in ('joined', 'left')`,
  ];
  if (actions.length) conds.push(inArray(L.action, [...actions]));
  if (f.before) conds.push(lt(L.createdAt, new Date(f.before)));
  if (f.actor === "automod") conds.push(and(isNull(L.actorId), or(sql`${L.action} like 'automod_%'`, sql`${L.details}->>'by' = 'automod'`))!);
  else if (f.actor === "safety") conds.push(and(isNull(L.actorId), or(eq(L.action, "joins_locked"), sql`${L.details}->>'by' = 'safety'`))!);
  else if (f.actor) conds.push(eq(L.actorId, f.actor));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const who = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(constellationMembers, and(eq(constellationMembers.userId, users.id), eq(constellationMembers.constellationId, s.constellationId)))
      .where(or(ilike(users.username, like), ilike(users.displayName, like)))
      .limit(50);
    // People who left are found by the reason only (their names aren't kept with the log).
    const ids = who.map((w) => w.id);
    conds.push(
      or(
        ...(ids.length ? [inArray(L.actorId, ids), inArray(L.targetUserId, ids)] : []),
        sql`${L.details}->>'reason' ilike ${like}`,
      )!,
    );
  }
  return redactHidden(s, await db.select().from(L).where(and(...conds)).orderBy(desc(L.createdAt)).limit(limit));
}

/**
 * Security review (Nov 11): log lines about a nebula this moderator can't see (role-only) keep
 * their action but lose their details (the held message's text, a deleted message's excerpt, the
 * nebula's name), like 0.8.0's AutoMod page.
 */
async function redactHidden<T extends { details: Record<string, unknown> | null }>(s: Standing, rows: T[]): Promise<T[]> {
  const nebulaIds = new Set<string>();
  const chatIds = new Set<string>();
  for (const r of rows) {
    const d = (r.details ?? {}) as { nebulaId?: unknown; conversationId?: unknown };
    if (typeof d.nebulaId === "string") nebulaIds.add(d.nebulaId);
    if (typeof d.conversationId === "string") chatIds.add(d.conversationId);
  }
  if (!nebulaIds.size && !chatIds.size) return rows;
  const known = nebulaIds.size
    ? await db.select({ id: nebulas.id, conversationId: nebulas.conversationId }).from(nebulas).where(inArray(nebulas.id, [...nebulaIds]))
    : [];
  const seen = await visibleChats(s.userId, [...new Set([...chatIds, ...known.map((n) => n.conversationId)])]);
  const hiddenNebula = (id: string) => {
    const n = known.find((k) => k.id === id);
    return !n || !seen.has(n.conversationId);
  };
  return rows.map((r) => {
    const d = (r.details ?? {}) as { nebulaId?: unknown; conversationId?: unknown };
    const hidden =
      (typeof d.nebulaId === "string" && hiddenNebula(d.nebulaId)) || (typeof d.conversationId === "string" && !seen.has(d.conversationId));
    return hidden ? { ...r, details: { hidden: true } } : r;
  });
}

nightWatchRouter.get("/:id/modlog", async (req, res) => {
  const s = await standingFor(req, res, "viewer");
  if (!s) return;
  const rows = await logRows(s, req.query, 51);
  const page = rows.slice(0, 50);
  res.json({ entries: await entriesFor(s, page), hasMore: rows.length > 50 });
});

async function entriesFor(s: Standing, rows: (typeof constellationAuditLog.$inferSelect)[]): Promise<ModLogEntry[]> {
  const people = await publicUsers(rows.flatMap((r) => [r.actorId, r.targetUserId].filter((x): x is string => !!x)));
  const undo = await undoable(s, rows);
  return rows.map((r) => ({
    id: r.id,
    actor: r.actorId ? (people.get(r.actorId) ?? null) : null,
    by: byOf(r.actorId, r.action, r.details ?? null),
    action: r.action,
    target: r.targetUserId ? (people.get(r.targetUserId) ?? null) : null,
    details: r.details ?? null,
    createdAt: r.createdAt.toISOString(),
    canUndo: undo.has(r.id),
  }));
}

const HELD_ACTIONS = ["automod_hidden", "automod_links", "automod_mentions", "automod_raid"];

/** Which of these log lines I could still undo. */
async function undoable(s: Standing, rows: (typeof constellationAuditLog.$inferSelect)[]): Promise<Set<string>> {
  const out = new Set<string>();
  const now = Date.now();
  const targets = [...new Set(rows.map((r) => r.targetUserId).filter((x): x is string => !!x))];
  if (!targets.length && !rows.some((r) => r.action === "joins_locked")) return out;
  const [members, bans, ranks, heldRows, [c]] = await Promise.all([
    targets.length
      ? db
          .select({ userId: constellationMembers.userId, timedOutUntil: constellationMembers.timedOutUntil })
          .from(constellationMembers)
          .where(and(eq(constellationMembers.constellationId, s.constellationId), inArray(constellationMembers.userId, targets)))
      : [],
    targets.length
      ? db.select().from(constellationBans).where(and(eq(constellationBans.constellationId, s.constellationId), inArray(constellationBans.userId, targets)))
      : [],
    ranksOf(s.constellationId, targets),
    (() => {
      const ids = rows.filter((r) => HELD_ACTIONS.includes(r.action)).map((r) => (r.details as { heldId?: string } | null)?.heldId).filter((x): x is string => !!x);
      return ids.length ? db.select().from(automodHeld).where(inArray(automodHeld.id, ids)) : Promise.resolve([] as (typeof automodHeld.$inferSelect)[]);
    })(),
    db.select({ ownerId: constellations.ownerId, until: constellations.joinsPausedUntil }).from(constellations).where(eq(constellations.id, s.constellationId)),
  ]);
  const rankOf = (id: string) => (id === c?.ownerId ? OWNER_RANK : (ranks.get(id) ?? 0));
  const below = (id: string) => id !== s.userId && id !== c?.ownerId && (s.owner || rankOf(id) < s.rank);
  const seen = await visibleChats(s.userId, [...new Set(heldRows.map((h) => h.conversationId))]);
  for (const r of rows) {
    const t = r.targetUserId;
    if (r.action === "timed_out" && t && can(s, "timeoutKick") && below(t)) {
      const m = members.find((x) => x.userId === t);
      if (m?.timedOutUntil && m.timedOutUntil.getTime() > now) out.add(r.id);
    } else if (r.action === "banned" && t && can(s, "ban")) {
      const ban = bans.find((b) => b.userId === t);
      if (ban && ban.createdAt.getTime() <= r.createdAt.getTime() + 5000 && (await maySeeBanLifted(s, ban.bannedBy))) out.add(r.id);
    } else if (HELD_ACTIONS.includes(r.action) && can(s, "deleteMessages")) {
      const h = heldRows.find((x) => x.id === (r.details as { heldId?: string } | null)?.heldId);
      if (h && !h.releasedAt && !h.dismissedAt && seen.has(h.conversationId) && (!t || below(t) || !members.some((m) => m.userId === t))) out.add(r.id);
    } else if (r.action === "joins_locked" && (can(s, "manageConstellation") || can(s, "ban")) && c?.until && c.until.getTime() > now) {
      out.add(r.id);
    }
  }
  return out;
}

/** 0.7.3's rule: a ban by someone ranked at or above you stays (only they, or higher, can lift it). */
async function maySeeBanLifted(s: Standing, bannedBy: string | null): Promise<boolean> {
  if (!bannedBy || bannedBy === s.userId || s.owner) return true;
  const rank = bannedBy === s.ownerId ? OWNER_RANK : ((await ranksOf(s.constellationId, [bannedBy])).get(bannedBy) ?? -1);
  return rank < s.rank;
}

nightWatchRouter.post("/:id/modlog/:eid/undo", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "viewer");
  if (!s) return;
  const eid = idParam.safeParse(req.params.eid);
  const [row] = eid.success
    ? await db.select().from(constellationAuditLog).where(and(eq(constellationAuditLog.id, eid.data), eq(constellationAuditLog.constellationId, s.constellationId)))
    : [];
  if (!row || !(await undoable(s, [row])).has(row.id)) {
    bad(res, "That can't be undone any more.");
    return;
  }
  const t = row.targetUserId;
  if (row.action === "timed_out" && t) {
    await db
      .update(constellationMembers)
      .set({ timedOutUntil: null })
      .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.userId, t)));
    await logModeration(s.constellationId, s.userId, "timeout_removed", t, { undid: row.id });
    await constellationChanged(s.constellationId);
  } else if (row.action === "banned" && t) {
    await liftBan(s, t, { undid: row.id });
  } else if (HELD_ACTIONS.includes(row.action)) {
    const problem = await releaseHeld(s, (row.details as { heldId: string }).heldId);
    if (problem) {
      bad(res, problem.message, problem.status);
      return;
    }
    pokeNightWatch(s.constellationId);
  } else if (row.action === "joins_locked") {
    await reopenJoins(s, { undid: row.id });
  }
  const [entry] = await entriesFor(s, [row]);
  res.json({ entry });
});

/** Unbans (the ban's row goes) and invites them back, so it's on their dashboard. */
async function liftBan(s: Standing, userId: string, details: Record<string, unknown> | null, invite = false): Promise<void> {
  await db.delete(constellationBans).where(and(eq(constellationBans.constellationId, s.constellationId), eq(constellationBans.userId, userId)));
  await db
    .update(constellationAppeals)
    .set({ status: "denied", decidedAt: new Date(), decidedBy: s.userId })
    .where(and(eq(constellationAppeals.constellationId, s.constellationId), eq(constellationAppeals.userId, userId), eq(constellationAppeals.status, "open")));
  await logModeration(s.constellationId, s.userId, "unbanned", userId, details);
  if (invite && !(await isRestricted(userId))) {
    await db
      .insert(constellationInvites)
      .values({ constellationId: s.constellationId, inviterId: s.userId, inviteeId: userId })
      .onConflictDoUpdate({
        target: [constellationInvites.constellationId, constellationInvites.inviteeId],
        set: { inviterId: s.userId, createdAt: new Date(), dismissedAt: null },
      });
  }
  emitToUser(userId, "constellations:changed", {}, true);
}

/** Opens joins again (raid protection, or a moderator's pause). */
async function reopenJoins(s: Standing, details: Record<string, unknown> | null = null): Promise<void> {
  await db.update(constellations).set({ joinsPausedUntil: null }).where(eq(constellations.id, s.constellationId));
  await logModeration(s.constellationId, s.userId, "joins_unlocked", null, details);
  await constellationChanged(s.constellationId);
}

/** Text in a spreadsheet cell, never a formula. */
function csvCell(v: unknown): string {
  let t = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// GET /constellations/:id/modlog/export?… — { csv } (JSON, so it passes the apps' request gateways).
nightWatchRouter.get("/:id/modlog/export", csvLimiter, async (req, res) => {
  const s = await standingFor(req, res, "viewer");
  if (!s) return;
  const rows = await logRows(s, req.query, 5000);
  const people = await publicUsers(rows.flatMap((r) => [r.actorId, r.targetUserId].filter((x): x is string => !!x)));
  const name = (id: string | null) => (id ? (people.get(id)?.username ?? "(left)") : "");
  const lines = [["time", "by", "action", "member", "reason", "details"].join(",")];
  for (const r of rows) {
    const d = r.details ?? {};
    const by = r.actorId ? `@${name(r.actorId)}` : byOf(r.actorId, r.action, d);
    const { reason, ...rest } = d as { reason?: unknown };
    lines.push([r.createdAt.toISOString(), by, r.action, r.targetUserId ? `@${name(r.targetUserId)}` : "", reason ?? "", Object.keys(rest).length ? JSON.stringify(rest) : ""].map(csvCell).join(","));
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ csv: lines.join("\r\n") + "\r\n", lines: rows.length });
});

// ───────────── Safety (board 1d) ─────────────

nightWatchRouter.get("/:id/safety", async (req, res) => {
  const s = await standingFor(req, res, "viewer");
  if (!s) return;
  res.json({ safety: await safetyOf(s.constellationId), canChange: can(s, "manageConstellation") });
});

nightWatchRouter.put("/:id/safety", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "manageConstellation");
  if (!s) return;
  const before = await safetyOf(s.constellationId);
  const next = cleanSafety({ ...before, ...(req.body && typeof req.body === "object" ? req.body : {}) });
  await db.update(constellations).set({ safety: next }).where(eq(constellations.id, s.constellationId));
  forgetSafety(s.constellationId);
  const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(next[k]));
  if (changed.length) {
    await logModeration(s.constellationId, s.userId, "safety_changed", null, {
      changed,
      ...(changed.includes("verification") ? { verification: `${before.verification} → ${next.verification}` } : {}),
    });
    await constellationChanged(s.constellationId);
  }
  res.json({ safety: next, canChange: true });
});

nightWatchRouter.post("/:id/joins/pause", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, ["manageConstellation", "ban"]);
  if (!s) return;
  const minutes = z.coerce.number().int().refine((m) => [10, 30, 60, 360].includes(m)).safeParse(req.body?.minutes);
  if (!minutes.success) {
    bad(res, "Pick how long.");
    return;
  }
  const until = new Date(Date.now() + minutes.data * 60_000);
  await db.update(constellations).set({ joinsPausedUntil: until }).where(eq(constellations.id, s.constellationId));
  await logModeration(s.constellationId, s.userId, "joins_locked", null, { minutes: minutes.data, until: until.toISOString() });
  await constellationChanged(s.constellationId);
  res.json({ pausedUntil: until.toISOString() });
});

nightWatchRouter.delete("/:id/joins/pause", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, ["manageConstellation", "ban"]);
  if (!s) return;
  await reopenJoins(s);
  res.json({ pausedUntil: null });
});

nightWatchRouter.get("/:id/raid/joiners", async (req, res) => {
  const s = await standingFor(req, res, "timeoutKick");
  if (!s) return;
  const rows = await db
    .select({ userId: constellationMembers.userId, joinedAt: constellationMembers.joinedAt, createdAt: users.createdAt })
    .from(constellationMembers)
    .innerJoin(users, eq(users.id, constellationMembers.userId))
    .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.raidHold, true)))
    .orderBy(desc(constellationMembers.joinedAt))
    .limit(200);
  const people = await publicUsers(rows.map((r) => r.userId));
  res.json({
    joiners: rows.flatMap((r) => {
      const u = people.get(r.userId);
      return u ? [{ user: u, joinedAt: r.joinedAt.toISOString(), accountCreatedAt: r.createdAt.toISOString() }] : [];
    }),
  });
});

const someIds = z.object({ userIds: z.array(z.uuid()).min(1).max(200).optional() });

nightWatchRouter.post("/:id/raid/clear", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "timeoutKick");
  if (!s) return;
  const p = someIds.safeParse(req.body ?? {});
  if (!p.success) {
    bad(res, "Pick who to let talk.");
    return;
  }
  const cleared = await db
    .update(constellationMembers)
    .set({ raidHold: false })
    .where(
      and(
        eq(constellationMembers.constellationId, s.constellationId),
        eq(constellationMembers.raidHold, true),
        p.data.userIds ? inArray(constellationMembers.userId, p.data.userIds) : undefined,
      ),
    )
    .returning({ userId: constellationMembers.userId });
  if (cleared.length) await logModeration(s.constellationId, s.userId, "raid_cleared", cleared.length === 1 ? cleared[0].userId : null, { count: cleared.length });
  pokeNightWatch(s.constellationId);
  res.json({ cleared: cleared.length });
});

nightWatchRouter.post("/:id/raid/kick", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "timeoutKick");
  if (!s) return;
  const p = someIds.safeParse(req.body ?? {});
  if (!p.success || !p.data.userIds) {
    bad(res, "Pick who to kick.");
    return;
  }
  const held = await db
    .select({ userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.raidHold, true), inArray(constellationMembers.userId, p.data.userIds)));
  let kicked = 0;
  for (const h of held) {
    const t = await standingOf(s.constellationId, h.userId);
    if (!t || !outranks(s, t)) continue;
    if (await removeMember(s.constellationId, h.userId)) {
      emitToUser(h.userId, "constellation:removed", { constellationId: s.constellationId, reason: "kicked" }, true);
      kicked++;
    }
  }
  if (kicked) {
    await logModeration(s.constellationId, s.userId, "raid_kicked", null, { count: kicked, reason: "Joined during a raid" });
    await constellationChanged(s.constellationId);
  }
  pokeNightWatch(s.constellationId);
  res.json({ kicked });
});

// ───────────── Reports ─────────────

/**
 * A nebula message reported (the app's Report, or POST /reports from older apps): one open report
 * per message, more reporters add to it. Moderators who can see the nebula get it in Night watch.
 */
export async function fileNebulaReport(
  constellationId: string,
  conversationId: string,
  message: { id: string; senderId: string; body: string },
  reporterId: string,
  reason: string,
): Promise<void> {
  const r = MOD_REPORT_REASONS.some((x) => x.id === reason) ? reason : "other";
  const excerpt = message.body.replace(/\s+/g, " ").slice(0, 500) || "(a photo or file)";
  await db
    .insert(constellationReports)
    .values({ constellationId, conversationId, messageId: message.id, reportedUserId: message.senderId, reporterIds: [reporterId], reason: r, excerpt })
    .onConflictDoUpdate({
      target: constellationReports.messageId,
      targetWhere: sql`${constellationReports.status} = 'open'`,
      set: { reporterIds: sql`(select array_agg(distinct x) from unnest(${constellationReports.reporterIds} || array[${reporterId}::uuid]) x)` },
    });
  pokeNightWatch(constellationId);
}

nightWatchRouter.post("/:id/reports", reportLimiter, async (req, res) => {
  const s = await standingFor(req, res);
  if (!s) return;
  const p = z.object({ messageId: z.uuid(), reason: z.string().max(20) }).safeParse(req.body ?? {});
  if (!p.success) {
    bad(res, "Pick what's wrong.");
    return;
  }
  const [m] = await db
    .select({ id: messages.id, senderId: messages.senderId, body: messages.body, conversationId: messages.conversationId, deletedAt: messages.deletedAt, event: messages.event })
    .from(messages)
    .innerJoin(nebulas, eq(nebulas.conversationId, messages.conversationId))
    .where(and(eq(messages.id, p.data.messageId), eq(nebulas.constellationId, s.constellationId)));
  if (!m || m.deletedAt || m.event || !(await visibleChats(s.userId, [m.conversationId])).has(m.conversationId)) {
    bad(res, "That message isn't available any more.", 404);
    return;
  }
  if (m.senderId === s.userId) {
    bad(res, "You can't report your own message.");
    return;
  }
  await fileNebulaReport(s.constellationId, m.conversationId, m, s.userId, p.data.reason);
  res.json({ ok: true });
});

async function reportFor(req: Request, res: Response, s: Standing) {
  const rid = idParam.safeParse(req.params.rid);
  const [r] = rid.success
    ? await db.select().from(constellationReports).where(and(eq(constellationReports.id, rid.data), eq(constellationReports.constellationId, s.constellationId)))
    : [];
  if (!r || !r.conversationId || !(await visibleChats(s.userId, [r.conversationId])).has(r.conversationId)) {
    bad(res, "That report isn't there any more.", 404);
    return null;
  }
  if (r.status !== "open") {
    bad(res, "Someone already took care of that report.");
    return null;
  }
  return r;
}

nightWatchRouter.post("/:id/reports/:rid/assign", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, ["deleteMessages", "timeoutKick", "ban"]);
  if (!s) return;
  const r = await reportFor(req, res, s);
  if (!r) return;
  await db.update(constellationReports).set({ assignedTo: s.userId }).where(eq(constellationReports.id, r.id));
  pokeNightWatch(s.constellationId);
  res.json(await nightWatchFor(s));
});

nightWatchRouter.post("/:id/reports/:rid/resolve", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, ["deleteMessages", "timeoutKick", "ban"]);
  if (!s) return;
  const r = await reportFor(req, res, s);
  if (!r) return;
  const p = z.object({ action: z.enum(["dismiss", "delete", "delete_timeout"]), length: z.string().optional() }).safeParse(req.body ?? {});
  if (!p.success) {
    bad(res, "Pick what to do.");
    return;
  }
  const action = p.data.action;
  const target = r.reportedUserId ? await standingOf(s.constellationId, r.reportedUserId) : null;
  if (action !== "dismiss") {
    if (!can(s, "deleteMessages")) {
      bad(res, "Your role doesn't allow deleting messages here.", 403);
      return;
    }
    if (target && !outranks(s, target)) {
      bad(res, "You can only do that to people with a lower role than yours.", 403);
      return;
    }
  }
  const length = action === "delete_timeout" ? TIMEOUT_LENGTHS.find((l) => l.id === p.data.length) : null;
  if (action === "delete_timeout") {
    if (!can(s, "timeoutKick")) {
      bad(res, "Your role doesn't allow time-outs here.", 403);
      return;
    }
    if (!length) {
      bad(res, "Pick how long.");
      return;
    }
  }
  // Claim it (two moderators at once decide once).
  const [claimed] = await db
    .update(constellationReports)
    .set({ status: action === "dismiss" ? "dismissed" : "actioned", outcome: action, resolvedBy: s.userId, resolvedAt: new Date() })
    .where(and(eq(constellationReports.id, r.id), eq(constellationReports.status, "open")))
    .returning({ id: constellationReports.id });
  if (!claimed) {
    bad(res, "Someone already took care of that report.");
    return;
  }
  if (action !== "dismiss" && r.messageId) {
    const [m] = await db.select({ body: messages.body, deletedAt: messages.deletedAt }).from(messages).where(eq(messages.id, r.messageId));
    if (m && !m.deletedAt && (await removeMessageForGood(r.messageId)))
      await logModeration(s.constellationId, s.userId, "message_deleted", r.reportedUserId, { excerpt: m.body.slice(0, 120), conversationId: r.conversationId, report: r.id });
  }
  if (length && target) {
    await db
      .update(constellationMembers)
      .set({ timedOutUntil: new Date(Date.now() + length.ms) })
      .where(and(eq(constellationMembers.constellationId, s.constellationId), eq(constellationMembers.userId, target.userId)));
    await logModeration(s.constellationId, s.userId, "timed_out", target.userId, { length: length.name, reason: `Reported: ${r.reason}` });
    await constellationChanged(s.constellationId);
  }
  await logModeration(s.constellationId, s.userId, action === "dismiss" ? "report_dismissed" : "report_actioned", r.reportedUserId, {
    reason: r.reason,
    reporters: r.reporterIds.length,
  });
  pokeNightWatch(s.constellationId);
  res.json(await nightWatchFor(s));
});

/** After a ban: their open reports are done (outcome "banned"). */
export async function closeReportsOnBan(constellationId: string, userId: string, by: string): Promise<void> {
  await db
    .update(constellationReports)
    .set({ status: "actioned", outcome: "banned", resolvedBy: by, resolvedAt: new Date() })
    .where(and(eq(constellationReports.constellationId, constellationId), eq(constellationReports.reportedUserId, userId), eq(constellationReports.status, "open")));
  pokeNightWatch(constellationId);
}

nightWatchRouter.post("/:id/held/:hid/keep", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "deleteMessages");
  if (!s) return;
  const hid = idParam.safeParse(req.params.hid);
  const [h] = hid.success ? await db.select().from(automodHeld).where(and(eq(automodHeld.id, hid.data), eq(automodHeld.constellationId, s.constellationId))) : [];
  if (!h || !(await visibleChats(s.userId, [h.conversationId])).has(h.conversationId)) {
    bad(res, "That held message isn't there any more.", 404);
    return;
  }
  const [done] = await db
    .update(automodHeld)
    .set({ dismissedAt: new Date(), dismissedBy: s.userId })
    .where(and(eq(automodHeld.id, h.id), isNull(automodHeld.releasedAt), isNull(automodHeld.dismissedAt)))
    .returning({ id: automodHeld.id });
  if (!done) {
    bad(res, "Someone already decided about that message.");
    return;
  }
  await logModeration(s.constellationId, s.userId, "automod_kept", h.senderId, { heldId: h.id, reason: h.reason });
  pokeNightWatch(s.constellationId);
  res.json(await nightWatchFor(s));
});

// ───────────── Bans + appeals (board 1c) ─────────────

/** Bans: delete their recent messages (the ban dialog's "Delete their messages from"). */
export async function deleteRecentMessages(constellationId: string, userId: string, sinceMs: number): Promise<number> {
  if (sinceMs <= 0) return 0;
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(nebulas, eq(nebulas.conversationId, messages.conversationId))
    .where(
      and(
        eq(nebulas.constellationId, constellationId),
        eq(messages.senderId, userId),
        isNull(messages.deletedAt),
        isNull(messages.event),
        gte(messages.createdAt, new Date(Date.now() - sinceMs)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1000);
  let n = 0;
  for (const r of rows) if (await removeMessageForGood(r.id)) n++;
  return n;
}

nightWatchRouter.get("/bans/mine", async (_req, res) => {
  const myId = me(res).id;
  const rows = await db
    .select({ ban: constellationBans, c: { id: constellations.id, name: constellations.name, color: constellations.color, iconVersion: constellations.iconVersion } })
    .from(constellationBans)
    .innerJoin(constellations, eq(constellations.id, constellationBans.constellationId))
    .where(and(eq(constellationBans.userId, myId), isNull(constellations.takenDownAt)))
    .orderBy(desc(constellationBans.createdAt))
    .limit(50);
  const appeals = rows.length
    ? await db
        .select()
        .from(constellationAppeals)
        .where(and(eq(constellationAppeals.userId, myId), inArray(constellationAppeals.constellationId, rows.map((r) => r.c.id))))
        .orderBy(desc(constellationAppeals.createdAt))
    : [];
  const bans: MyBan[] = rows.map(({ ban, c }) => {
    const mine = appeals.filter((a) => a.constellationId === c.id && a.banCreatedAt.getTime() === ban.createdAt.getTime());
    const last = mine[0] ?? null;
    const lastDenied = mine.find((a) => a.status === "denied")?.decidedAt?.getTime() ?? null;
    const opens = last?.status === "open" ? null : appealOpensAt(ban.appeals as BanAppeals, ban.createdAt.getTime(), lastDenied);
    return {
      constellation: c,
      reason: ban.reason,
      createdAt: ban.createdAt.toISOString(),
      appeals: ban.appeals as BanAppeals,
      appealFrom: opens === null ? null : new Date(opens).toISOString(),
      appeal: last ? { status: last.status as AppealStatus, createdAt: last.createdAt.toISOString(), reply: last.reply } : null,
    };
  });
  res.json({ bans });
});

nightWatchRouter.post("/:id/appeal", appealLimiter, async (req, res) => {
  const myId = me(res).id;
  const id = idParam.safeParse(req.params.id);
  const body = z.string().transform((t) => t.replace(/\r\n/g, "\n").trim()).pipe(z.string().min(1, "Write a few words.").max(APPEAL_MAX, `Up to ${APPEAL_MAX} characters.`)).safeParse(req.body?.body);
  if (!id.success) {
    bad(res, NOT_HERE, 404);
    return;
  }
  if (!body.success) {
    bad(res, body.error.issues[0]?.message ?? "Write a few words.");
    return;
  }
  const [ban] = await db
    .select({ ban: constellationBans, name: constellations.name, ownerId: constellations.ownerId, takenDownAt: constellations.takenDownAt })
    .from(constellationBans)
    .innerJoin(constellations, eq(constellations.id, constellationBans.constellationId))
    .where(and(eq(constellationBans.constellationId, id.data), eq(constellationBans.userId, myId)));
  if (!ban || ban.takenDownAt) {
    bad(res, "You're not banned there.", 404);
    return;
  }
  const mine = await db
    .select()
    .from(constellationAppeals)
    .where(and(eq(constellationAppeals.constellationId, id.data), eq(constellationAppeals.userId, myId), eq(constellationAppeals.banCreatedAt, ban.ban.createdAt)))
    .orderBy(desc(constellationAppeals.createdAt));
  if (mine.some((a) => a.status === "open")) {
    bad(res, "Your appeal is already with the moderators.", 409);
    return;
  }
  const lastDenied = mine.find((a) => a.status === "denied")?.decidedAt?.getTime() ?? null;
  const opens = appealOpensAt(ban.ban.appeals as BanAppeals, ban.ban.createdAt.getTime(), lastDenied);
  if (opens === null) {
    bad(res, "This ban can't be appealed.", 403);
    return;
  }
  if (opens > Date.now()) {
    bad(res, `You can appeal from ${new Date(opens).toDateString()}.`, 403);
    return;
  }
  await db.insert(constellationAppeals).values({ constellationId: id.data, userId: myId, banCreatedAt: ban.ban.createdAt, body: body.data });
  pokeNightWatch(id.data);
  const mods = await moderatorIds(id.data);
  const [u] = await db.select({ displayName: users.displayName }).from(users).where(eq(users.id, myId));
  inBackground(notifyModerators(mods, { id: id.data, name: ban.name, ownerId: ban.ownerId }, `${u?.displayName ?? "Someone"} appealed their ban.`));
  res.status(201).json({ ok: true });
});

nightWatchRouter.get("/:id/appeals", async (req, res) => {
  const s = await standingFor(req, res, "ban");
  if (!s) return;
  const status = z.enum(["open", "accepted", "denied", "all"]).catch("open").parse(req.query.status);
  const rows = await db
    .select()
    .from(constellationAppeals)
    .where(and(eq(constellationAppeals.constellationId, s.constellationId), status === "all" ? undefined : eq(constellationAppeals.status, status)))
    .orderBy(desc(constellationAppeals.createdAt))
    .limit(100);
  res.json({ appeals: await appealsOut(s, rows) });
});

async function appealsOut(s: Standing, rows: (typeof constellationAppeals.$inferSelect)[]): Promise<BanAppeal[]> {
  if (!rows.length) return [];
  const userIds = [...new Set(rows.map((r) => r.userId))];
  const bans = await db.select().from(constellationBans).where(and(eq(constellationBans.constellationId, s.constellationId), inArray(constellationBans.userId, userIds)));
  const people = await publicUsers([...userIds, ...bans.map((b) => b.bannedBy), ...rows.map((r) => r.decidedBy)].filter((x): x is string => !!x));
  const counts = await db
    .select({ userId: constellationAuditLog.targetUserId, action: constellationAuditLog.action, n: count() })
    .from(constellationAuditLog)
    .where(
      and(
        eq(constellationAuditLog.constellationId, s.constellationId),
        inArray(constellationAuditLog.targetUserId, userIds),
        inArray(constellationAuditLog.action, ["timed_out", "message_deleted", "automod_hidden", "automod_links", "automod_mentions"]),
      ),
    )
    .groupBy(constellationAuditLog.targetUserId, constellationAuditLog.action);
  const earlier = await db
    .select({ userId: constellationAppeals.userId, banCreatedAt: constellationAppeals.banCreatedAt, createdAt: constellationAppeals.createdAt })
    .from(constellationAppeals)
    .where(and(eq(constellationAppeals.constellationId, s.constellationId), inArray(constellationAppeals.userId, userIds)));
  return rows.flatMap((r): BanAppeal[] => {
    const u = people.get(r.userId);
    if (!u) return [];
    const ban = bans.find((b) => b.userId === r.userId && b.createdAt.getTime() === r.banCreatedAt.getTime());
    const c = (a: string[]) => counts.filter((x) => x.userId === r.userId && a.includes(x.action)).reduce((t, x) => t + x.n, 0);
    return [
      {
        id: r.id,
        user: u,
        body: r.body,
        status: r.status as BanAppeal["status"],
        createdAt: r.createdAt.toISOString(),
        ban: { reason: ban?.reason ?? null, createdAt: r.banCreatedAt.toISOString(), by: ban?.bannedBy ? (people.get(ban.bannedBy) ?? null) : null },
        number: earlier.filter((e) => e.userId === r.userId && e.banCreatedAt.getTime() === r.banCreatedAt.getTime() && e.createdAt.getTime() <= r.createdAt.getTime()).length,
        history: { timeouts: c(["timed_out"]), deleted: c(["message_deleted"]), held: c(["automod_hidden", "automod_links", "automod_mentions"]) },
        decidedBy: r.decidedBy ? (people.get(r.decidedBy) ?? null) : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        reply: r.reply,
      },
    ];
  });
}

nightWatchRouter.post("/:id/appeals/:aid", changeLimiter, async (req, res) => {
  const s = await standingFor(req, res, "ban");
  if (!s) return;
  const aid = idParam.safeParse(req.params.aid);
  const p = z
    .object({
      decision: z.enum(["accept", "deny"]),
      reply: z.string().max(APPEAL_REPLY_MAX, `Up to ${APPEAL_REPLY_MAX} characters.`).nullable().optional(),
    })
    .safeParse(req.body ?? {});
  if (!aid.success || !p.success) {
    bad(res, p.success ? "That appeal isn't there any more." : (p.error.issues[0]?.message ?? "Pick what to do."), p.success ? 404 : 400);
    return;
  }
  const [a] = await db.select().from(constellationAppeals).where(and(eq(constellationAppeals.id, aid.data), eq(constellationAppeals.constellationId, s.constellationId)));
  if (!a) {
    bad(res, "That appeal isn't there any more.", 404);
    return;
  }
  const [ban] = await db.select().from(constellationBans).where(and(eq(constellationBans.constellationId, s.constellationId), eq(constellationBans.userId, a.userId)));
  if (p.data.decision === "accept" && ban && !(await maySeeBanLifted(s, ban.bannedBy))) {
    bad(res, "Someone ranked at or above you banned them, so only they (or someone higher) can unban.", 403);
    return;
  }
  const reply = p.data.reply?.trim() || null;
  const [claimed] = await db
    .update(constellationAppeals)
    .set({ status: p.data.decision === "accept" ? "accepted" : "denied", reply, decidedBy: s.userId, decidedAt: new Date() })
    .where(and(eq(constellationAppeals.id, a.id), eq(constellationAppeals.status, "open")))
    .returning({ id: constellationAppeals.id });
  if (!claimed) {
    bad(res, "Someone already decided about that appeal.");
    return;
  }
  if (p.data.decision === "accept") {
    if (ban && ban.createdAt.getTime() === a.banCreatedAt.getTime()) await liftBan(s, a.userId, { appeal: a.id }, true);
    await logModeration(s.constellationId, s.userId, "appeal_accepted", a.userId, reply ? { reply } : null);
  } else {
    await logModeration(s.constellationId, s.userId, "appeal_denied", a.userId, reply ? { reply } : null);
  }
  emitToUser(a.userId, "constellation:appeal", { constellationId: s.constellationId, decision: p.data.decision }, true);
  emitToUser(a.userId, "constellations:changed", {}, true);
  pokeNightWatch(s.constellationId);
  const [out] = await appealsOut(s, [{ ...a, status: p.data.decision === "accept" ? "accepted" : "denied", reply, decidedBy: s.userId, decidedAt: new Date() }]);
  res.json({ appeal: out ?? null });
});

// ───────────── Keeping it tidy ─────────────

/** The mod log and finished reports/appeals keep 180 days (hourly sweep). */
export async function purgeOldModeration(): Promise<void> {
  const cutoff = new Date(Date.now() - MOD_LOG_KEEP_DAYS * 86_400_000);
  await db.delete(constellationAuditLog).where(lt(constellationAuditLog.createdAt, cutoff));
  await db.delete(constellationReports).where(and(ne(constellationReports.status, "open"), lt(constellationReports.createdAt, cutoff)));
  await db.delete(constellationAppeals).where(and(ne(constellationAppeals.status, "open"), lt(constellationAppeals.createdAt, cutoff)));
  await db.delete(automodHeld).where(lt(automodHeld.createdAt, cutoff));
  // Joins reopen on their own when the pause runs out; the raid's holds stay until a moderator looks.
  await db.update(constellations).set({ joinsPausedUntil: null }).where(lt(constellations.joinsPausedUntil, new Date()));
}

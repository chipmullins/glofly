import { Router, type Response } from "express";
import { setBudget, usageReport } from "./usage";
import { and, count, desc, eq, gt, isNotNull, isNull, lt, or, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  accountInvites,
  adminAuditLog,
  admins,
  attachments,
  calls,
  conversationMembers,
  conversations,
  friendships,
  inviteCodes,
  inviteCodeUses,
  messages,
  reports,
  sessions,
  signupMode,
  users,
  teamReplies,
  adminAlerts,
  constellationMembers,
} from "../db/schema";
import { getLockdown } from "./lockdown";
import { redis } from "../redis";
import { connectedSessionIds, connectedSummary, disconnectSessions, emitToUser } from "../realtime";
import { announcePresence, liveStatusText } from "../presence";
import { endCallsFor } from "../calls/service";
import { livekitConfigured } from "../calls/livekit";
import { emailKind, failedKey } from "../email/send";
import { failedPushesToday, pushConfigured } from "../push/fcm";
import { pendingEmailFor } from "../email/tokens";
import { displayNameSchema, emailSchema, fieldErrors, usernameSchema } from "../auth/validation";
import { adminChangeEmail, adminResendVerification, adminSendPasswordReset } from "../account/email";
import { cancelDeletion, deleteNow } from "../account/deletion";
import { profileChanged } from "../profile/routes";
import { storageKind } from "../storage";
import { getMinVersion } from "../app-version";
import { logAction, noteSchema } from "./audit";
import type { AdminLocals } from "./auth";
import {
  cancelInvite,
  createInvite,
  emailTaken,
  INVITE_DAYS,
  inviteStatus,
  openInvites,
  resendInvite,
  usernameTaken,
} from "./invites";
import { getSignupMode, newInviteCode, setSignupMode } from "./signups";

// Glofly Control's API. Everything here is behind the network check and an admin session
// (see admin/index.ts). Every action needs a note and is written to the audit log.
// Control never reads message contents: only counts and account details.

export const adminRouter = Router();

export const admin = (res: Response): AdminLocals => res.locals.admin as AdminLocals;
export const ip = (res: Response): string => res.locals.adminIp as string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Body problems → 400 with a message per field (the note included). */
export function invalid(res: Response, error: z.ZodError): void {
  const fields = fieldErrors(error);
  res.status(400).json({ error: "invalid", fields, message: Object.values(fields)[0] });
}

const EMAIL_FAILED = {
  error: "email_failed",
  message: "Amazon didn't accept the email. Nothing was changed. Try again in a few minutes.",
};

// ───────────── Dashboard ─────────────

/** A real IANA time zone (for "today"), or New York. */
function timeZone(value: unknown): string {
  if (typeof value === "string" && value.length <= 64 && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(value)) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return value;
    } catch {
      // fall through
    }
  }
  return "America/New_York";
}

// Usage & costs (Oct 27, 2026): this month's calls, data sent, phone users and stored files, with an
// estimated bill (admin/usage.ts).
adminRouter.get("/usage", async (_req, res) => {
  res.json(await usageReport());
});

// PUT /admin/usage/budget { monthly: number | null } — the monthly budget the cost alerts watch.
adminRouter.put("/usage/budget", async (req, res) => {
  const parsed = z.object({ monthly: z.number().positive().max(100_000).nullable() }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  await setBudget(parsed.data.monthly === null ? null : Math.round(parsed.data.monthly * 100) / 100);
  res.json(await usageReport());
});

adminRouter.get("/dashboard", async (req, res) => {
  const tz = timeZone(req.query.tz);
  const dayStart = (daysAgo: number) =>
    sql`(date_trunc('day', now() at time zone ${tz}) - make_interval(days => ${daysAgo})) at time zone ${tz}`;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const dbStarted = Date.now();
  let databaseOk = true;
  try {
    await db.execute(sql`select 1`);
  } catch {
    databaseOk = false;
  }
  const databaseMs = Date.now() - dbStarted;

  const [[accounts], [newThisWeek], [messagesToday], [messagesYesterday], [callsToday], [groupCallsToday], [files]] =
    await Promise.all([
      db.select({ n: count() }).from(users),
      db.select({ n: count() }).from(users).where(gt(users.createdAt, weekAgo)),
      db
        .select({ n: count() })
        .from(messages)
        .where(and(isNull(messages.event), sql`${messages.createdAt} >= ${dayStart(0)}`)),
      db
        .select({ n: count() })
        .from(messages)
        .where(
          and(
            isNull(messages.event),
            sql`${messages.createdAt} >= ${dayStart(1)}`,
            sql`${messages.createdAt} < ${dayStart(0)}`,
          ),
        ),
      db.select({ n: count() }).from(calls).where(sql`${calls.createdAt} >= ${dayStart(0)}`),
      db
        .select({ n: count() })
        .from(calls)
        .innerJoin(conversations, eq(conversations.id, calls.conversationId))
        .where(and(eq(conversations.kind, "group"), sql`${calls.createdAt} >= ${dayStart(0)}`)),
      db.select({ n: count(), bytes: sum(attachments.size) }).from(attachments).where(isNotNull(attachments.messageId)),
    ]);

  // The last 14 days, oldest first: messages, calls and new accounts per day.
  const daily = await db.execute<{ day: string; messages: number; calls: number; signups: number }>(sql`
    with days as (
      select generate_series(0, 13) as ago
    ), bounds as (
      select ago,
        ((date_trunc('day', now() at time zone ${tz}) - make_interval(days => ago)))::date as day,
        (date_trunc('day', now() at time zone ${tz}) - make_interval(days => ago)) at time zone ${tz} as starts,
        (date_trunc('day', now() at time zone ${tz}) - make_interval(days => ago - 1)) at time zone ${tz} as ends
      from days
    )
    select to_char(b.day, 'YYYY-MM-DD') as day,
      (select count(*)::int from messages m where m.event is null and m.created_at >= b.starts and m.created_at < b.ends) as messages,
      (select count(*)::int from calls c where c.created_at >= b.starts and c.created_at < b.ends) as calls,
      (select count(*)::int from users u where u.created_at >= b.starts and u.created_at < b.ends) as signups
    from bounds b
    order by b.day
  `);

  // App versions: each person counts once, by the device they used most recently (last 30 days).
  // Per platform (desktop, android, ios), since the phone apps number their versions separately.
  const versions = await db.execute<{ platform: string; version: string | null; people: number }>(sql`
    select platform, version, count(*)::int as people from (
      select distinct on (user_id, coalesce(platform, 'desktop')) user_id,
        coalesce(platform, 'desktop') as platform, app_version as version
      from sessions
      where last_used_at > now() - interval '30 days'
      order by user_id, coalesce(platform, 'desktop'), last_used_at desc
    ) latest
    group by platform, version
    order by platform, version desc nulls last
  `);

  let redisOk = true;
  let failedToday = 0;
  try {
    failedToday = Number(await redis.get(failedKey())) || 0;
  } catch {
    redisOk = false;
  }
  const live = await connectedSummary();

  const recentUsers = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      createdAt: users.createdAt,
      emailVerifiedAt: users.emailVerifiedAt,
      suspendedAt: users.suspendedAt,
      deleteAfter: users.deleteAfter,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(5);
  const invites = (await openInvites()).slice(0, 5);
  const recentAccounts = [
    ...recentUsers.map((u) => ({
      kind: "account" as const,
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      createdAt: u.createdAt.toISOString(),
      status: accountStatus(u),
    })),
    ...invites.map((i) => ({
      kind: "invite" as const,
      id: i.id,
      username: i.username,
      displayName: i.displayName,
      createdAt: i.createdAt.toISOString(),
      status: inviteStatus(i) === "expired" ? ("invite_expired" as const) : ("invited" as const),
    })),
  ]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  const recentActions = await auditRows({ adminOnly: true, limit: 4 });

  res.json({
    timeZone: tz,
    stats: {
      accounts: accounts.n,
      newThisWeek: newThisWeek.n,
      onlineNow: live.userIds.size,
      devicesConnected: live.devices,
      messagesToday: messagesToday.n,
      messagesYesterday: messagesYesterday.n,
      callsToday: callsToday.n,
      groupCallsToday: groupCallsToday.n,
      storageBytes: Number(files.bytes ?? 0),
      fileCount: files.n,
    },
    health: {
      server: { ok: true, uptimeSec: Math.round(process.uptime()), files: storageKind },
      database: { ok: databaseOk, ms: databaseMs },
      redis: { ok: redisOk },
      realtime: { devices: live.devices },
      email: { transport: emailKind, failedToday },
      calls: { configured: livekitConfigured },
      push: { configured: pushConfigured, failedToday: await failedPushesToday() },
    },
    daily: daily.rows,
    versions: versions.rows,
    signupMode: await getSignupMode(),
    // Control v2: reports waiting for review, and the minimum app version.
    openReports: (await db.select({ n: count() }).from(reports).where(eq(reports.status, "open")))[0].n,
    minVersion: (await getMinVersion()).min,
    minVersions: {
      desktop: (await getMinVersion("desktop")).min,
      android: (await getMinVersion("android")).min,
      ios: (await getMinVersion("ios")).min,
      web: (await getMinVersion("web")).min,
    },
    recentAccounts,
    recentActions,
    // 0.8.2 (the phone's Home and desktop's Dashboard): calls happening now, Inbox replies to read,
    // Lockdown, the oldest open report, and the newest alerts.
    now: await happeningNow(),
  });
});

async function happeningNow() {
  const [live] = await db.execute<{ calls: number; people: number }>(sql`
    select count(distinct c.id)::int as calls, count(p.user_id)::int as people
    from calls c left join call_participants p on p.call_id = c.id and p.joined_at is not null and p.left_at is null
    where c.status = 'ongoing'
  `).then((r) => r.rows);
  const [oldest] = await db
    .select({ createdAt: reports.createdAt, reason: reports.reason })
    .from(reports)
    .where(eq(reports.status, "open"))
    .orderBy(reports.createdAt)
    .limit(1);
  const [unread] = await db.select({ n: count() }).from(teamReplies).where(isNull(teamReplies.readAt));
  const alerts = await db.select().from(adminAlerts).orderBy(desc(adminAlerts.createdAt)).limit(5);
  return {
    calls: live?.calls ?? 0,
    inCalls: live?.people ?? 0,
    oldestOpenReport: oldest ? { createdAt: oldest.createdAt.toISOString(), reason: oldest.reason } : null,
    inboxUnread: unread.n,
    lockdown: await getLockdown(),
    alerts: alerts.map((a) => ({ id: a.id, kind: a.kind, title: a.title, body: a.body, data: a.data ?? {}, createdAt: a.createdAt.toISOString() })),
  };
}

// ───────────── Accounts ─────────────

type StatusRow = { emailVerifiedAt: Date | null; suspendedAt: Date | null; deleteAfter: Date | null };
function accountStatus(u: StatusRow): "deleting" | "suspended" | "unconfirmed" | "confirmed" {
  if (u.deleteAfter) return "deleting";
  if (u.suspendedAt) return "suspended";
  return u.emailVerifiedAt ? "confirmed" : "unconfirmed";
}

const FILTERS = ["all", "invited", "unconfirmed", "suspended", "deleting"] as const;
type Filter = (typeof FILTERS)[number];

adminRouter.get("/accounts", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const filter: Filter = FILTERS.includes(req.query.filter as Filter) ? (req.query.filter as Filter) : "all";
  const like = q ? `%${escapeLike(q.replace(/^@/, ""))}%` : null;
  const search = like
    ? or(sql`${users.username} ilike ${like}`, sql`${users.email} ilike ${like}`, sql`${users.displayName} ilike ${like}`)
    : undefined;

  const filterWhere = {
    all: undefined,
    invited: sql`false`,
    unconfirmed: and(isNull(users.emailVerifiedAt), isNull(users.deleteAfter), isNull(users.suspendedAt)),
    suspended: isNotNull(users.suspendedAt),
    deleting: isNotNull(users.deleteAfter),
  }[filter];

  const LIMIT = 200;
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      suspendedAt: users.suspendedAt,
      deleteAfter: users.deleteAfter,
      restricted: users.restricted,
      isAdmin: sql<boolean>`${admins.id} is not null`,
    })
    .from(users)
    .leftJoin(admins, eq(admins.userId, users.id))
    .where(and(search, filterWhere))
    .orderBy(desc(users.createdAt))
    .limit(LIMIT + 1);

  const invites = filter === "all" || filter === "invited" ? await openInvites(q.replace(/^@/, "") || undefined) : [];
  const live = await connectedSummary();

  const [[all], [unconfirmed], [suspended], [deleting]] = await Promise.all([
    db.select({ n: count() }).from(users),
    db
      .select({ n: count() })
      .from(users)
      .where(and(isNull(users.emailVerifiedAt), isNull(users.deleteAfter), isNull(users.suspendedAt))),
    db.select({ n: count() }).from(users).where(isNotNull(users.suspendedAt)),
    db.select({ n: count() }).from(users).where(isNotNull(users.deleteAfter)),
  ]);
  const invitedCount = (await openInvites()).length;

  res.json({
    counts: { all: all.n + invitedCount, invited: invitedCount, unconfirmed: unconfirmed.n, suspended: suspended.n, deleting: deleting.n },
    more: rows.length > LIMIT,
    invites: invites.map((i) => ({
      id: i.id,
      username: i.username,
      displayName: i.displayName,
      email: i.email,
      createdAt: i.createdAt,
      sentAt: i.sentAt,
      expiresAt: i.expiresAt,
      restricted: i.restricted,
      status: inviteStatus(i),
    })),
    accounts: rows.slice(0, LIMIT).map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      online: live.userIds.has(u.id),
      isAdmin: u.isAdmin,
      restricted: u.restricted,
      status: accountStatus(u),
    })),
  });
});

adminRouter.get("/accounts/:id", async (req, res) => {
  const id = req.params.id;
  if (!isId(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const [u] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      lastSeenAt: users.lastSeenAt,
      statusText: users.statusText,
      statusTextExpiresAt: users.statusTextExpiresAt,
      suspendedAt: users.suspendedAt,
      suspendReason: users.suspendReason,
      deleteAfter: users.deleteAfter,
      restricted: users.restricted,
      isAdmin: sql<boolean>`${admins.id} is not null`,
    })
    .from(users)
    .leftJoin(admins, eq(admins.userId, users.id))
    .where(eq(users.id, id));
  if (!u) {
    res.status(404).json({ error: "not_found", message: "That account doesn't exist any more." });
    return;
  }

  const live = await connectedSummary();
  const [[friends], [groups], [storage], devices, [code], [invite], history] = await Promise.all([
    db
      .select({ n: count() })
      .from(friendships)
      .where(and(eq(friendships.status, "accepted"), or(eq(friendships.userLow, id), eq(friendships.userHigh, id)))),
    db
      .select({ n: count() })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, id), eq(conversations.kind, "group"))),
    db.select({ bytes: sum(attachments.size), n: count() }).from(attachments).where(eq(attachments.uploaderId, id)),
    db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        appVersion: sessions.appVersion,
        platform: sessions.platform,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, id), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt)),
    db
      .select({ code: inviteCodes.code, label: inviteCodes.label })
      .from(inviteCodeUses)
      .innerJoin(inviteCodes, eq(inviteCodes.id, inviteCodeUses.codeId))
      .where(eq(inviteCodeUses.userId, id))
      .limit(1),
    db
      .select({ invitedBy: users.username })
      .from(accountInvites)
      .leftJoin(users, eq(users.id, accountInvites.invitedBy))
      .where(eq(accountInvites.acceptedUserId, id))
      .limit(1),
    auditRows({ targetUserId: id, limit: 20 }),
  ]);
  const onlineSessions = await connectedSessionIds(id);

  res.json({
    account: {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      pendingEmail: await pendingEmailFor(id),
      createdAt: u.createdAt,
      lastSeenAt: u.lastSeenAt,
      online: live.userIds.has(id),
      statusText: liveStatusText(u.statusText, u.statusTextExpiresAt),
      isAdmin: u.isAdmin,
      restricted: u.restricted,
      status: accountStatus(u),
      suspendedAt: u.suspendedAt,
      suspendReason: u.suspendReason,
      deleteAfter: u.deleteAfter,
      friends: friends.n,
      groups: groups.n,
      // 0.8.2 (Control for iPhone's account card)
      constellations: await db.$count(constellationMembers, eq(constellationMembers.userId, id)),
      openReports: await db.$count(reports, and(eq(reports.reportedUserId, id), eq(reports.status, "open"))),
      storageBytes: Number(storage.bytes ?? 0),
      fileCount: storage.n,
      inviteCode: code ?? null,
      invitedBy: invite ? (invite.invitedBy ?? "an admin") : null,
      devices: devices.map((d) => ({ ...d, online: onlineSessions.has(d.id) })),
    },
    history,
  });
});

adminRouter.get("/username-available", async (req, res) => {
  const parsed = usernameSchema.safeParse(req.query.username);
  if (!parsed.success) {
    res.json({ available: false, reason: parsed.error.issues[0].message });
    return;
  }
  res.json((await usernameTaken(parsed.data)) ? { available: false, reason: "That username is taken." } : { available: true });
});

/** Loads the account an action is about, or answers 404. */
export async function target(res: Response, id: unknown) {
  if (!isId(id)) {
    res.status(404).json({ error: "not_found", message: "That account doesn't exist any more." });
    return null;
  }
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      suspendedAt: users.suspendedAt,
      deleteAfter: users.deleteAfter,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!row) {
    res.status(404).json({ error: "not_found", message: "That account doesn't exist any more." });
    return null;
  }
  return row;
}

const noteOnly = z.object({ note: noteSchema });

/** Signs every device out and closes their live connections. */
/** Suspends an account: logging in is refused (showing the reason), every device signed out. */
export async function suspendAccount(userId: string, reason: string): Promise<number> {
  await db.update(users).set({ suspendedAt: new Date(), suspendReason: reason }).where(eq(users.id, userId));
  await endCallsFor(userId);
  return signOutEverywhere(userId);
}

async function signOutEverywhere(userId: string): Promise<number> {
  const removed = await db.delete(sessions).where(eq(sessions.userId, userId)).returning({ id: sessions.id });
  await disconnectSessions(userId);
  await announcePresence(userId, emitToUser, true).catch(() => {});
  return removed.length;
}

adminRouter.post("/accounts/:id/password-reset", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  const result = await adminSendPasswordReset(user.id);
  if (result === "send_failed") {
    res.status(503).json(EMAIL_FAILED);
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Sent a password reset",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `Reset link sent to ${user.email}.` });
});

adminRouter.post("/accounts/:id/confirm-email", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  const result = await adminResendVerification(user.id);
  if (result === "already_verified") {
    res.status(409).json({ error: "already_verified", message: "Their email is already confirmed." });
    return;
  }
  if (result === "send_failed") {
    res.status(503).json(EMAIL_FAILED);
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Resent the confirm email",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `Confirm link sent to ${user.email}.` });
});

adminRouter.post("/accounts/:id/username", async (req, res) => {
  const parsed = z.object({ username: usernameSchema, note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  const next = parsed.data.username;
  if (next === user.username) {
    res.status(400).json({ error: "invalid", fields: { username: "That's already their username." } });
    return;
  }
  // Only the case changing ("samo" → "SamO") isn't a clash with themselves.
  if (next.toLowerCase() !== user.username.toLowerCase() && (await usernameTaken(next))) {
    res.status(409).json({ error: "taken", fields: { username: "That username is taken." } });
    return;
  }
  try {
    await db.update(users).set({ username: next }).where(eq(users.id, user.id));
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e?.code ?? e?.cause?.code) === "23505") {
      res.status(409).json({ error: "taken", fields: { username: "That username is taken." } });
      return;
    }
    throw err;
  }
  await profileChanged(user.id);
  emitToUser(user.id, "account:changed", {});
  await logAction({
    adminId: admin(res).id,
    action: "Changed a username",
    targetUserId: user.id,
    targetLabel: `@${user.username} → @${next}`,
    details: { from: user.username, to: next },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `Username is now @${next}.` });
});

adminRouter.post("/accounts/:id/email", async (req, res) => {
  const parsed = z.object({ email: emailSchema, note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  if (await emailTaken(parsed.data.email)) {
    if (parsed.data.email.toLowerCase() !== user.email.toLowerCase()) {
      res.status(409).json({ error: "taken", fields: { email: "Another account (or invite) uses this email." } });
      return;
    }
  }
  const result = await adminChangeEmail(user.id, parsed.data.email);
  if (result === "same") {
    res.status(400).json({ error: "invalid", fields: { email: "That's already their email." } });
    return;
  }
  if (result === "taken") {
    res.status(409).json({ error: "taken", fields: { email: "Another account uses this email." } });
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Changed an email",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    details: { from: user.email, to: parsed.data.email },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    message: `Email changed. A confirm link went to ${parsed.data.email}, and a heads-up to the old address.`,
  });
});

adminRouter.post("/accounts/:id/sign-out", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  const devices = await signOutEverywhere(user.id);
  await logAction({
    adminId: admin(res).id,
    action: "Signed out all devices",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    details: { devices },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: devices === 1 ? "1 device signed out." : `${devices} devices signed out.` });
});

adminRouter.post("/accounts/:id/suspend", async (req, res) => {
  const parsed = z
    .object({
      reason: z
        .string({ error: "Write the reason they'll see." })
        .trim()
        .min(3, "Write the reason they'll see when they try to log in.")
        .max(200, "Keep the reason under 200 characters."),
      note: noteSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  if (user.id === admin(res).userId) {
    res.status(400).json({ error: "invalid", message: "You can't suspend your own account." });
    return;
  }
  const devices = await suspendAccount(user.id, parsed.data.reason);
  await logAction({
    adminId: admin(res).id,
    action: "Suspended",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    details: { reason: parsed.data.reason, devices },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `@${user.username} is suspended and signed out everywhere.` });
});

adminRouter.post("/accounts/:id/unsuspend", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  if (!user.suspendedAt) {
    res.status(409).json({ error: "not_suspended", message: "That account isn't suspended." });
    return;
  }
  await db.update(users).set({ suspendedAt: null, suspendReason: null }).where(eq(users.id, user.id));
  await logAction({
    adminId: admin(res).id,
    action: "Unsuspended",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `@${user.username} can log in again.` });
});

adminRouter.post("/accounts/:id/cancel-deletion", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  if (!user.deleteAfter) {
    res.status(409).json({ error: "not_deleting", message: "That account isn't set to be deleted." });
    return;
  }
  await cancelDeletion(user.id);
  await logAction({
    adminId: admin(res).id,
    action: "Cancelled a deletion",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `@${user.username} is back, exactly as it was.` });
});

adminRouter.post("/accounts/:id/delete", async (req, res) => {
  const parsed = z.object({ confirmUsername: z.string().trim().max(40), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  if (parsed.data.confirmUsername.replace(/^@/, "").toLowerCase() !== user.username.toLowerCase()) {
    res.status(400).json({ error: "invalid", fields: { confirmUsername: `Type ${user.username} to confirm.` } });
    return;
  }
  if (user.id === admin(res).userId) {
    res.status(400).json({ error: "invalid", message: "You can't delete your own account from Control." });
    return;
  }
  // Logged first: once removed, there's nothing left to point at but the label.
  await logAction({
    adminId: admin(res).id,
    action: "Deleted an account",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    details: { email: user.email },
    note: parsed.data.note,
    ip: ip(res),
  });
  await deleteNow(user.id);
  res.json({ ok: true, message: `@${user.username} was removed for good.` });
});

// ───────────── Create an account for someone (invites) ─────────────

adminRouter.post("/invites", async (req, res) => {
  const parsed = z
    .object({
      email: emailSchema,
      username: usernameSchema,
      displayName: displayNameSchema,
      addFriend: z.boolean().default(true),
      // 0.4.0: a restricted (family-managed) account, set up with a parent's consent.
      restricted: z.boolean().default(false),
      note: noteSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const input = parsed.data;
  const result = await createInvite({ ...input, invitedBy: admin(res).userId });
  if (!result.ok && "fields" in result) {
    res.status(409).json({ error: "taken", fields: result.fields, message: Object.values(result.fields)[0] });
    return;
  }
  if (!result.ok) {
    res.status(503).json(EMAIL_FAILED);
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Created an account",
    targetLabel: `@${input.username}`,
    details: {
      inviteId: result.invite.id,
      email: input.email,
      displayName: input.displayName,
      addFriend: input.addFriend,
      restricted: input.restricted,
    },
    note: input.note,
    ip: ip(res),
  });
  res.status(201).json({
    ok: true,
    message: `Invite sent to ${input.email}. The link works for ${INVITE_DAYS} days.`,
    invite: { id: result.invite.id, expiresAt: result.invite.expiresAt },
  });
});

async function inviteLabel(id: string): Promise<string | null> {
  const [row] = await db.select({ username: accountInvites.username }).from(accountInvites).where(eq(accountInvites.id, id));
  return row ? `@${row.username}` : null;
}

adminRouter.post("/invites/:id/resend", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = req.params.id;
  if (!isId(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const result = await resendInvite(id);
  if (result === "not_found") {
    res.status(404).json({ error: "not_found", message: "That invite was already used or cancelled." });
    return;
  }
  if (result === "taken") {
    res.status(409).json({
      error: "taken",
      message: "Someone took that username or email after the invite expired. Cancel it and create a new one.",
    });
    return;
  }
  if (result === "send_failed") {
    res.status(503).json(EMAIL_FAILED);
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Resent an invite",
    targetLabel: await inviteLabel(id),
    details: { inviteId: id },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `New invite sent. The link works for ${INVITE_DAYS} days.` });
});

adminRouter.post("/invites/:id/cancel", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = req.params.id;
  if (!isId(id) || !(await cancelInvite(id))) {
    res.status(404).json({ error: "not_found", message: "That invite was already used or cancelled." });
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Cancelled an invite",
    targetLabel: await inviteLabel(id),
    details: { inviteId: id },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: "Invite cancelled. Its link no longer works." });
});

// ───────────── Sign-ups ─────────────

adminRouter.get("/signups", async (_req, res) => {
  const codes = await db.select().from(inviteCodes).orderBy(desc(inviteCodes.createdAt)).limit(200);
  const uses = codes.length
    ? await db
        .select({ codeId: inviteCodeUses.codeId, username: users.username, usedAt: inviteCodeUses.usedAt })
        .from(inviteCodeUses)
        .innerJoin(users, eq(users.id, inviteCodeUses.userId))
        .orderBy(inviteCodeUses.usedAt)
    : [];
  res.json({
    mode: await getSignupMode(),
    codes: codes.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      maxUses: c.maxUses,
      uses: c.uses,
      expiresAt: c.expiresAt,
      disabledAt: c.disabledAt,
      createdAt: c.createdAt,
      usedBy: uses.filter((u) => u.codeId === c.id).map((u) => ({ username: u.username, usedAt: u.usedAt })),
      state: c.disabledAt
        ? "off"
        : c.uses >= c.maxUses
          ? "used_up"
          : c.expiresAt && c.expiresAt.getTime() <= Date.now()
            ? "expired"
            : "active",
    })),
  });
});

const MODE_NAMES = { open: "Open", invite: "Invite only", closed: "Closed" } as const;

adminRouter.put("/signups/mode", async (req, res) => {
  const parsed = z.object({ mode: z.enum(signupMode.enumValues), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const before = await getSignupMode();
  if (before === parsed.data.mode) {
    res.json({ ok: true, mode: before });
    return;
  }
  await setSignupMode(parsed.data.mode);
  await logAction({
    adminId: admin(res).id,
    action: "Changed sign-ups",
    targetLabel: `${MODE_NAMES[before]} → ${MODE_NAMES[parsed.data.mode]}`,
    details: { from: before, to: parsed.data.mode },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, mode: parsed.data.mode });
});

adminRouter.post("/invite-codes", async (req, res) => {
  const parsed = z
    .object({
      label: z.string({ error: "Say who it's for." }).trim().min(1, "Say who it's for.").max(60, "Keep it under 60 characters."),
      maxUses: z.number().int().min(1, "At least 1 use.").max(100, "At most 100 uses."),
      expiresInDays: z.number().int().min(1).max(365).nullable(),
      note: noteSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const { label, maxUses, expiresInDays, note } = parsed.data;
  // A clash between two random codes is very unlikely; try again if it happens.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newInviteCode();
    const [created] = await db
      .insert(inviteCodes)
      .values({
        code,
        label,
        maxUses,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) continue;
    await logAction({
      adminId: admin(res).id,
      action: "Made an invite code",
      targetLabel: code,
      details: { label, maxUses, expiresInDays },
      note,
      ip: ip(res),
    });
    res.status(201).json({ ok: true, code: created.code, id: created.id });
    return;
  }
  res.status(500).json({ error: "server_error" });
});

adminRouter.post("/invite-codes/:id/disable", async (req, res) => {
  const parsed = noteOnly.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const id = req.params.id;
  const [row] = isId(id)
    ? await db
        .update(inviteCodes)
        .set({ disabledAt: new Date() })
        .where(and(eq(inviteCodes.id, id), isNull(inviteCodes.disabledAt)))
        .returning({ code: inviteCodes.code })
    : [];
  if (!row) {
    res.status(404).json({ error: "not_found", message: "That code is already off." });
    return;
  }
  await logAction({
    adminId: admin(res).id,
    action: "Turned off an invite code",
    targetLabel: row.code,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: `${row.code} no longer works.` });
});

// ───────────── Audit log ─────────────

async function auditRows(options: {
  q?: string;
  before?: Date;
  targetUserId?: string;
  adminOnly?: boolean;
  limit: number;
}) {
  const like = options.q ? `%${escapeLike(options.q)}%` : null;
  const rows = await db
    .select({
      id: adminAuditLog.id,
      createdAt: adminAuditLog.createdAt,
      action: adminAuditLog.action,
      targetUserId: adminAuditLog.targetUserId,
      targetLabel: adminAuditLog.targetLabel,
      details: adminAuditLog.details,
      note: adminAuditLog.note,
      ip: adminAuditLog.ip,
      adminUsername: users.username,
    })
    .from(adminAuditLog)
    .leftJoin(admins, eq(admins.id, adminAuditLog.adminId))
    .leftJoin(users, eq(users.id, admins.userId))
    .where(
      and(
        like
          ? or(
              sql`${adminAuditLog.action} ilike ${like}`,
              sql`${adminAuditLog.targetLabel} ilike ${like}`,
              sql`${adminAuditLog.note} ilike ${like}`,
            )
          : undefined,
        options.before ? lt(adminAuditLog.createdAt, options.before) : undefined,
        options.targetUserId ? eq(adminAuditLog.targetUserId, options.targetUserId) : undefined,
        options.adminOnly
          ? and(isNotNull(adminAuditLog.adminId), sql`${adminAuditLog.action} not in ('Signed in', 'Signed out', 'Sign-in refused')`)
          : undefined,
      ),
    )
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(options.limit);
  return rows;
}

function beforeFrom(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

adminRouter.get("/audit", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const PAGE = 100;
  const rows = await auditRows({ q: q || undefined, before: beforeFrom(req.query.before), limit: PAGE + 1 });
  res.json({ entries: rows.slice(0, PAGE), hasMore: rows.length > PAGE });
});

/** One CSV cell. Cells starting like a formula get a ' so a spreadsheet never runs them. */
function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

adminRouter.get("/audit/export", async (_req, res) => {
  const rows = await auditRows({ limit: 100_000 });
  const lines = [
    ["When (UTC)", "Admin", "What", "About", "Note", "Network", "Details"].map(csvCell).join(","),
    ...rows.map((r) =>
      [r.createdAt, r.adminUsername ? `@${r.adminUsername}` : "", r.action, r.targetLabel, r.note, r.ip, r.details ? JSON.stringify(r.details) : ""]
        .map(csvCell)
        .join(","),
    ),
  ];
  await logAction({ adminId: admin(res).id, action: "Exported the audit log", note: `${rows.length} entries`, ip: ip(res) });
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="glofly-audit-log.csv"',
    "Cache-Control": "no-store",
  });
  res.send(`﻿${lines.join("\r\n")}\r\n`);
});

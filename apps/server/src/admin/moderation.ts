import { Router, type Response } from "express";
import { and, count, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { announcements, reports, sessions, userNotices, users } from "../db/schema";
import { fieldErrors } from "../auth/validation";
import { emitToAll, emitToUser, dropOutdatedApps } from "../realtime";
import { removeMessageForGood } from "../messages/routes";
import { currentAnnouncement } from "../safety/routes";
import { compareVersions, getMinVersion, isVersion, setMinVersion } from "../app-version";
import { logAction, noteSchema } from "./audit";
import type { AdminLocals } from "./auth";
import { suspendAccount } from "./routes";

// Glofly Control v2: Reports (from the Report button in Glofly), Announcements (the banner in
// everyone's app) and the minimum app version. Every action needs a note and goes in the
// audit log. Reports are the one place Control shows message text: only what was reported,
// and the few messages around it, as the reporter saw them.

export const moderationRouter = Router();

const admin = (res: Response): AdminLocals => res.locals.admin as AdminLocals;
const ip = (res: Response): string => res.locals.adminIp as string;
const idParam = z.uuid();

function invalid(res: Response, error: z.ZodError): void {
  const fields = fieldErrors(error);
  res.status(400).json({ error: "invalid", fields, message: Object.values(fields)[0] });
}

export const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment or bullying",
  hate: "Hate",
  sexual: "Sexual content",
  violence: "Violence or threats",
  self_harm: "Self-harm",
  other: "Something else",
};

// ───────────── Reports ─────────────

async function usersById(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return new Map<string, { id: string; username: string; displayName: string; suspendedAt: Date | null }>();
  const rows = await db
    .select({ id: users.id, username: users.username, displayName: users.displayName, suspendedAt: users.suspendedAt })
    .from(users)
    .where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Someone as a report shows them: from the account if it still exists, else from the snapshot. */
function personLabel(
  id: string | null,
  live: Map<string, { username: string; displayName: string }>,
  snapshot: { people: { id: string; username: string; displayName: string }[] },
) {
  if (!id) return null;
  const now = live.get(id);
  const then = snapshot.people.find((p) => p.id === id);
  return {
    id,
    username: now?.username ?? then?.username ?? "deleted",
    displayName: now?.displayName ?? then?.displayName ?? "Deleted account",
    exists: !!now,
  };
}

// GET /admin/reports?status=open|resolved&before=<id> — newest first, 50 at a time.
moderationRouter.get("/reports", async (req, res) => {
  const status = req.query.status === "resolved" ? "resolved" : "open";
  const before = idParam.safeParse(req.query.before);
  let olderThan = undefined;
  if (before.success) {
    const [anchor] = await db.select({ createdAt: reports.createdAt }).from(reports).where(eq(reports.id, before.data));
    if (anchor) {
      olderThan = or(lt(reports.createdAt, anchor.createdAt), and(eq(reports.createdAt, anchor.createdAt), lt(reports.id, before.data)));
    }
  }
  const PAGE = 50;
  const rows = await db
    .select()
    .from(reports)
    .where(and(eq(reports.status, status), olderThan))
    .orderBy(status === "open" ? reports.createdAt : desc(reports.resolvedAt), desc(reports.id))
    .limit(PAGE + 1);
  const page = rows.slice(0, PAGE);
  const live = await usersById(page.flatMap((r) => [r.reporterId, r.reportedUserId]));
  const [[open], [resolved]] = await Promise.all([
    db.select({ n: count() }).from(reports).where(eq(reports.status, "open")),
    db.select({ n: count() }).from(reports).where(eq(reports.status, "resolved")),
  ]);
  res.json({
    counts: { open: open.n, resolved: resolved.n },
    more: rows.length > PAGE,
    reports: page.map((r) => ({
      id: r.id,
      reason: r.reason,
      reasonLabel: REASON_LABELS[r.reason] ?? r.reason,
      kind: r.messageId ? "message" : "person",
      preview: r.snapshot.message
        ? r.snapshot.message.body.slice(0, 140) || (r.snapshot.message.attachments.length ? "Photo or file" : "")
        : null,
      chatKind: r.snapshot.chat?.kind ?? null,
      reporter: personLabel(r.reporterId, live, r.snapshot),
      reported: personLabel(r.reportedUserId, live, r.snapshot),
      status: r.status,
      outcome: r.outcome,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    })),
  });
});

// GET /admin/reports/:id — everything about one report.
moderationRouter.get("/reports/:id", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const [r] = id.success ? await db.select().from(reports).where(eq(reports.id, id.data)) : [];
  if (!r) {
    res.status(404).json({ error: "not_found", message: "That report doesn't exist." });
    return;
  }
  const live = await usersById([r.reporterId, r.reportedUserId, ...r.snapshot.people.map((p) => p.id)]);
  const reportedLive = live.get(r.reportedUserId);
  const [[others]] = await Promise.all([
    db.select({ n: count() }).from(reports).where(and(eq(reports.reportedUserId, r.reportedUserId), ne(reports.id, r.id))),
  ]);
  const [resolver] = r.resolvedBy
    ? await db.execute<{ display_name: string }>(
        sql`select u.display_name from admins a join users u on u.id = a.user_id where a.id = ${r.resolvedBy}`,
      ).then((x) => x.rows)
    : [];
  res.json({
    report: {
      id: r.id,
      reason: r.reason,
      reasonLabel: REASON_LABELS[r.reason] ?? r.reason,
      details: r.details,
      kind: r.messageId ? "message" : "person",
      messageId: r.messageId,
      chat: r.snapshot.chat,
      message: r.snapshot.message,
      context: r.snapshot.context,
      people: r.snapshot.people.map((p) => ({ ...p, ...(live.get(p.id) ? { username: live.get(p.id)!.username, displayName: live.get(p.id)!.displayName } : {}) })),
      reporter: personLabel(r.reporterId, live, r.snapshot),
      reported: personLabel(r.reportedUserId, live, r.snapshot),
      reportedSuspended: !!reportedLive?.suspendedAt,
      otherReportsAboutThem: others.n,
      status: r.status,
      outcome: r.outcome,
      note: r.note,
      resolvedBy: resolver?.display_name ?? null,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
    },
  });
});

const resolveBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dismiss"), note: noteSchema }),
  z.object({ action: z.literal("remove"), note: noteSchema }),
  z.object({
    action: z.literal("warn"),
    warning: z
      .string({ error: "Write the warning they'll see." })
      .trim()
      .min(10, "Write the warning they'll see (a sentence or two).")
      .max(600, "Keep the warning under 600 characters."),
    alsoRemove: z.boolean().optional(),
    note: noteSchema,
  }),
  z.object({
    action: z.literal("suspend"),
    reason: z
      .string({ error: "Write the reason they'll see." })
      .trim()
      .min(3, "Write the reason they'll see when they try to log in.")
      .max(200, "Keep the reason under 200 characters."),
    alsoRemove: z.boolean().optional(),
    note: noteSchema,
  }),
]);

const OUTCOME = { dismiss: "dismissed", remove: "removed", warn: "warned", suspend: "suspended" } as const;
const ACTION_LABEL = {
  dismiss: "Dismissed report",
  remove: "Removed reported message",
  warn: "Warned",
  suspend: "Suspended (report)",
} as const;

// POST /admin/reports/:id/resolve  { action: dismiss | remove | warn | suspend, note, … }
// Other open reports of the same message are resolved the same way.
moderationRouter.post("/reports/:id/resolve", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const parsed = resolveBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const [r] = id.success ? await db.select().from(reports).where(eq(reports.id, id.data)) : [];
  if (!r) {
    res.status(404).json({ error: "not_found", message: "That report doesn't exist." });
    return;
  }
  if (r.status === "resolved") {
    res.status(409).json({ error: "already_resolved", message: "Someone already resolved this report." });
    return;
  }
  const body = parsed.data;
  const me = admin(res);
  if (r.reportedUserId === me.userId && body.action === "suspend") {
    res.status(400).json({ error: "invalid", message: "You can't suspend your own account." });
    return;
  }
  const [target] = await db.select({ id: users.id, username: users.username, suspendedAt: users.suspendedAt }).from(users).where(eq(users.id, r.reportedUserId));
  if (!target && (body.action === "warn" || body.action === "suspend")) {
    res.status(409).json({ error: "gone", message: "That account no longer exists. Dismiss the report instead." });
    return;
  }

  let removed = false;
  const wantsRemove = body.action === "remove" || ((body.action === "warn" || body.action === "suspend") && body.alsoRemove);
  if (wantsRemove && r.messageId) removed = await removeMessageForGood(r.messageId);
  if (body.action === "remove" && !r.messageId) {
    res.status(400).json({ error: "invalid", message: "This report is about a person, not a message." });
    return;
  }
  let devices = 0;
  if (body.action === "warn" && target) {
    const [notice] = await db
      .insert(userNotices)
      .values({ userId: target.id, kind: "warning", body: body.warning })
      .returning({ id: userNotices.id, kind: userNotices.kind, body: userNotices.body, createdAt: userNotices.createdAt });
    emitToUser(target.id, "notice:new", { notice });
  }
  if (body.action === "suspend" && target && !target.suspendedAt) devices = await suspendAccount(target.id, body.reason);

  const now = new Date();
  const sameMessage = r.messageId
    ? or(eq(reports.id, r.id), and(eq(reports.messageId, r.messageId), eq(reports.status, "open")))
    : eq(reports.id, r.id);
  const closed = await db
    .update(reports)
    .set({ status: "resolved", outcome: OUTCOME[body.action], resolvedBy: me.id, resolvedAt: now, note: body.note })
    .where(and(sameMessage, eq(reports.status, "open")))
    .returning({ id: reports.id });

  await logAction({
    adminId: me.id,
    action: ACTION_LABEL[body.action],
    targetUserId: r.reportedUserId,
    targetLabel: target ? `@${target.username}` : "deleted account",
    details: {
      report: r.id,
      reason: r.reason,
      reportsClosed: closed.length,
      ...(r.messageId ? { messageRemoved: removed } : {}),
      ...(body.action === "warn" ? { warning: body.warning } : {}),
      ...(body.action === "suspend" ? { suspendReason: body.reason, devices } : {}),
    },
    note: body.note,
    ip: ip(res),
  });

  const who = target ? `@${target.username}` : "They";
  const message = {
    dismiss: "Report dismissed.",
    remove: removed ? "Message removed for everyone in the chat." : "The message was already gone. Report closed.",
    warn: `${who} will see your warning next time they open Glofly.`,
    suspend: target?.suspendedAt ? `${who} was already suspended. Report closed.` : `${who} is suspended and signed out everywhere.`,
  }[body.action];
  res.json({ ok: true, message: closed.length > 1 ? `${message} (${closed.length} reports of this message closed.)` : message });
});

// ───────────── Announcements ─────────────

const httpsUrl = z
  .string()
  .trim()
  .max(300, "Keep the link under 300 characters.")
  .refine((u) => {
    try {
      return new URL(u).protocol === "https:";
    } catch {
      return false;
    }
  }, "Links must start with https://");

const announcementBody = z.object({
  body: z
    .string({ error: "Write the announcement." })
    .trim()
    .min(3, "Write the announcement.")
    .max(240, "Keep it under 240 characters: it's a one-line banner."),
  tone: z.enum(["info", "important"]).default("info"),
  linkUrl: httpsUrl.optional().or(z.literal("").transform(() => undefined)),
  linkLabel: z.string().trim().max(30, "Keep the link's label short.").optional(),
  // Ends by itself after this many hours (null = until you end it).
  hours: z.number().int().min(1).max(24 * 30).nullable().default(null),
  note: noteSchema,
});

moderationRouter.get("/announcements", async (_req, res) => {
  const history = await db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(20);
  const current = await currentAnnouncement();
  const { min, message } = await getMinVersion();
  res.json({ current, history, minVersion: { version: min, message } });
});

moderationRouter.post("/announcements", async (req, res) => {
  const parsed = announcementBody.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const a = parsed.data;
  const me = admin(res);
  const now = new Date();
  const created = await db.transaction(async (tx) => {
    // One at a time: a new one replaces whatever is showing.
    await tx.update(announcements).set({ endedAt: now }).where(isNull(announcements.endedAt));
    const [row] = await tx
      .insert(announcements)
      .values({
        body: a.body,
        tone: a.tone,
        linkUrl: a.linkUrl ?? null,
        linkLabel: a.linkUrl ? a.linkLabel || null : null,
        createdBy: me.id,
        endsAt: a.hours ? new Date(now.getTime() + a.hours * 60 * 60 * 1000) : null,
      })
      .returning();
    return row;
  });
  emitToAll("announcement", { announcement: await currentAnnouncement() });
  await logAction({
    adminId: me.id,
    action: "Posted announcement",
    targetLabel: a.body.slice(0, 80),
    details: { tone: a.tone, link: a.linkUrl ?? null, hours: a.hours },
    note: a.note,
    ip: ip(res),
  });
  res.status(201).json({ ok: true, announcement: created, message: "The banner is showing in everyone's app." });
});

moderationRouter.post("/announcements/:id/end", async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const ended = id.success
    ? await db
        .update(announcements)
        .set({ endedAt: new Date() })
        .where(and(eq(announcements.id, id.data), isNull(announcements.endedAt)))
        .returning({ body: announcements.body })
    : [];
  if (!ended.length) {
    res.status(404).json({ error: "not_found", message: "That announcement already ended." });
    return;
  }
  emitToAll("announcement", { announcement: await currentAnnouncement() });
  await logAction({
    adminId: admin(res).id,
    action: "Ended announcement",
    targetLabel: ended[0].body.slice(0, 80),
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({ ok: true, message: "The banner is gone from everyone's app." });
});

// ───────────── Minimum app version ─────────────

/** Signed-in devices (used in the last 30 days) and the versions they run. */
async function deviceVersions() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return db
    .select({ userId: sessions.userId, version: sessions.appVersion })
    .from(sessions)
    .where(and(gt(sessions.expiresAt, new Date()), gt(sessions.lastUsedAt, since)));
}

// GET /admin/app-version?check=0.2.0 — the minimum now, the newest version any device runs,
// and (with check) how many devices and people would be asked to update.
moderationRouter.get("/app-version", async (req, res) => {
  const { min, message } = await getMinVersion();
  const devices = await deviceVersions();
  const known = devices.map((d) => d.version).filter(isVersion);
  const newest = known.sort(compareVersions).at(-1) ?? null;
  const check = isVersion(req.query.check) ? req.query.check : null;
  const below = check ? devices.filter((d) => compareVersions(d.version ?? "0.0.0", check) < 0) : [];
  res.json({
    minVersion: min,
    message,
    newest,
    check: check
      ? { version: check, devices: below.length, people: new Set(below.map((d) => d.userId)).size }
      : null,
  });
});

// PUT /admin/app-version  { version: "0.2.0" | null, message?, note } — older apps must update.
moderationRouter.put("/app-version", async (req, res) => {
  const parsed = z
    .object({
      version: z
        .string()
        .trim()
        .refine(isVersion, "Use a version like 0.2.0.")
        .nullable(),
      message: z.string().trim().max(200, "Keep the message under 200 characters.").optional(),
      note: noteSchema,
    })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const { version, note } = parsed.data;
  const devices = await deviceVersions();
  const newest = devices.map((d) => d.version).filter(isVersion).sort(compareVersions).at(-1) ?? null;
  // A minimum nobody can have yet would lock everyone out.
  if (version && (!newest || compareVersions(version, newest) > 0)) {
    res.status(400).json({
      error: "invalid",
      fields: { version: `No one is running ${version} yet (newest seen: ${newest ?? "none"}). Release it first.` },
      message: `No one is running ${version} yet (newest seen: ${newest ?? "none"}). Release it first.`,
    });
    return;
  }
  const before = (await getMinVersion()).min;
  await setMinVersion(version, parsed.data.message || null);
  const dropped = version ? await dropOutdatedApps(version) : 0;
  await logAction({
    adminId: admin(res).id,
    action: version ? "Set minimum app version" : "Removed minimum app version",
    targetLabel: `${before ?? "none"} → ${version ?? "none"}`,
    details: { disconnected: dropped },
    note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    message: version
      ? `Apps older than ${version} now have to update${dropped ? ` (${dropped} open now were asked)` : ""}.`
      : "No update is required any more.",
  });
});

import { createHash } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX, scrubError } from "@glofly/shared";
import { db } from "./db";
import { appErrors } from "./db/schema";
import { appVersionFrom, platformFrom, sessionFor } from "./auth/sessions";
import { logAction } from "./admin/audit";
import type { AdminLocals } from "./admin/auth";

// Error reports (0.7.3): the apps send what went wrong (never message text or passwords: the
// apps and this file both scrub it), grouped into one row per problem and app version, shown in
// Glofly Control → Errors. The server's own unexpected errors land here too (app "server").

const APPS = new Set(["desktop", "web", "android", "ios", "control", "server"]);
const USER_IDS_KEPT = 20;

/** The same problem = same app, version, first line (numbers taken out) and first code line. */
function fingerprint(app: string, version: string | null, message: string, stack: string | null): string {
  const firstFrame = (stack ?? "").split("\n").find((l) => /\bat\b|@|\.(js|ts|tsx)/.test(l))?.trim() ?? "";
  const shape = message.replace(/\d+/g, "#").replace(/<[^>]+>/g, "<>");
  return createHash("sha256").update([app, version ?? "", shape, firstFrame.replace(/:\d+:\d+/g, "")].join("\n")).digest("hex");
}

export async function recordError(e: {
  app: string;
  appVersion: string | null;
  os: string | null;
  message: string;
  stack: string | null;
  where: string | null;
  userId: string | null;
}): Promise<void> {
  const message = scrubError(e.message || "(no message)", ERROR_MESSAGE_MAX);
  const stack = e.stack ? scrubError(e.stack, ERROR_STACK_MAX) : null;
  const fp = fingerprint(e.app, e.appVersion, message, stack);
  const now = new Date();
  await db
    .insert(appErrors)
    .values({
      fingerprint: fp,
      app: e.app,
      appVersion: e.appVersion,
      os: e.os?.slice(0, 80) ?? null,
      message,
      stack,
      where: e.where?.slice(0, 60) ?? null,
      userIds: e.userId ? [e.userId] : [],
    })
    .onConflictDoUpdate({
      target: appErrors.fingerprint,
      set: {
        count: sql`${appErrors.count} + 1`,
        lastAt: now,
        os: e.os?.slice(0, 80) ?? sql`${appErrors.os}`,
        // Remember up to 20 different accounts (enough to say "hits several people")
        userIds: e.userId
          ? sql`(case when ${e.userId}::uuid = any(${appErrors.userIds}) or cardinality(${appErrors.userIds}) >= ${USER_IDS_KEPT} then ${appErrors.userIds} else array_append(${appErrors.userIds}, ${e.userId}::uuid) end)`
          : sql`${appErrors.userIds}`,
        // Fixed but happening again: open again
        resolvedAt: null,
      },
    });
}

/** The server's own unexpected errors (index.ts's last-stop handler). Never throws. */
export function recordServerError(err: unknown, where: string | null): void {
  const e = err as { message?: string; stack?: string };
  recordError({
    app: "server",
    appVersion: process.env.npm_package_version ?? null,
    os: null,
    message: String(e?.message ?? err),
    stack: e?.stack ?? null,
    where,
    userId: null,
  }).catch(() => undefined);
}

// ---------------------------------------------------------------------------------------------
// POST /errors  { message, stack?, where?, os? }   (signed in or not: sign-in screens break too)

export const errorReportsRouter = Router();

const reportLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests" },
});

errorReportsRouter.post("/", reportLimiter, async (req, res) => {
  const b = req.body ?? {};
  if (typeof b.message !== "string" || !b.message.trim()) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const { found } = await sessionFor(req).catch(() => ({ found: null }));
  const platform = found?.session.platform ?? platformFrom(req.headers["x-glofly-platform"]);
  const app = platform === "desktop" || !platform ? "desktop" : String(platform);
  await recordError({
    app: APPS.has(app) ? app : "desktop",
    appVersion: appVersionFrom(req.headers["x-glofly-version"]),
    os: typeof b.os === "string" ? b.os : null,
    message: b.message,
    stack: typeof b.stack === "string" ? b.stack : null,
    where: typeof b.where === "string" ? b.where : null,
    userId: found?.user.id ?? null,
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------------------------
// Glofly Control → Errors

export const errorsAdminRouter = Router();

// GET /admin/errors?show=open|fixed&app=desktop
errorsAdminRouter.get("/errors", async (req, res) => {
  const show = req.query.show === "fixed" ? "fixed" : "open";
  const app = typeof req.query.app === "string" && APPS.has(req.query.app) ? req.query.app : null;
  const rows = await db
    .select({
      id: appErrors.id,
      app: appErrors.app,
      appVersion: appErrors.appVersion,
      os: appErrors.os,
      message: appErrors.message,
      stack: appErrors.stack,
      where: appErrors.where,
      count: appErrors.count,
      people: sql<number>`cardinality(${appErrors.userIds})`,
      firstAt: appErrors.firstAt,
      lastAt: appErrors.lastAt,
      resolvedAt: appErrors.resolvedAt,
    })
    .from(appErrors)
    .where(and(show === "fixed" ? isNotNull(appErrors.resolvedAt) : isNull(appErrors.resolvedAt), app ? eq(appErrors.app, app) : undefined))
    .orderBy(desc(appErrors.lastAt))
    .limit(200);
  const [today] = await db
    .select({ n: sql<number>`coalesce(sum(${appErrors.count}) filter (where ${appErrors.lastAt} > now() - interval '24 hours'), 0)::int` })
    .from(appErrors);
  res.json({ errors: rows, lastDay: today?.n ?? 0 });
});

// POST /admin/errors/:id/resolve · /reopen
errorsAdminRouter.post("/errors/:id/:action", async (req, res) => {
  const action = req.params.action;
  if (action !== "resolve" && action !== "reopen") {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const done = await db
    .update(appErrors)
    .set({ resolvedAt: action === "resolve" ? new Date() : null })
    .where(eq(appErrors.id, id))
    .returning({ id: appErrors.id, message: appErrors.message });
  if (!done.length) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const admin = res.locals.admin as AdminLocals | undefined;
  await logAction({
    adminId: admin?.id ?? null,
    action: action === "resolve" ? "error_resolved" : "error_reopened",
    details: { message: done[0].message.slice(0, 120) },
    ip: req.ip ?? null,
  }).catch(() => undefined);
  res.json({ ok: true });
});

// DELETE /admin/errors: clears every fixed one
errorsAdminRouter.delete("/errors", async (_req, res) => {
  const gone = await db.delete(appErrors).where(isNotNull(appErrors.resolvedAt)).returning({ id: appErrors.id });
  res.json({ removed: gone.length });
});

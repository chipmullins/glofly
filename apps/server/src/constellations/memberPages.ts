import { Router, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, gt, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { MEMBERS_PAGE } from "@glofly/shared";
import { db } from "../db";
import { constellationMembers, users } from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { standingOf } from "./perms";
import { memberEntries } from "./views";

// Communities round 2 (board 4a): the member list page by page, for big constellations (their
// detail only lists staff and people online). Sorted by name; `q` searches names and usernames.
//
//   GET /constellations/:id/members?q=&after=&limit=   → { members, next, total }
//
// `after` is the `next` of the page before (opaque). Bots are left out, like member counts.

export const memberPagesRouter = Router();
memberPagesRouter.use("/:id/members", requireAuth);
memberPagesRouter.use("/:id/members", async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted((res.locals.user as { id: string }).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

const limiter = rateLimit("constellations:members", {
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: (_req, res) => (res.locals.user as { id: string }).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of scrolling. Try again in a minute." },
});

const cursorOf = (name: string, id: string) => Buffer.from(JSON.stringify([name, id])).toString("base64url");
function readCursor(raw: unknown): [string, string] | null {
  if (typeof raw !== "string" || raw.length > 400) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return Array.isArray(v) && typeof v[0] === "string" && z.uuid().safeParse(v[1]).success ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
}

memberPagesRouter.get("/:id/members", limiter, async (req, res) => {
  const id = z.uuid().safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, (res.locals.user as { id: string }).id) : null;
  if (!s) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const limit = Math.min(MEMBERS_PAGE, Math.max(1, Number(req.query.limit) || MEMBERS_PAGE));
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const after = readCursor(req.query.after);
  const nameKey = sql<string>`lower(${users.displayName})`;
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db
    .select({ id: users.id, name: nameKey })
    .from(constellationMembers)
    .innerJoin(users, eq(users.id, constellationMembers.userId))
    .where(
      and(
        eq(constellationMembers.constellationId, s.constellationId),
        eq(users.bot, false),
        q ? or(ilike(users.displayName, like), ilike(users.username, like)) : undefined,
        after ? or(gt(nameKey, after[0]), and(eq(nameKey, after[0]), gt(users.id, after[1]))) : undefined,
      ),
    )
    .orderBy(asc(nameKey), asc(users.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const total = after ? null : await db.$count(constellationMembers, eq(constellationMembers.constellationId, s.constellationId));
  res.json({
    members: await memberEntries(s.constellationId, page.map((r) => r.id)),
    next: rows.length > limit ? cursorOf(page[page.length - 1].name, page[page.length - 1].id) : null,
    ...(total !== null ? { total } : {}),
  });
});

import { Router, type NextFunction, type Request, type Response } from "express";
import { and, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  FOLLOWERS_MAX,
  FOLLOWS_PER_CONSTELLATION_MAX,
  type AnnouncementFollow,
  type AnnouncementFollower,
  type Crosspost,
  type FollowTarget,
} from "@glofly/shared";
import { db } from "../db";
import {
  announcementFollows,
  constellationLinks,
  constellationMembers,
  constellations,
  crosspostCopies,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { requireAuth } from "../auth/sessions";
import { isRestricted, MANAGED_BY_FAMILY } from "../friends/rules";
import { rateLimit } from "../rateLimit";
import { registerToolHooks } from "../toolHooks";
import { can, frozen, FROZEN_MESSAGE, standingOf, type Standing } from "../constellations/perms";
import { seesNebulaChat, viewersOf } from "../constellations/access";
import { constellationChanged, logModeration } from "../constellations/activity";
import { toolBot } from "../tools/tools";
import { copyMessageInto, removeMessageForGood, sendUpdated } from "../messages/routes";

// Communities round 2 (Nov 2026), board 3b: announcement nebulas other constellations can follow.
//
//   GET    /constellations/announcements/targets?nebulaId=   where I could send a nebula's posts (FollowTarget[])
//   POST   /constellations/:id/nebulas/:nid/follow { targetNebulaId }   follow (Manage nebulas where the copies go)
//   GET    /constellations/:id/nebulas/:nid/followers         who follows (the source's Manage nebulas) → AnnouncementFollower[]
//   DELETE /constellations/:id/nebulas/:nid/followers/:fid    stop one follower (the source's Manage nebulas)
//   GET    /constellations/:id/follows                        what this constellation follows (Manage nebulas) → AnnouncementFollow[]
//   DELETE /constellations/:id/follows/:fid                   unfollow (Manage nebulas)
//
// Anyone may follow a public constellation's announcement nebulas (for everyone, not role-only);
// a private constellation's only its members. The source sees which constellation follows, never who
// clicked. Copies are posted by the follower's Glofly member (tools/tools.ts toolBot) with
// `crosspost` (and `forwarded`, so 0.9.2+ apps show "Forwarded from …" and older ones the text).

export const announcementsRouter = Router();
const PATHS = ["/announcements/targets", "/:id/nebulas/:nid/follow", "/:id/nebulas/:nid/followers", "/:id/nebulas/:nid/followers/*rest", "/:id/follows", "/:id/follows/*rest"];
announcementsRouter.use(PATHS, requireAuth);
announcementsRouter.use(PATHS, async (_req: Request, res: Response, next: NextFunction) => {
  if (await isRestricted(me(res).id)) {
    res.status(403).json(MANAGED_BY_FAMILY);
    return;
  }
  next();
});

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;
const idParam = z.uuid();
const bad = (res: Response, message: string, status = 400) =>
  res.status(status).json({ error: status === 403 ? "forbidden" : status === 409 ? "conflict" : status === 404 ? "not_found" : "invalid", message });
const changeLimiter = rateLimit("announcements:change", {
  windowMs: 10 * 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "That's a lot of changes. Wait a few minutes and try again." },
});

/** Followers per announcement nebula (constellation detail). */
export async function followerCounts(nebulaIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!nebulaIds.length) return out;
  const rows = await db
    .select({ id: announcementFollows.sourceNebulaId, n: count() })
    .from(announcementFollows)
    .where(inArray(announcementFollows.sourceNebulaId, nebulaIds))
    .groupBy(announcementFollows.sourceNebulaId);
  for (const r of rows) out.set(r.id, r.n);
  return out;
}

type SourceRow = { nebula: typeof nebulas.$inferSelect; c: { id: string; name: string; visibility: string; takenDownAt: Date | null } };

async function sourceOf(nebulaId: string): Promise<SourceRow | null> {
  const [row] = await db
    .select({ nebula: nebulas, c: { id: constellations.id, name: constellations.name, visibility: constellations.visibility, takenDownAt: constellations.takenDownAt } })
    .from(nebulas)
    .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
    .where(eq(nebulas.id, nebulaId));
  return row ?? null;
}

/**
 * Can this person follow that announcement nebula? Public constellation and a nebula for everyone, or
 * they can see it as a member. The same answer for "not there" and "not allowed".
 */
async function mayFollow(userId: string, src: SourceRow | null): Promise<boolean> {
  if (!src || src.nebula.kind !== "announcement" || src.c.takenDownAt) return false;
  if (src.c.visibility === "public" && src.nebula.visibility === "everyone" && !src.nebula.optional && !src.nebula.userIds.length) return true;
  return seesNebulaChat(userId, src.nebula.conversationId);
}

// GET /constellations/announcements/targets?nebulaId= — my constellations' text nebulas I could send it to.
announcementsRouter.get("/announcements/targets", async (req, res) => {
  const nid = idParam.safeParse(req.query.nebulaId);
  const src = nid.success ? await sourceOf(nid.data) : null;
  if (!src || !(await mayFollow(me(res).id, src))) {
    bad(res, "That nebula isn't there any more.", 404);
    return;
  }
  const mine = await db
    .select({ id: constellations.id, name: constellations.name, iconVersion: constellations.iconVersion, color: constellations.color })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(and(eq(constellationMembers.userId, me(res).id), isNull(constellations.takenDownAt)))
    .limit(200);
  const out: FollowTarget[] = [];
  for (const c of mine) {
    if (c.id === src.c.id) continue;
    const s = await standingOf(c.id, me(res).id);
    if (!s || !can(s, "manageNebulas")) continue;
    const rows = await db
      .select({ id: nebulas.id, name: nebulas.name, conversationId: nebulas.conversationId })
      .from(nebulas)
      .where(and(eq(nebulas.constellationId, c.id), inArray(nebulas.kind, ["text", "announcement"])))
      .orderBy(nebulas.position);
    const following = new Set(
      (
        await db
          .select({ id: announcementFollows.targetNebulaId })
          .from(announcementFollows)
          .where(and(eq(announcementFollows.sourceNebulaId, src.nebula.id), inArray(announcementFollows.targetNebulaId, rows.map((r) => r.id).concat("00000000-0000-0000-0000-000000000000"))))
      ).map((r) => r.id),
    );
    const seen: FollowTarget["nebulas"] = [];
    for (const r of rows) if (await seesNebulaChat(me(res).id, r.conversationId)) seen.push({ id: r.id, name: r.name, following: following.has(r.id) });
    if (seen.length) out.push({ constellationId: c.id, name: c.name, iconVersion: c.iconVersion, color: c.color, nebulas: seen });
  }
  res.json({ targets: out });
});

// POST /constellations/:id/nebulas/:nid/follow { targetNebulaId }
announcementsRouter.post("/:id/nebulas/:nid/follow", changeLimiter, async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const nid = idParam.safeParse(req.params.nid);
  const target = idParam.safeParse(req.body?.targetNebulaId);
  const src = nid.success ? await sourceOf(nid.data) : null;
  if (!id.success || !src || src.c.id !== id.data || !(await mayFollow(me(res).id, src))) {
    bad(res, "That nebula isn't there any more.", 404);
    return;
  }
  const [t] = target.success ? await db.select().from(nebulas).where(eq(nebulas.id, target.data)) : [];
  const s: Standing | null = t ? await standingOf(t.constellationId, me(res).id) : null;
  if (!t || !s || !(await seesNebulaChat(me(res).id, t.conversationId))) {
    bad(res, "Pick a nebula in one of your constellations.", 404);
    return;
  }
  if (!can(s, "manageNebulas")) {
    bad(res, "You need Manage nebulas in that constellation.", 403);
    return;
  }
  if (t.constellationId === src.c.id) {
    bad(res, "Pick a nebula in another constellation.");
    return;
  }
  if (t.kind !== "text" && t.kind !== "announcement") {
    bad(res, "Posts can only go into a text nebula.");
    return;
  }
  if (await frozen(t.constellationId)) {
    bad(res, FROZEN_MESSAGE, 403);
    return;
  }
  const [{ n: followers }] = await db.select({ n: count() }).from(announcementFollows).where(eq(announcementFollows.sourceNebulaId, src.nebula.id));
  if (followers >= FOLLOWERS_MAX) {
    bad(res, "This nebula has as many followers as it can have.", 409);
    return;
  }
  const [{ n: mine }] = await db
    .select({ n: count() })
    .from(announcementFollows)
    .innerJoin(nebulas, eq(nebulas.id, announcementFollows.targetNebulaId))
    .where(eq(nebulas.constellationId, t.constellationId));
  if (mine >= FOLLOWS_PER_CONSTELLATION_MAX) {
    bad(res, `A constellation can follow up to ${FOLLOWS_PER_CONSTELLATION_MAX} announcement nebulas.`, 409);
    return;
  }
  const [row] = await db
    .insert(announcementFollows)
    .values({ sourceNebulaId: src.nebula.id, targetNebulaId: t.id, createdBy: me(res).id })
    .onConflictDoNothing()
    .returning({ id: announcementFollows.id });
  if (row) {
    // The Glofly member who posts the copies (made now, so the first post doesn't wait for it).
    await toolBot(t.constellationId);
    await logModeration(t.constellationId, me(res).id, "follow_added", null, { source: `${src.c.name} › #${src.nebula.name}`, nebula: t.name });
    await logModeration(src.c.id, null, "follow_added", null, { follower: (await nameOf(t.constellationId)) ?? "A constellation", nebula: src.nebula.name });
    await constellationChanged(src.c.id);
    await constellationChanged(t.constellationId);
  }
  res.status(201).json({ followId: row?.id ?? null });
});

const nameOf = async (constellationId: string) =>
  (await db.select({ name: constellations.name }).from(constellations).where(eq(constellations.id, constellationId)))[0]?.name ?? null;

/** My standing with "Manage nebulas" in the constellation in the path (404/403 otherwise). */
async function managing(req: Request, res: Response): Promise<Standing | null> {
  const id = idParam.safeParse(req.params.id);
  const s = id.success ? await standingOf(id.data, me(res).id) : null;
  if (!s) {
    bad(res, "That constellation isn't there any more.", 404);
    return null;
  }
  if (!can(s, "manageNebulas")) {
    bad(res, "Your role doesn't allow that here.", 403);
    return null;
  }
  return s;
}

announcementsRouter.get("/:id/nebulas/:nid/followers", async (req, res) => {
  const s = await managing(req, res);
  if (!s) return;
  const nid = idParam.safeParse(req.params.nid);
  if (!nid.success) {
    bad(res, "That nebula isn't there any more.", 404);
    return;
  }
  const rows = await db
    .select({
      followId: announcementFollows.id,
      createdAt: announcementFollows.createdAt,
      nebulaName: nebulas.name,
      constellationId: constellations.id,
      name: constellations.name,
      iconVersion: constellations.iconVersion,
      color: constellations.color,
      sourceConstellation: sql<string>`(select constellation_id from nebulas where id = ${announcementFollows.sourceNebulaId})`,
    })
    .from(announcementFollows)
    .innerJoin(nebulas, eq(nebulas.id, announcementFollows.targetNebulaId))
    .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
    .where(eq(announcementFollows.sourceNebulaId, nid.data))
    .orderBy(desc(announcementFollows.createdAt))
    .limit(FOLLOWERS_MAX);
  const followers: AnnouncementFollower[] = rows
    .filter((r) => r.sourceConstellation === s.constellationId)
    .map((r) => ({
      followId: r.followId,
      constellationId: r.constellationId,
      name: r.name,
      iconVersion: r.iconVersion,
      color: r.color,
      nebulaName: r.nebulaName,
      since: r.createdAt.toISOString(),
    }));
  res.json({ followers });
});

/** Removes a follow, as the source (`side` "source") or the follower ("target"). */
async function removeFollow(req: Request, res: Response, side: "source" | "target"): Promise<void> {
  const s = await managing(req, res);
  if (!s) return;
  const fid = idParam.safeParse(req.params.rest?.[0] ?? req.params.rest);
  const [f] = fid.success
    ? await db
        .select({
          id: announcementFollows.id,
          source: sql<string>`(select constellation_id from nebulas where id = ${announcementFollows.sourceNebulaId})`,
          target: sql<string>`(select constellation_id from nebulas where id = ${announcementFollows.targetNebulaId})`,
        })
        .from(announcementFollows)
        .where(eq(announcementFollows.id, fid.data))
    : [];
  if (!f || (side === "source" ? f.source : f.target) !== s.constellationId) {
    bad(res, "That follow isn't there any more.", 404);
    return;
  }
  await db.delete(announcementFollows).where(eq(announcementFollows.id, f.id));
  await logModeration(s.constellationId, s.userId, "follow_removed", null, { other: (await nameOf(side === "source" ? f.target : f.source)) ?? "A constellation" });
  await constellationChanged(f.source);
  await constellationChanged(f.target);
  res.status(204).end();
}

announcementsRouter.delete("/:id/nebulas/:nid/followers/*rest", changeLimiter, (req, res) => removeFollow(req, res, "source"));
announcementsRouter.delete("/:id/follows/*rest", changeLimiter, (req, res) => removeFollow(req, res, "target"));

announcementsRouter.get("/:id/follows", async (req, res) => {
  const s = await managing(req, res);
  if (!s) return;
  const rows = await db
    .select({
      followId: announcementFollows.id,
      createdAt: announcementFollows.createdAt,
      targetNebulaId: announcementFollows.targetNebulaId,
      sourceNebulaId: announcementFollows.sourceNebulaId,
    })
    .from(announcementFollows)
    .innerJoin(nebulas, eq(nebulas.id, announcementFollows.targetNebulaId))
    .where(eq(nebulas.constellationId, s.constellationId))
    .orderBy(desc(announcementFollows.createdAt));
  const sources = rows.length
    ? await db
        .select({ id: nebulas.id, name: nebulas.name, constellationId: constellations.id, cname: constellations.name })
        .from(nebulas)
        .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
        .where(inArray(nebulas.id, rows.map((r) => r.sourceNebulaId)))
    : [];
  const follows: AnnouncementFollow[] = rows.flatMap((r) => {
    const src = sources.find((x) => x.id === r.sourceNebulaId);
    return src
      ? [{
          followId: r.followId,
          sourceConstellationId: src.constellationId,
          sourceName: src.cname,
          sourceNebulaId: src.id,
          sourceNebulaName: src.name,
          targetNebulaId: r.targetNebulaId,
          since: r.createdAt.toISOString(),
        }]
      : [];
  });
  res.json({ follows });
});

// ───────────── Copying posts ─────────────

/** An active invite link of a public constellation (the copy's "Open Night Raiders"). */
async function publicCode(constellationId: string): Promise<string | null> {
  const [row] = await db
    .select({ code: constellationLinks.code })
    .from(constellationLinks)
    .where(
      and(
        eq(constellationLinks.constellationId, constellationId),
        isNull(constellationLinks.revokedAt),
        or(isNull(constellationLinks.expiresAt), gt(constellationLinks.expiresAt, new Date())),
        or(isNull(constellationLinks.maxUses), sql`${constellationLinks.uses} < ${constellationLinks.maxUses}`),
      ),
    )
    .limit(1);
  return row?.code ?? null;
}

async function copyPost(messageId: string): Promise<void> {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  // Only real posts: no events, thread replies, lanterns, polls or games, and never a copy of a copy.
  if (!m || m.deletedAt || m.event || m.threadId || m.lantern || m.poll || m.game || m.crosspost) return;
  const [src] = await db
    .select({ nebula: nebulas, c: constellations })
    .from(nebulas)
    .innerJoin(constellations, eq(constellations.id, nebulas.constellationId))
    .where(eq(nebulas.conversationId, m.conversationId));
  if (!src || src.nebula.kind !== "announcement" || src.c.takenDownAt || src.c.frozenAt) return;
  const follows = await db
    .select({ id: announcementFollows.id, target: nebulas })
    .from(announcementFollows)
    .innerJoin(nebulas, eq(nebulas.id, announcementFollows.targetNebulaId))
    .where(eq(announcementFollows.sourceNebulaId, src.nebula.id));
  if (!follows.length) return;
  const [author] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, m.senderId));
  const crosspost: Crosspost = {
    constellationId: src.c.id,
    constellationName: src.c.name,
    iconVersion: src.c.iconVersion,
    color: src.c.color,
    nebulaName: src.nebula.name,
    authorName: (author?.name ?? "Someone").slice(0, 64),
    sourceMessageId: m.id,
    inviteCode: src.c.visibility === "public" ? await publicCode(src.c.id) : null,
  };
  const forwarded = { name: crosspost.authorName, where: `${src.c.name} › #${src.nebula.name}`.slice(0, 120), at: m.createdAt.toISOString() };
  for (const f of follows) {
    try {
      const [c] = await db.select({ takenDownAt: constellations.takenDownAt, frozenAt: constellations.frozenAt }).from(constellations).where(eq(constellations.id, f.target.constellationId));
      if (!c || c.takenDownAt || c.frozenAt) continue;
      const bot = await toolBot(f.target.constellationId);
      const viewers = await viewersOf(f.target.conversationId);
      const made = await copyMessageInto(f.target.conversationId, bot, m, { forwarded, crosspost }, viewers, true);
      if (made.ok) await db.insert(crosspostCopies).values({ copyMessageId: made.inserted.id, sourceMessageId: m.id, followId: f.id });
    } catch (err) {
      console.error("Couldn't copy an announcement:", err instanceof Error ? err.message : err);
    }
  }
}

/** Edits follow along (the text; files stay as they were copied). */
async function editCopies(messageId: string): Promise<void> {
  const copies = await db.select({ id: crosspostCopies.copyMessageId }).from(crosspostCopies).where(eq(crosspostCopies.sourceMessageId, messageId));
  if (!copies.length) return;
  const [m] = await db.select({ body: messages.body, emojis: messages.emojis, editedAt: messages.editedAt }).from(messages).where(eq(messages.id, messageId));
  if (!m) return;
  for (const c of copies) {
    const [row] = await db
      .update(messages)
      .set({ body: m.body, emojis: m.emojis, editedAt: m.editedAt ?? new Date() })
      .where(and(eq(messages.id, c.id), isNull(messages.deletedAt)))
      .returning({ conversationId: messages.conversationId });
    if (row) await sendUpdated(c.id, row.conversationId);
  }
}

/** Deletes follow along. */
async function deleteCopies(messageId: string): Promise<void> {
  const copies = await db.select({ id: crosspostCopies.copyMessageId }).from(crosspostCopies).where(eq(crosspostCopies.sourceMessageId, messageId));
  for (const c of copies) await removeMessageForGood(c.id);
}

export function startAnnouncements(): void {
  registerToolHooks({
    onNebulaMessage: async (_conversationId, messageId, change) => {
      if (change === "created") await copyPost(messageId);
      else if (change === "edited") await editCopies(messageId);
      else await deleteCopies(messageId);
    },
  });
}

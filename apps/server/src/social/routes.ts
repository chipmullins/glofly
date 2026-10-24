import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { HANG_MINUTES, isBirthdayOn, type Hanging, type SocialToday } from "@glofly/shared";
import { requireAuth } from "../auth/sessions";
import { db } from "../db";
import { blocks, friendships, users } from "../db/schema";
import { emitToUser } from "../realtime";
import { inBackground, notifyFriendNews } from "../push/notify";
import { broadcastsFor } from "../broadcasts/state";
import { glowsOf, today } from "./glows";
import { yearInGlow } from "./year";

// 0.5.0 social extras:
//
//   GET    /social                 glows, who's free to hang, birthdays today, who's live
//   POST   /social/hang            { userIds?: string[] }  free to hang for the next hour
//   DELETE /social/hang            not anymore
//   PUT    /social/birthday        { share: boolean }  friends see your birthday (day only)
//   GET    /social/year            Year in Glow
//
// Everything here is between friends: hangs and birthdays only ever reach your friends (never
// someone you've blocked or who blocked you), so restricted (family) accounts stay within the
// friends Glofly Control gave them.

export const socialRouter = Router();
socialRouter.use(requireAuth);

type Me = { id: string; displayName: string; avatarVersion: string | null };
const me = (res: Response): Me => res.locals.user as Me;

/** My friends' ids (accepted, not deleting their account, no block either way). */
export async function friendIdsOf(userId: string): Promise<string[]> {
  const other = sql<string>`case when ${friendships.userLow} = ${userId} then ${friendships.userHigh} else ${friendships.userLow} end`;
  const rows = await db
    .select({ id: other })
    .from(friendships)
    .innerJoin(users, eq(users.id, other))
    .where(and(eq(friendships.status, "accepted"), or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)), isNull(users.deleteAfter)));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return ids;
  const blocked = await db
    .select({ a: blocks.blockerId, b: blocks.blockedId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, userId), inArray(blocks.blockedId, ids)), and(eq(blocks.blockedId, userId), inArray(blocks.blockerId, ids))));
  const out = new Set(blocked.map((r) => (r.a === userId ? r.b : r.a)));
  return ids.filter((id) => !out.has(id));
}

socialRouter.get("/", async (_req, res) => {
  const myId = me(res).id;
  const friendIds = await friendIdsOf(myId);
  const now = new Date();
  const [mine] = await db
    .select({ hangUntil: users.hangUntil, hangWith: users.hangWith, shareBirthday: users.shareBirthday, showGlows: users.showGlows })
    .from(users)
    .where(eq(users.id, myId));
  const others = friendIds.length
    ? await db
        .select({ id: users.id, hangUntil: users.hangUntil, hangWith: users.hangWith, birthday: users.birthday, shareBirthday: users.shareBirthday })
        .from(users)
        .where(inArray(users.id, friendIds))
    : [];
  const day = today(now);
  const hanging: Hanging[] = others
    .filter((u) => u.hangUntil && u.hangUntil > now && (!u.hangWith || u.hangWith.includes(myId)))
    .map((u) => ({ userId: u.id, until: u.hangUntil!.toISOString() }));
  const body: SocialToday = {
    // 0.8.3: only for people who turned on Settings → Show glows (every app version then hides them).
    glows: mine?.showGlows ? await glowsOf(myId) : {},
    hanging,
    myHang: mine?.hangUntil && mine.hangUntil > now ? { until: mine.hangUntil.toISOString(), with: mine.hangWith ?? null } : null,
    birthdays: others.filter((u) => u.shareBirthday && isBirthdayOn(u.birthday, day)).map((u) => u.id),
    broadcasts: broadcastsFor(myId, friendIds),
    shareBirthday: !!mine?.shareBirthday,
  };
  res.set("Cache-Control", "no-store");
  res.json(body);
});

const hangLimiter = rateLimit("social:hang", {
  windowMs: 30 * 60 * 1000,
  limit: 4,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "You just told your friends. Give them a little while." },
});

socialRouter.post("/hang", hangLimiter, async (req, res) => {
  const myId = me(res).id;
  const parsed = z.object({ userIds: z.array(z.uuid()).max(500).optional() }).safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", message: "Pick who to tell." });
    return;
  }
  const friendIds = await friendIdsOf(myId);
  // Only friends can be told; anyone else in the list is left out.
  const chosen = parsed.data.userIds ? [...new Set(parsed.data.userIds)].filter((id) => friendIds.includes(id)) : null;
  if (chosen && chosen.length === 0) {
    res.status(400).json({ error: "invalid", message: "Pick at least one friend." });
    return;
  }
  const until = new Date(Date.now() + HANG_MINUTES * 60 * 1000);
  await db.update(users).set({ hangUntil: until, hangWith: chosen }).where(eq(users.id, myId));
  const told = chosen ?? friendIds;
  const who = { id: myId, displayName: me(res).displayName, avatarVersion: me(res).avatarVersion };
  for (const id of told) {
    emitToUser(id, "hang:ping", { userId: myId, until: until.toISOString() });
    emitToUser(id, "social:changed", {});
    inBackground(notifyFriendNews(id, who, "is free to hang for the next hour. Tap to say hi!", "soon"));
  }
  emitToUser(myId, "social:changed", {});
  res.json({ until: until.toISOString(), with: chosen, told: told.length });
});

socialRouter.delete("/hang", async (_req, res) => {
  const myId = me(res).id;
  const [before] = await db.select({ hangWith: users.hangWith, hangUntil: users.hangUntil }).from(users).where(eq(users.id, myId));
  await db.update(users).set({ hangUntil: null, hangWith: null }).where(eq(users.id, myId));
  if (before?.hangUntil && before.hangUntil > new Date()) {
    for (const id of before.hangWith ?? (await friendIdsOf(myId))) emitToUser(id, "social:changed", {});
  }
  emitToUser(myId, "social:changed", {});
  res.status(204).end();
});

socialRouter.put("/birthday", async (req, res) => {
  const share = z.object({ share: z.boolean() }).safeParse(req.body);
  if (!share.success) {
    res.status(400).json({ error: "invalid" });
    return;
  }
  const myId = me(res).id;
  await db.update(users).set({ shareBirthday: share.data.share }).where(eq(users.id, myId));
  for (const id of await friendIdsOf(myId)) emitToUser(id, "social:changed", {});
  emitToUser(myId, "social:changed", {});
  res.json({ share: share.data.share });
});

const yearLimiter = rateLimit("social:year", {
  windowMs: 60 * 1000,
  limit: 6,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Give it a moment and try again." },
});

socialRouter.get("/year", yearLimiter, async (req, res) => {
  const year = z.coerce.number().int().min(2025).max(2100).optional().safeParse(req.query.year);
  res.set("Cache-Control", "private, max-age=300");
  res.json(await yearInGlow(me(res).id, year.success ? year.data : undefined));
});

/** Hangs that ran out tell the friends who saw them (so "free to hang" disappears). */
export async function sweepHangs(): Promise<void> {
  const now = new Date();
  const ended = await db
    .select({ id: users.id, hangWith: users.hangWith })
    .from(users)
    .where(and(gt(users.hangUntil, new Date(0)), sql`${users.hangUntil} <= ${now}`))
    .limit(200);
  for (const u of ended) {
    await db.update(users).set({ hangUntil: null, hangWith: null }).where(eq(users.id, u.id));
    for (const id of u.hangWith ?? (await friendIdsOf(u.id))) emitToUser(id, "social:changed", {});
    emitToUser(u.id, "social:changed", {});
  }
}

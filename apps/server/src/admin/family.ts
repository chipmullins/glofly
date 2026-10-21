import { Router } from "express";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { constellationMembers, constellations, conversationMembers, conversations, friendInvites, friendships, users } from "../db/schema";
import { removeMember } from "../constellations/members";
import { emitToUser } from "../realtime";
import { announcePresence } from "../presence";
import { endCallsBetween } from "../calls/service";
import { clearOnlineAlerts } from "../friends/online-alerts";
import { blockedEitherWay, groupBreaksRestriction, pair, pairIs } from "../friends/rules";
import { removeGroupMember } from "../messages/routes";
import { logAction, noteSchema } from "./audit";
import { admin, invalid, ip, target } from "./routes";

// Restricted (family-managed) accounts, 0.4.0: Control → Accounts → an account → Family.
// Chip turns "Restricted" on for an account (one he made with Create an account for someone),
// then adds and removes its friends here. What a restricted account can't do is enforced by the
// server (friends/routes.ts, account/routes.ts, messages/routes.ts); see friends/rules.ts.

export const familyRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const publicUser = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarVersion: users.avatarVersion,
};

/** Their friends (for the Family card). */
async function friendsOf(userId: string) {
  const otherId = sql`case when ${friendships.userLow} = ${userId} then ${friendships.userHigh} else ${friendships.userLow} end`;
  return db
    .select({ ...publicUser, since: friendships.acceptedAt })
    .from(friendships)
    .innerJoin(users, eq(users.id, otherId))
    .where(
      and(
        or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)),
        eq(friendships.status, "accepted"),
      ),
    )
    .orderBy(users.displayName);
}

/**
 * Groups a restricted account is in where someone isn't their friend: they're taken out of them
 * (shown in the group as "left"). Returns the names of the groups.
 */
async function leaveGroupsWithStrangers(userId: string): Promise<string[]> {
  const groups = await db
    .select({ id: conversations.id, name: conversations.name })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, userId), eq(conversations.kind, "group")));
  const left: string[] = [];
  for (const g of groups) {
    const members = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, g.id));
    if (await groupBreaksRestriction(members.map((m) => m.userId))) {
      await removeGroupMember(g.id, userId, userId);
      left.push(g.name ?? "a group without a name");
    }
  }
  return left;
}

const groupsLine = (names: string[]) =>
  names.length ? ` They also left ${names.length === 1 ? `"${names[0]}"` : `${names.length} groups`} with people who aren't their friends.` : "";

// GET /admin/accounts/:id/family — is it restricted, and its friends.
familyRouter.get("/accounts/:id/family", async (req, res) => {
  const user = await target(res, req.params.id);
  if (!user) return;
  const [row] = await db.select({ restricted: users.restricted }).from(users).where(eq(users.id, user.id));
  res.json({ restricted: row?.restricted === true, friends: await friendsOf(user.id) });
});

// PUT /admin/accounts/:id/restricted  { restricted, note }
familyRouter.put("/accounts/:id/restricted", async (req, res) => {
  const parsed = z.object({ restricted: z.boolean(), note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const user = await target(res, req.params.id);
  if (!user) return;
  if (user.id === admin(res).userId) {
    res.status(400).json({ error: "invalid", message: "You can't restrict your own account." });
    return;
  }
  const on = parsed.data.restricted;
  await db.update(users).set({ restricted: on }).where(eq(users.id, user.id));

  let leftGroups: string[] = [];
  let cancelled = 0;
  if (on) {
    // 0.7.3: out of every constellation they joined (they're locked out of them anyway; this way
    // they're no longer listed as a member). Ones they own stay, for the admin to sort out.
    const joined = await db
      .select({ id: constellationMembers.constellationId, ownerId: constellations.ownerId })
      .from(constellationMembers)
      .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
      .where(eq(constellationMembers.userId, user.id));
    for (const c of joined) {
      if (c.ownerId === user.id) continue;
      await removeMember(c.id, user.id);
      emitToUser(user.id, "constellation:removed", { constellationId: c.id, reason: "kicked" }, true);
    }
    // Friend requests waiting either way, and invites they sent that nobody used yet, go away.
    const pending = await db
      .delete(friendships)
      .where(
        and(
          or(eq(friendships.userLow, user.id), eq(friendships.userHigh, user.id)),
          eq(friendships.status, "pending"),
        ),
      )
      .returning({ low: friendships.userLow, high: friendships.userHigh });
    cancelled = pending.length;
    for (const p of pending) emitToUser(p.low === user.id ? p.high : p.low, "friends:changed", {});
    await db.delete(friendInvites).where(and(eq(friendInvites.inviterId, user.id), isNull(friendInvites.acceptedAt)));
    leftGroups = await leaveGroupsWithStrangers(user.id);
  }
  // Their apps pick it up at once (Add friend hides or comes back).
  emitToUser(user.id, "account:changed", {});
  emitToUser(user.id, "friends:changed", {});

  await logAction({
    adminId: admin(res).id,
    action: on ? "Restricted an account" : "Lifted a restriction",
    targetUserId: user.id,
    targetLabel: `@${user.username}`,
    details: on ? { cancelledRequests: cancelled, leftGroups } : null,
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    restricted: on,
    message: on
      ? `@${user.username} is restricted: only you can add their friends now.${groupsLine(leftGroups)}`
      : `@${user.username} is a regular account again.`,
  });
});

/** The restricted account an action is about, or a 409 if it isn't restricted. */
async function restrictedTarget(res: Parameters<typeof target>[0], id: unknown) {
  const user = await target(res, id);
  if (!user) return null;
  const [row] = await db.select({ restricted: users.restricted }).from(users).where(eq(users.id, user.id));
  if (!row?.restricted) {
    res.status(409).json({ error: "not_restricted", message: "Turn on Restricted first. Regular accounts add their own friends." });
    return null;
  }
  return user;
}

// POST /admin/accounts/:id/friends  { username, note } — "Add a friend for them": friends at once.
// 0.8.2: for any account (it was family accounts only). Blocks still win.
familyRouter.post("/accounts/:id/friends", async (req, res) => {
  const parsed = z
    .object({ username: z.string({ error: "Enter their username." }).trim().min(1, "Enter their username.").max(40), note: noteSchema })
    .safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const kid = await target(res, req.params.id);
  if (!kid) return;
  const [friend] = await db
    .select({ ...publicUser, deleteAfter: users.deleteAfter, suspendedAt: users.suspendedAt })
    .from(users)
    .where(sql`lower(${users.username}) = ${parsed.data.username.replace(/^@/, "").toLowerCase()}`)
    .limit(1);
  if (!friend || friend.deleteAfter) {
    res.status(404).json({ error: "not_found", fields: { username: "No one has that username." } });
    return;
  }
  if (friend.id === kid.id) {
    res.status(400).json({ error: "invalid", fields: { username: "That's this account." } });
    return;
  }
  if (await blockedEitherWay(kid.id, friend.id)) {
    res.status(409).json({ error: "blocked", fields: { username: "One of them has blocked the other." } });
    return;
  }
  const [existing] = await db.select().from(friendships).where(pairIs(kid.id, friend.id)).limit(1);
  if (existing?.status === "accepted") {
    res.status(409).json({ error: "already_friends", fields: { username: "They're already friends." } });
    return;
  }
  const now = new Date();
  if (existing) {
    await db.update(friendships).set({ status: "accepted", acceptedAt: now }).where(eq(friendships.id, existing.id));
  } else {
    await db
      .insert(friendships)
      .values({ ...pair(kid.id, friend.id), requesterId: kid.id, status: "accepted", acceptedAt: now })
      .onConflictDoNothing();
  }
  for (const id of [kid.id, friend.id]) emitToUser(id, "friends:changed", {});
  await announcePresence(kid.id, emitToUser, true).catch(() => undefined);
  await announcePresence(friend.id, emitToUser, true).catch(() => undefined);
  await logAction({
    adminId: admin(res).id,
    action: "Added a friend for them",
    targetUserId: kid.id,
    targetLabel: `@${kid.username} + @${friend.username}`,
    details: { friendId: friend.id, friend: friend.username },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.status(201).json({ ok: true, message: `@${kid.username} and @${friend.username} are friends now.` });
});

// POST /admin/accounts/:id/friends/:friendId/remove  { note } — "Remove friend".
familyRouter.post("/accounts/:id/friends/:friendId/remove", async (req, res) => {
  const parsed = z.object({ note: noteSchema }).safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);
  const kid = await restrictedTarget(res, req.params.id);
  if (!kid) return;
  const friendId = req.params.friendId;
  if (typeof friendId !== "string" || !UUID.test(friendId)) {
    res.status(404).json({ error: "not_found", message: "They aren't friends any more." });
    return;
  }
  const removed = await db
    .delete(friendships)
    .where(and(pairIs(kid.id, friendId), eq(friendships.status, "accepted")))
    .returning({ id: friendships.id });
  if (!removed.length) {
    res.status(404).json({ error: "not_found", message: "They aren't friends any more." });
    return;
  }
  const [friend] = await db.select({ username: users.username }).from(users).where(eq(users.id, friendId));
  for (const id of [kid.id, friendId]) emitToUser(id, "friends:changed", {});
  await endCallsBetween(kid.id, friendId);
  await clearOnlineAlerts(kid.id, friendId);
  const leftGroups = await leaveGroupsWithStrangers(kid.id);
  await logAction({
    adminId: admin(res).id,
    action: "Removed a friend for them",
    targetUserId: kid.id,
    targetLabel: `@${kid.username} − @${friend?.username ?? "someone"}`,
    details: { friendId, friend: friend?.username ?? null, leftGroups },
    note: parsed.data.note,
    ip: ip(res),
  });
  res.json({
    ok: true,
    message: `@${kid.username} and @${friend?.username ?? "them"} aren't friends any more.${groupsLine(leftGroups)}`,
  });
});

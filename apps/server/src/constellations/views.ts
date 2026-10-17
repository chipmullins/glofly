import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  ALL_PERMISSIONS,
  isConstellationColor,
  isConstellationType,
  isPermission,
  isRoleColor,
  type ConstellationCard,
  type ConstellationDetail,
  type ConstellationRole,
  type DirectoryEntry,
  type NotifyLevel,
  type PublicUser,
} from "@glofly/shared";
import { db } from "../db";
import {
  constellationJoinRequests,
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  constellationCategories,
  conversationMembers,
  messages,
  nebulas,
  users,
} from "../db/schema";
import { friendIdsOf, presenceOf } from "../presence";
import { connectedUserIds } from "../realtime";
import { can, OWNER_RANK, standingOf, type Standing } from "./perms";
import { voiceStatesOf } from "./voice";

// What the apps get about constellations (2.0): dashboard cards, directory entries, and the whole
// constellation when it's open.

const userFields = { id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion };

export async function publicUsers(ids: string[]): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  if (!ids.length) return out;
  for (const u of await db.select(userFields).from(users).where(inArray(users.id, [...new Set(ids)]))) out.set(u.id, u);
  return out;
}

const notifyLevel = (x: string | null | undefined): NotifyLevel | null => (x === "all" || x === "mentions" || x === "none" ? x : null);
const colorOf = (x: string) => (isConstellationColor(x) ? x : "ember");

/** Unread and @mention counts per nebula conversation for one person. */
async function unreadFor(userId: string, conversationIds: string[]) {
  const out = new Map<string, { unread: number; mentions: number }>();
  if (!conversationIds.length) return out;
  const rows = await db
    .select({
      conversationId: messages.conversationId,
      count: sql<number>`count(*)::int`,
      mentions: sql<number>`count(*) filter (where ${userId}::uuid = any(${messages.mentions}))::int`,
    })
    .from(messages)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, userId)),
    )
    .where(
      and(
        inArray(messages.conversationId, conversationIds),
        ne(messages.senderId, userId),
        isNull(messages.event),
        isNull(messages.deletedAt),
        gt(messages.createdAt, conversationMembers.lastReadAt),
      ),
    )
    .groupBy(messages.conversationId);
  for (const r of rows) out.set(r.conversationId, { unread: r.count, mentions: r.mentions });
  return out;
}

/** How many of these people are online right now (connected and not invisible). */
async function onlineCount(userIds: string[]): Promise<number> {
  if (!userIds.length) return 0;
  const connected = await connectedUserIds(userIds);
  if (!connected.size) return 0;
  const invisible = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...connected]), eq(users.statusPreference, "invisible")));
  return connected.size - invisible.length;
}

/** My dashboard: every constellation I'm in. */
export async function cardsFor(userId: string): Promise<ConstellationCard[]> {
  const mine = await db
    .select({ c: constellations, position: constellationMembers.position, notify: constellationMembers.notify })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(and(eq(constellationMembers.userId, userId), isNull(constellations.takenDownAt)));
  if (!mine.length) return [];
  const ids = mine.map((m) => m.c.id);
  const members = await db
    .select({ constellationId: constellationMembers.constellationId, userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(inArray(constellationMembers.constellationId, ids));
  const allNebulas = await db
    .select({ id: nebulas.id, constellationId: nebulas.constellationId, conversationId: nebulas.conversationId, name: nebulas.name, kind: nebulas.kind })
    .from(nebulas)
    .where(inArray(nebulas.constellationId, ids));
  const unread = await unreadFor(userId, allNebulas.map((n) => n.conversationId));
  // My nebula notification settings: "none" nebulas don't count toward the card's "new".
  const settings = await db
    .select({ conversationId: conversationMembers.conversationId, level: conversationMembers.notifyLevel })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.userId, userId),
        allNebulas.length ? inArray(conversationMembers.conversationId, allNebulas.map((n) => n.conversationId)) : sql`false`,
      ),
    );
  const roles = await db
    .select({ id: constellationRoles.id, constellationId: constellationRoles.constellationId, kind: constellationRoles.kind, name: constellationRoles.name, color: constellationRoles.color, position: constellationRoles.position })
    .from(constellationRoles)
    .where(inArray(constellationRoles.constellationId, ids));
  const held = await db
    .select({ roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(eq(constellationMemberRoles.userId, userId));
  const heldIds = new Set(held.map((h) => h.roleId));
  const connected = await connectedUserIds([...new Set(members.map((m) => m.userId))]);

  const cards: ConstellationCard[] = [];
  for (const { c, position, notify } of mine) {
    const memberIds = members.filter((m) => m.constellationId === c.id).map((m) => m.userId);
    const myNebulas = allNebulas.filter((n) => n.constellationId === c.id);
    let unreadCount = 0;
    let mentionCount = 0;
    for (const n of myNebulas) {
      const u = unread.get(n.conversationId);
      if (!u) continue;
      const level = notifyLevel(settings.find((s) => s.conversationId === n.conversationId)?.level) ?? notifyLevel(notify) ?? "all";
      mentionCount += u.mentions;
      if (level === "all") unreadCount += u.unread;
    }
    // Your highest role
    const myRoles = roles.filter((r) => r.constellationId === c.id && (r.kind === "member" || heldIds.has(r.id)));
    const top = myRoles.sort((a, b) => b.position - a.position)[0];
    const role =
      c.ownerId === userId
        ? { name: "Owner", color: "ember" as const, owner: true }
        : { name: top?.name ?? "Member", color: top && isRoleColor(top.color) ? top.color : ("gray" as const), owner: false };
    cards.push({
      id: c.id,
      name: c.name,
      color: colorOf(c.color),
      iconVersion: c.iconVersion,
      memberCount: memberIds.length,
      onlineCount: memberIds.filter((id) => connected.has(id)).length,
      visibility: c.visibility,
      unreadCount,
      mentionCount,
      role,
      voice: null,
      lastMention: null,
      activityAt: c.lastActivityAt.toISOString(),
      position,
    });
  }

  // The busiest voice nebula on each card, and the latest mention of me.
  for (const card of cards) {
    const states = await voiceStatesOf(card.id);
    const busiest = states.filter((s) => s.userIds.length).sort((a, b) => b.userIds.length - a.userIds.length)[0];
    if (busiest) {
      const people = await publicUsers(busiest.userIds.slice(0, 3));
      card.voice = {
        nebulaName: allNebulas.find((n) => n.id === busiest.nebulaId)?.name ?? "",
        people: busiest.userIds.slice(0, 3).map((id) => people.get(id)!).filter(Boolean),
        live: busiest.live,
        total: busiest.userIds.length,
      };
    }
    if (card.mentionCount > 0) {
      const convIds = allNebulas.filter((n) => n.constellationId === card.id).map((n) => n.conversationId);
      const [m] = await db
        .select({ senderId: messages.senderId, conversationId: messages.conversationId })
        .from(messages)
        .where(and(inArray(messages.conversationId, convIds), sql`${userId}::uuid = any(${messages.mentions})`, isNull(messages.deletedAt)))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (m) {
        const by = (await publicUsers([m.senderId])).get(m.senderId);
        if (by) card.lastMention = { by, nebulaName: allNebulas.find((n) => n.conversationId === m.conversationId)?.name ?? "" };
      }
    }
  }
  // Never moved first (newest activity first), then the ones I dragged, in my order.
  return cards.sort((a, b) => {
    if (a.position === null && b.position === null) return b.activityAt.localeCompare(a.activityAt);
    if (a.position === null) return -1;
    if (b.position === null) return 1;
    return a.position - b.position;
  });
}

/** Directory entries / previews for some constellations, as `viewerId` sees them. */
export async function entriesFor(viewerId: string, ids: string[]): Promise<DirectoryEntry[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(constellations).where(and(inArray(constellations.id, ids), isNull(constellations.takenDownAt)));
  const members = await db
    .select({ constellationId: constellationMembers.constellationId, userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(inArray(constellationMembers.constellationId, ids));
  const requests = await db
    .select({ constellationId: constellationJoinRequests.constellationId })
    .from(constellationJoinRequests)
    .where(and(eq(constellationJoinRequests.userId, viewerId), inArray(constellationJoinRequests.constellationId, ids)));
  const friends = new Set(await friendIdsOf(viewerId));
  const connected = await connectedUserIds([...new Set(members.map((m) => m.userId))]);
  const friendIdsShown = new Set<string>();
  const byConstellation = new Map<string, string[]>();
  for (const r of rows) {
    const ids = members.filter((m) => m.constellationId === r.id).map((m) => m.userId);
    byConstellation.set(r.id, ids);
    for (const id of ids.filter((id) => friends.has(id)).slice(0, 3)) friendIdsShown.add(id);
  }
  const people = await publicUsers([...friendIdsShown]);
  const out: DirectoryEntry[] = rows.map((r) => {
    const memberIds = byConstellation.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      color: colorOf(r.color),
      iconVersion: r.iconVersion,
      memberCount: memberIds.length,
      onlineCount: memberIds.filter((id) => connected.has(id)).length,
      visibility: r.visibility,
      type: isConstellationType(r.type) ? r.type : null,
      tags: r.tags,
      friends: memberIds.filter((id) => friends.has(id)).slice(0, 3).map((id) => people.get(id)!).filter(Boolean),
      joined: memberIds.includes(viewerId),
      requested: requests.some((q) => q.constellationId === r.id),
    };
  });
  // Keep the order asked for.
  return ids.map((id) => out.find((e) => e.id === id)).filter((e): e is DirectoryEntry => !!e);
}

/** Everything about a constellation I'm in (null when I'm not). */
export async function detailFor(constellationId: string, userId: string): Promise<ConstellationDetail | null> {
  const standing = await standingOf(constellationId, userId);
  if (!standing) return null;
  return buildDetail(constellationId, userId, standing);
}

async function buildDetail(constellationId: string, userId: string, me: Standing): Promise<ConstellationDetail | null> {
  const [c] = await db.select().from(constellations).where(eq(constellations.id, constellationId));
  if (!c) return null;
  const categories = await db
    .select({ id: constellationCategories.id, name: constellationCategories.name, position: constellationCategories.position })
    .from(constellationCategories)
    .where(eq(constellationCategories.constellationId, constellationId))
    .orderBy(constellationCategories.position);
  const nebulaRows = await db.select().from(nebulas).where(eq(nebulas.constellationId, constellationId)).orderBy(nebulas.position);
  const unread = await unreadFor(userId, nebulaRows.map((n) => n.conversationId));
  const mySettings = nebulaRows.length
    ? await db
        .select({ conversationId: conversationMembers.conversationId, level: conversationMembers.notifyLevel })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, nebulaRows.map((n) => n.conversationId))))
    : [];
  const roleRows = await db.select().from(constellationRoles).where(eq(constellationRoles.constellationId, constellationId));
  const memberRows = await db
    .select({ userId: constellationMembers.userId, joinedAt: constellationMembers.joinedAt, timedOutUntil: constellationMembers.timedOutUntil, notify: constellationMembers.notify })
    .from(constellationMembers)
    .where(eq(constellationMembers.constellationId, constellationId));
  const assignments = await db
    .select({ userId: constellationMemberRoles.userId, roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(eq(constellationMemberRoles.constellationId, constellationId));
  const people = await publicUsers(memberRows.map((m) => m.userId));
  const presence = await presenceOf(memberRows.map((m) => m.userId));
  const now = Date.now();

  const roles: ConstellationRole[] = [
    {
      id: `owner:${constellationId}`,
      kind: "owner",
      name: "Owner",
      color: "ember",
      position: OWNER_RANK,
      permissions: [],
      memberCount: 1,
    },
    ...roleRows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        name: r.name,
        color: isRoleColor(r.color) ? r.color : ("gray" as const),
        position: r.position,
        permissions: r.permissions.filter(isPermission),
        memberCount: r.kind === "member" ? memberRows.length : assignments.filter((a) => a.roleId === r.id).length,
      }))
      .sort((a, b) => b.position - a.position),
  ];
  const myRow = memberRows.find((m) => m.userId === userId);
  const pendingRequests = can(me, "approveRequests")
    ? await db.$count(constellationJoinRequests, eq(constellationJoinRequests.constellationId, constellationId))
    : 0;

  return {
    id: c.id,
    name: c.name,
    description: c.description,
    color: colorOf(c.color),
    iconVersion: c.iconVersion,
    ownerId: c.ownerId,
    visibility: c.visibility,
    type: isConstellationType(c.type) ? c.type : null,
    tags: c.tags,
    createdAt: c.createdAt.toISOString(),
    categories,
    nebulas: nebulaRows.map((n) => ({
      id: n.id,
      kind: n.kind,
      name: n.name,
      topic: n.topic,
      categoryId: n.categoryId,
      position: n.position,
      conversationId: n.conversationId,
      readOnly: n.readOnly,
      unreadCount: unread.get(n.conversationId)?.unread ?? 0,
      mentionCount: unread.get(n.conversationId)?.mentions ?? 0,
      notify: notifyLevel(mySettings.find((s) => s.conversationId === n.conversationId)?.level),
    })),
    roles,
    members: memberRows
      .map((m) => {
        const p = presence.get(m.userId);
        return {
          user: people.get(m.userId)!,
          roleIds: assignments.filter((a) => a.userId === m.userId).map((a) => a.roleId),
          joinedAt: m.joinedAt.toISOString(),
          timedOutUntil: m.timedOutUntil && m.timedOutUntil.getTime() > now ? m.timedOutUntil.toISOString() : null,
          status: p?.status ?? "offline",
          // Only the game they're playing (custom statuses stay for friends).
          activity: p?.activity ? `Playing ${p.activity.name}` : null,
        };
      })
      .filter((m) => !!m.user),
    voice: await voiceStatesOf(constellationId),
    me: {
      owner: me.owner,
      permissions: me.owner ? [...ALL_PERMISSIONS] : [...me.permissions],
      rank: me.rank,
      timedOutUntil: me.timedOutUntil?.toISOString() ?? null,
      notify: notifyLevel(myRow?.notify) ?? "all",
    },
    pendingRequests,
  };
}

import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { forumSettingsOf, myOpenThreads } from "../threads/core";
import { inNebulaTimeline } from "../threads/timeline";
import { sharedWithByNebula } from "../integrations/readers";
import {
  ALL_PERMISSIONS,
  CHATTING_PEOPLE,
  CHATTING_WINDOW_MS,
  DEFAULT_WELCOME,
  isConstellationAccent,
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
  type WelcomeSettings,
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
import { voiceStatesFor, voiceStatesOf } from "./voice";
import { seesAllNebulas, unlocksFor, visibleChats } from "./access";

// What the apps get about constellations (2.0): dashboard cards, directory entries, and the whole
// constellation when it's open.

const userFields = { id: users.id, username: users.username, displayName: users.displayName, avatarVersion: users.avatarVersion };

export async function publicUsers(ids: string[]): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  if (!ids.length) return out;
  // Communities round: bots carry bot: true (the BOT tag); everyone else leaves it out.
  for (const { bot, ...u } of await db.select({ ...userFields, bot: users.bot }).from(users).where(inArray(users.id, [...new Set(ids)])))
    out.set(u.id, bot ? { ...u, bot: true, ...(u.username.startsWith("tool.") ? { tool: true } : {}) } : u);
  return out;
}

/** A mute that hasn't run out yet, as an ISO date. */
const activeMute = (d: Date | null | undefined): string | null => (d && d.getTime() > Date.now() ? d.toISOString() : null);
const notifyLevel = (x: string | null | undefined): NotifyLevel | null => (x === "all" || x === "mentions" || x === "none" ? x : null);
const colorOf = (x: string) => (isConstellationColor(x) ? x : "ember");
/** 0.7.5 identity fields every view carries. */
export const identityOf = (c: { accent: string | null; bannerVersion: string | null }) => ({
  accent: isConstellationAccent(c.accent) ? c.accent : null,
  bannerVersion: c.bannerVersion,
});
/** 0.7.5: a constellation's welcome settings (stored ones over the defaults). */
export function welcomeOf(raw: unknown): WelcomeSettings {
  const w = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof WelcomeSettings, unknown>>;
  const flag = (k: keyof WelcomeSettings) => (typeof w[k] === "boolean" ? (w[k] as boolean) : DEFAULT_WELCOME[k]);
  return { screen: flag("screen"), joinLines: flag("joinLines"), milestones: flag("milestones"), preview: flag("preview") };
}

/** Unread and @mention counts per nebula conversation for one person. */
export async function unreadFor(userId: string, conversationIds: string[]) {
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
        inNebulaTimeline(),
        gt(messages.createdAt, conversationMembers.lastReadAt),
      ),
    )
    .groupBy(messages.conversationId);
  for (const r of rows) out.set(r.conversationId, { unread: r.count, mentions: r.mentions });
  return out;
}

/** 0.7.5 living sky: how many different people posted in each of these nebulas in the last few minutes. */
export async function chattingIn(conversationIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!conversationIds.length) return out;
  const rows = await db
    .select({ conversationId: messages.conversationId, people: sql<number>`count(distinct ${messages.senderId})::int` })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, conversationIds),
        isNull(messages.event),
        isNull(messages.deletedAt),
        gt(messages.createdAt, new Date(Date.now() - CHATTING_WINDOW_MS)),
      ),
    )
    .groupBy(messages.conversationId);
  for (const r of rows) out.set(r.conversationId, r.people);
  return out;
}

/** Which of these people show as online right now: connected, and not set to invisible. */
async function visiblyOnline(userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const connected = await connectedUserIds(userIds);
  if (!connected.size) return connected;
  const invisible = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, [...connected]), eq(users.statusPreference, "invisible")));
  for (const r of invisible) connected.delete(r.id);
  return connected;
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
    .select({ id: nebulas.id, constellationId: nebulas.constellationId, conversationId: nebulas.conversationId, name: nebulas.name, kind: nebulas.kind, position: nebulas.position, categoryId: nebulas.categoryId })
    .from(nebulas)
    .where(inArray(nebulas.constellationId, ids))
    // 0.8.0: only the nebulas I can see (role-only ones need the role): no star, count or voice
    // face gives a hidden one away.
    .then(async (rows) => {
      const seen = await visibleChats(userId, rows.map((r) => r.conversationId));
      return rows.filter((r) => seen.has(r.conversationId));
    });
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
  const connected = await visiblyOnline([...new Set(members.map((m) => m.userId))]);

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
      ...identityOf(c),
    });
  }

  // The busiest voice nebula on each card, and the latest mention of me.
  const voiceByCard = await voiceStatesFor(cards.map((c) => c.id));
  // 0.7.5 living sky: each nebula as a star, in the sidebar's order (categories, then nebulas).
  const categoryRows = await db
    .select({ id: constellationCategories.id, position: constellationCategories.position })
    .from(constellationCategories)
    .where(inArray(constellationCategories.constellationId, ids));
  const categoryPosition = new Map(categoryRows.map((c) => [c.id, c.position]));
  const chatting = await chattingIn(allNebulas.filter((n) => n.kind === "text").map((n) => n.conversationId));
  for (const card of cards) {
    const states = (voiceByCard.get(card.id) ?? []).filter((s) => allNebulas.some((n) => n.id === s.nebulaId));
    const cardNotify = notifyLevel(mine.find((m) => m.c.id === card.id)?.notify) ?? "all";
    card.sky = allNebulas
      .filter((n) => n.constellationId === card.id)
      .sort((a, b) => {
        // Nebulas outside any category come first, like the sidebar.
        const ca = a.categoryId && categoryPosition.has(a.categoryId) ? categoryPosition.get(a.categoryId)! : -1;
        const cb = b.categoryId && categoryPosition.has(b.categoryId) ? categoryPosition.get(b.categoryId)! : -1;
        return ca - cb || a.position - b.position;
      })
      .map((n) => {
        const u = unread.get(n.conversationId);
        const level = notifyLevel(settings.find((s) => s.conversationId === n.conversationId)?.level) ?? cardNotify;
        return {
          kind: n.kind,
          news: n.kind === "text" && !!u && (u.mentions > 0 || (u.unread > 0 && level !== "none")),
          chatting: (chatting.get(n.conversationId) ?? 0) >= CHATTING_PEOPLE,
          voice: states.find((s) => s.nebulaId === n.id)?.userIds.length ?? 0,
        };
      });
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
  const connected = await visiblyOnline([...new Set(members.map((m) => m.userId))]);
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
      ...identityOf(r),
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
    .select({
      id: constellationCategories.id,
      name: constellationCategories.name,
      position: constellationCategories.position,
      visibility: constellationCategories.visibility,
      roleIds: constellationCategories.roleIds,
    })
    .from(constellationCategories)
    .where(eq(constellationCategories.constellationId, constellationId))
    .orderBy(constellationCategories.position);
  const allNebulaRows = await db.select().from(nebulas).where(eq(nebulas.constellationId, constellationId)).orderBy(nebulas.position);
  // 0.8.0 role-only nebulas: only the ones I can see (members of their conversation). People who
  // manage nebulas see all of them, with who each is for; a category whose nebulas are all hidden
  // from me (or that is itself role-only and not for me) isn't shown either.
  const seen = await visibleChats(userId, allNebulaRows.map((n) => n.conversationId));
  const nebulaRows = allNebulaRows.filter((n) => seen.has(n.conversationId));
  const manager = seesAllNebulas(me);
  const unread = await unreadFor(userId, nebulaRows.map((n) => n.conversationId));
  const chatting = await chattingIn(nebulaRows.filter((n) => n.kind === "text").map((n) => n.conversationId));
  const mySettings = nebulaRows.length
    ? await db
        .select({
          conversationId: conversationMembers.conversationId,
          level: conversationMembers.notifyLevel,
          mutedUntil: conversationMembers.mutedUntil,
          lastReadAt: conversationMembers.lastReadAt,
        })
        .from(conversationMembers)
        .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, nebulaRows.map((n) => n.conversationId))))
    : [];
  const roleRows = await db.select().from(constellationRoles).where(eq(constellationRoles.constellationId, constellationId));
  const memberRows = await db
    .select({
      userId: constellationMembers.userId,
      joinedAt: constellationMembers.joinedAt,
      timedOutUntil: constellationMembers.timedOutUntil,
      notify: constellationMembers.notify,
      welcomedAt: constellationMembers.welcomedAt,
      rulesAgreedAt: constellationMembers.rulesAgreedAt,
    })
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
        selfAssign: r.kind === "custom" && r.selfAssign,
      }))
      .sort((a, b) => b.position - a.position),
  ];
  const myRow = memberRows.find((m) => m.userId === userId);
  const sharedWith = await sharedWithByNebula(constellationId);
  // Communities round: my followed, still-open threads under each text nebula (the sidebar).
  const myThreads = await myOpenThreads(userId, nebulaRows.filter((n) => n.kind === "text").map((n) => n.id));
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
    categories: categories
      .filter((cat) => {
        if (manager) return true;
        if (cat.visibility === "roles" && !cat.roleIds.some((id) => me.roleIds.includes(id))) return false;
        const inside = allNebulaRows.filter((n) => n.categoryId === cat.id);
        return !inside.length || inside.some((n) => seen.has(n.conversationId));
      })
      .map((cat) => ({
        id: cat.id,
        name: cat.name,
        position: cat.position,
        ...(manager ? { visibility: cat.visibility === "roles" ? ("roles" as const) : ("everyone" as const), roleIds: cat.roleIds } : {}),
      })),
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
      mutedUntil: activeMute(mySettings.find((s) => s.conversationId === n.conversationId)?.mutedUntil),
      lastReadAt: mySettings.find((s) => s.conversationId === n.conversationId)?.lastReadAt?.toISOString() ?? null,
      chatting: chatting.get(n.conversationId) ?? 0,
      ...(manager ? { visibility: n.visibility === "roles" ? ("roles" as const) : ("everyone" as const), roleIds: n.roleIds } : {}),
      // Members always see when a bridge reads a nebula (communities round, messages:read).
      ...(sharedWith.get(n.id)?.length ? { sharedWith: sharedWith.get(n.id) } : {}),
      // Threads + forums
      ...(n.kind === "text" ? { threadsStaffOnly: n.threadsStaffOnly, threadCloseDays: n.threadCloseDays, threads: myThreads.filter((t) => t.nebulaId === n.id).slice(0, 5) } : {}),
      ...(n.kind === "forum" ? { threadCloseDays: n.threadCloseDays, forum: forumSettingsOf(n) } : {}),
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
          playing: p?.activity ? { name: p.activity.name, since: p.activity.since } : null,
          lastSeenAt: p?.lastSeenAt ?? null,
        };
      })
      .filter((m) => !!m.user),
    voice: (await voiceStatesOf(constellationId)).filter((v) => nebulaRows.some((n) => n.id === v.nebulaId)),
    me: {
      owner: me.owner,
      permissions: me.owner ? [...ALL_PERMISSIONS] : [...me.permissions],
      rank: me.rank,
      timedOutUntil: me.timedOutUntil?.toISOString() ?? null,
      notify: notifyLevel(myRow?.notify) ?? "all",
    },
    pendingRequests,
    ...identityOf(c),
    rules: c.rules,
    welcome: welcomeOf(c.welcome),
    welcomedAt: myRow?.welcomedAt?.toISOString() ?? null,
    rulesAgreedAt: myRow?.rulesAgreedAt?.toISOString() ?? null,
    unlocks: roleRows.some((r) => r.selfAssign && r.kind === "custom") ? Object.fromEntries(await unlocksFor(constellationId, userId)) : {},
  };
}

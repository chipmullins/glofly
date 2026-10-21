import { and, eq, inArray } from "drizzle-orm";
import { canSeeNebula, isPermission, nebulaLabel, type VisibilityGate } from "@glofly/shared";
import { db } from "../db";
import {
  constellationCategories,
  constellationMemberRoles,
  constellationMembers,
  constellationRoles,
  constellations,
  conversationMembers,
  nebulaPins,
  nebulas,
} from "../db/schema";
import type { Tx } from "../messages/routes";
import { removeFromChatCall } from "../calls/service";
import { emitToUser } from "../realtime";
import { can, type Standing } from "./perms";

// 0.8.0 role-only nebulas (approved RoleNebulas board). A nebula (or a whole category) can be
// "Only these roles": people without one of its roles don't know it's there. Roles members pick
// themselves count (they unlock nebulas) but still never give permissions. The Owner and anyone
// whose roles can manage nebulas always see everything. A nebula inside a role-only category needs
// one of the category's roles AND passes its own setting.
//
// The one place it's enforced: a nebula's conversation has exactly the people who can see it as
// members (`syncNebulaAccess` keeps it so whenever roles, permissions, members or settings change).
// Everything else follows from that: messages (fetch, send, react, edit: 404 without it), @mentions
// (only members can be mentioned), unread counts, Mentions, News, the Inbox, pushes, live events,
// typing, pins, voice rooms (joining a call needs the chat). Lists built from a constellation's
// members instead (the detail, dashboard cards, voice states, search, events) use `visibleChats`.

type Exec = typeof db | Tx;

/** Does this standing see every nebula (Owner, or roles that can manage nebulas)? */
export const seesAllNebulas = (s: Pick<Standing, "owner" | "permissions">): boolean => can(s as Standing, "manageNebulas");

/** Everything the rule needs about one constellation. */
async function rulesOf(constellationId: string, x: Exec = db) {
  const [c] = await x.select({ ownerId: constellations.ownerId }).from(constellations).where(eq(constellations.id, constellationId));
  const nebulaRows = await x
    .select({ id: nebulas.id, conversationId: nebulas.conversationId, categoryId: nebulas.categoryId, visibility: nebulas.visibility, roleIds: nebulas.roleIds })
    .from(nebulas)
    .where(eq(nebulas.constellationId, constellationId));
  const categoryRows = await x
    .select({ id: constellationCategories.id, visibility: constellationCategories.visibility, roleIds: constellationCategories.roleIds })
    .from(constellationCategories)
    .where(eq(constellationCategories.constellationId, constellationId));
  const roles = await x
    .select({ id: constellationRoles.id, kind: constellationRoles.kind, permissions: constellationRoles.permissions, selfAssign: constellationRoles.selfAssign })
    .from(constellationRoles)
    .where(eq(constellationRoles.constellationId, constellationId));
  const members = await x.select({ userId: constellationMembers.userId }).from(constellationMembers).where(eq(constellationMembers.constellationId, constellationId));
  const held = await x
    .select({ userId: constellationMemberRoles.userId, roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(eq(constellationMemberRoles.constellationId, constellationId));
  const heldBy = new Map<string, Set<string>>();
  for (const h of held) {
    const set = heldBy.get(h.userId) ?? new Set<string>();
    set.add(h.roleId);
    heldBy.set(h.userId, set);
  }
  // Same as perms.ts standingOf: Member is everyone's, self-picked roles never give permissions.
  const managing = (r: (typeof roles)[number]) => r.permissions.some((p) => isPermission(p) && p === "manageNebulas");
  const everyoneManages = roles.some((r) => r.kind === "member" && managing(r));
  const managerRoles = new Set(roles.filter((r) => r.kind !== "member" && !r.selfAssign && managing(r)).map((r) => r.id));
  const categories = new Map<string, VisibilityGate>(categoryRows.map((r) => [r.id, gateOf(r)]));
  return {
    ownerId: c?.ownerId ?? null,
    nebulas: nebulaRows,
    categories,
    memberIds: members.map((m) => m.userId),
    heldBy,
    seesAll: (userId: string) =>
      userId === c?.ownerId || everyoneManages || [...(heldBy.get(userId) ?? [])].some((id) => managerRoles.has(id)),
  };
}
type Rules = Awaited<ReturnType<typeof rulesOf>>;

const gateOf = (r: { visibility: string; roleIds: string[] }): VisibilityGate => ({
  visibility: r.visibility === "roles" ? "roles" : "everyone",
  roleIds: r.roleIds,
});

/** The nebulas (conversation ids) one person may see, by the rules. */
function visibleBy(rules: Rules, userId: string): Set<string> {
  const all = rules.seesAll(userId);
  const held = rules.heldBy.get(userId) ?? new Set<string>();
  const out = new Set<string>();
  for (const n of rules.nebulas) {
    const category = n.categoryId ? rules.categories.get(n.categoryId) : null;
    if (canSeeNebula(all, held, gateOf(n), category)) out.add(n.conversationId);
  }
  return out;
}

/** The nebula ids one person may see in a constellation (by the rules). */
export async function visibleNebulaIds(constellationId: string, userId: string, x: Exec = db): Promise<Set<string>> {
  const rules = await rulesOf(constellationId, x);
  const chats = visibleBy(rules, userId);
  return new Set(rules.nebulas.filter((n) => chats.has(n.conversationId)).map((n) => n.id));
}

/**
 * The nebula conversations someone is in (= can see), across some constellations or all of theirs.
 * The fast check every list uses (conversation membership is kept in step by syncNebulaAccess).
 */
export async function visibleChats(userId: string, conversationIds: string[]): Promise<Set<string>> {
  if (!conversationIds.length) return new Set();
  const rows = await db
    .select({ id: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, conversationIds)));
  return new Set(rows.map((r) => r.id));
}

/** Can this person see this nebula (its conversation)? */
export async function seesNebulaChat(userId: string, conversationId: string): Promise<boolean> {
  return (await visibleChats(userId, [conversationId])).has(conversationId);
}

/** Who can see a nebula right now (its conversation's members). */
export async function viewersOf(conversationId: string): Promise<string[]> {
  const rows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

export type AccessChange = { userId: string; gained: string[]; lost: string[] };

/**
 * Puts each member in exactly the nebula conversations they may see (all members, or just
 * `userIds`). Newly visible nebulas start read (no wall of unread). Inside a transaction, the
 * caller handles what happens after (`afterAccessChange`); otherwise it's done here.
 */
export async function syncNebulaAccess(constellationId: string, opts: { userIds?: string[]; tx?: Tx } = {}): Promise<AccessChange[]> {
  const x = opts.tx ?? db;
  const rules = await rulesOf(constellationId, x);
  const userIds = (opts.userIds ?? rules.memberIds).filter((id) => rules.memberIds.includes(id));
  const chatIds = rules.nebulas.map((n) => n.conversationId);
  if (!userIds.length || !chatIds.length) return [];
  const rows = await x
    .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(inArray(conversationMembers.conversationId, chatIds), inArray(conversationMembers.userId, userIds)));
  const now = new Date();
  const changes: AccessChange[] = [];
  for (const userId of userIds) {
    const want = visibleBy(rules, userId);
    const have = new Set(rows.filter((r) => r.userId === userId).map((r) => r.conversationId));
    const gained = [...want].filter((id) => !have.has(id));
    const lost = [...have].filter((id) => !want.has(id));
    if (gained.length) {
      await x
        .insert(conversationMembers)
        .values(gained.map((conversationId) => ({ conversationId, userId, lastReadAt: now, joinedAt: now })))
        .onConflictDoNothing();
    }
    if (lost.length) {
      await x.delete(conversationMembers).where(and(eq(conversationMembers.userId, userId), inArray(conversationMembers.conversationId, lost)));
      const lostNebulas = rules.nebulas.filter((n) => lost.includes(n.conversationId)).map((n) => n.id);
      await x.delete(nebulaPins).where(and(eq(nebulaPins.userId, userId), inArray(nebulaPins.nebulaId, lostNebulas)));
    }
    if (gained.length || lost.length) changes.push({ userId, gained, lost });
  }
  if (!opts.tx) await afterAccessChange(constellationId, changes);
  return changes;
}

/**
 * After access changed (committed): anyone in a voice nebula they can't see any more is taken out
 * of it, and everyone affected reloads the constellation and their dashboard.
 */
export async function afterAccessChange(constellationId: string, changes: AccessChange[]): Promise<void> {
  for (const ch of changes) {
    for (const conversationId of ch.lost) await removeFromChatCall(conversationId, ch.userId).catch(() => undefined);
    emitToUser(ch.userId, "constellation:updated", { constellationId }, true);
    emitToUser(ch.userId, "constellations:changed", {}, true);
    emitToUser(ch.userId, "inbox:changed", {}, true);
  }
}

/**
 * For the welcome's "You'll see: #valorant, #minecraft": per role members can pick themselves,
 * the role-only nebulas picking it would show this person (that they can't see yet).
 */
export async function unlocksFor(constellationId: string, userId: string): Promise<Map<string, string[]>> {
  const rules = await rulesOf(constellationId);
  const out = new Map<string, string[]>();
  if (rules.seesAll(userId)) return out;
  const pickable = await db
    .select({ id: constellationRoles.id })
    .from(constellationRoles)
    .where(and(eq(constellationRoles.constellationId, constellationId), eq(constellationRoles.selfAssign, true), eq(constellationRoles.kind, "custom")));
  if (!pickable.length) return out;
  const names = await db
    .select({ id: nebulas.id, name: nebulas.name, kind: nebulas.kind, position: nebulas.position, conversationId: nebulas.conversationId })
    .from(nebulas)
    .where(eq(nebulas.constellationId, constellationId))
    .orderBy(nebulas.position);
  // Measured from the roles they didn't pick themselves (so a role they already picked still
  // lists what it shows them, as in "Your roles").
  const pickableIds = new Set(pickable.map((p) => p.id));
  const base = new Set([...(rules.heldBy.get(userId) ?? [])].filter((id) => !pickableIds.has(id)));
  const sees = (held: Set<string>, n: (typeof rules.nebulas)[number]) =>
    canSeeNebula(false, held, gateOf(n), n.categoryId ? rules.categories.get(n.categoryId) : null);
  for (const role of pickable) {
    const withIt = new Set([...base, role.id]);
    const shown: string[] = [];
    for (const n of names) {
      const r = rules.nebulas.find((x) => x.id === n.id)!;
      if (!sees(base, r) && sees(withIt, r)) shown.push(nebulaLabel(n));
    }
    if (shown.length) out.set(role.id, shown);
  }
  return out;
}

/** Is this nebula visible to every member (no role gate on it or its category)? */
export async function openToEveryone(nebulaId: string): Promise<boolean> {
  const [row] = await db
    .select({ visibility: nebulas.visibility, categoryVisibility: constellationCategories.visibility })
    .from(nebulas)
    .leftJoin(constellationCategories, eq(constellationCategories.id, nebulas.categoryId))
    .where(eq(nebulas.id, nebulaId));
  return !!row && row.visibility !== "roles" && row.categoryVisibility !== "roles";
}

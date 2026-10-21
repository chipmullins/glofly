import { and, eq, inArray } from "drizzle-orm";
import { isPermission, type ConstellationPermission } from "@glofly/shared";
import { db } from "../db";
import { constellationMemberRoles, constellationMembers, constellationRoles, constellations, conversationMembers } from "../db/schema";
import { nebulaOfChat } from "./chats";

// Who may do what in a constellation (2.0). Every action is checked here on the server:
// the Owner can do everything; everyone else gets everything their roles allow (the Member role
// is everyone's). Only people ranked higher can act on someone (kick, time out, change roles).

/** The Owner's rank: above every role. */
export const OWNER_RANK = 1_000_000_000;

export type Standing = {
  constellationId: string;
  userId: string;
  ownerId: string;
  owner: boolean;
  /** Their roles' ids (not including Member) */
  roleIds: string[];
  permissions: Set<ConstellationPermission>;
  /** Their highest role's position (Member = 0, Owner = OWNER_RANK) */
  rank: number;
  timedOutUntil: Date | null;
};

/** Where someone stands in a constellation, or null if they aren't in it (or it's gone). */
export async function standingOf(constellationId: string, userId: string): Promise<Standing | null> {
  const [row] = await db
    .select({
      ownerId: constellations.ownerId,
      takenDownAt: constellations.takenDownAt,
      timedOutUntil: constellationMembers.timedOutUntil,
    })
    .from(constellationMembers)
    .innerJoin(constellations, eq(constellations.id, constellationMembers.constellationId))
    .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
  if (!row || row.takenDownAt) return null;
  const roles = await db
    .select({
      id: constellationRoles.id,
      kind: constellationRoles.kind,
      position: constellationRoles.position,
      permissions: constellationRoles.permissions,
      selfAssign: constellationRoles.selfAssign,
    })
    .from(constellationRoles)
    .where(eq(constellationRoles.constellationId, constellationId));
  const held = await db
    .select({ roleId: constellationMemberRoles.roleId })
    .from(constellationMemberRoles)
    .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)));
  const heldIds = new Set(held.map((h) => h.roleId));
  // 0.7.5: roles members pick themselves ("What do you play?") are labels only: they never give
  // permissions or rank, whatever is stored on them.
  const mine = roles.filter((r) => r.kind === "member" || (heldIds.has(r.id) && !r.selfAssign));
  const owner = row.ownerId === userId;
  const permissions = new Set<ConstellationPermission>();
  for (const r of mine) for (const p of r.permissions) if (isPermission(p)) permissions.add(p);
  const timedOut = row.timedOutUntil && row.timedOutUntil.getTime() > Date.now() && !owner ? row.timedOutUntil : null;
  return {
    constellationId,
    userId,
    ownerId: row.ownerId,
    owner,
    roleIds: [...heldIds],
    permissions,
    rank: owner ? OWNER_RANK : Math.max(0, ...mine.map((r) => r.position)),
    timedOutUntil: timedOut,
  };
}

export const can = (s: Standing, permission: ConstellationPermission): boolean => s.owner || s.permissions.has(permission);

/** Can `actor` act on `target` (kick, time out, change their roles)? Only on people ranked lower. */
export const outranks = (actor: Standing, target: Standing): boolean =>
  actor.userId !== target.userId && !target.owner && (actor.owner || actor.rank > target.rank);

/** Ranks of several members (for the member list's "can I act on them"). */
export async function ranksOf(constellationId: string, userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!userIds.length) return out;
  const rows = await db
    .select({ userId: constellationMemberRoles.userId, position: constellationRoles.position })
    .from(constellationMemberRoles)
    .innerJoin(constellationRoles, eq(constellationRoles.id, constellationMemberRoles.roleId))
    .where(
      and(
        eq(constellationMemberRoles.constellationId, constellationId),
        inArray(constellationMemberRoles.userId, userIds),
        eq(constellationRoles.selfAssign, false),
      ),
    );
  for (const r of rows) out.set(r.userId, Math.max(out.get(r.userId) ?? 0, r.position));
  return out;
}

// ───────────── Nebula chats (used by messages/routes.ts) ─────────────

/** 0.8.0: can I see this nebula (role-only ones)? Its conversation's members are who can. */
async function seesChat(conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  return !!row;
}

/** Can I post in this nebula right now? Not timed out, and for read-only nebulas, a moderator. */
export async function canPostInNebula(conversationId: string, userId: string): Promise<boolean> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula || !(await seesChat(conversationId, userId))) return false;
  const s = await standingOf(nebula.constellationId, userId);
  if (!s || s.timedOutUntil) return false;
  if (nebula.readOnly && !can(s, "manageNebulas") && !can(s, "deleteMessages")) return false;
  return true;
}

/** Why I can't post (for the app's message), or null when I can. */
export async function whyCantPostInNebula(conversationId: string, userId: string): Promise<string | null> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula || !(await seesChat(conversationId, userId))) return "This nebula isn't available.";
  const s = await standingOf(nebula.constellationId, userId);
  if (!s) return "You're not in this constellation.";
  if (s.timedOutUntil) return "You're timed out for now, so you can read but not post.";
  if (nebula.readOnly && !can(s, "manageNebulas") && !can(s, "deleteMessages")) return "Only moderators can post here.";
  return null;
}

/**
 * Can I delete this person's message in this nebula? Needs "Delete messages", and they must rank
 * below me (or have left): a Moderator can't delete an Admin's or the Owner's messages.
 */
export async function canModerateNebula(
  conversationId: string,
  userId: string,
  senderId: string,
): Promise<{ constellationId: string } | null> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return null;
  const s = await standingOf(nebula.constellationId, userId);
  if (!s || !can(s, "deleteMessages")) return null;
  const sender = await standingOf(nebula.constellationId, senderId);
  if (sender && !outranks(s, sender)) return null;
  return { constellationId: nebula.constellationId };
}

/** A nebula's chat can be used (its constellation hasn't been taken down in Control). */
export async function nebulaChatOpen(conversationId: string): Promise<boolean> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return false;
  const [c] = await db
    .select({ takenDownAt: constellations.takenDownAt })
    .from(constellations)
    .where(eq(constellations.id, nebula.constellationId));
  return !!c && !c.takenDownAt;
}

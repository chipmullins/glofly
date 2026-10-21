import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { constellationAuditLog, constellationMembers, constellations, conversationMembers, users } from "../db/schema";
import { emitToUser } from "../realtime";
import { nebulaOfChat } from "./chats";

/** Who can see a nebula (its conversation's members; role-only nebulas, 0.8.0). */
async function viewersOf(conversationId: string): Promise<string[]> {
  const rows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  return rows.map((r) => r.userId);
}

// Live news about constellations (2.0). Everything goes to newer apps only (modernOnly).

/** Everyone in a constellation. */
export async function memberIdsOf(constellationId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(eq(constellationMembers.constellationId, constellationId));
  return rows.map((r) => r.userId);
}

/** Tells everyone in a constellation (all their newer devices). */
export async function tellMembers(constellationId: string, event: string, payload: unknown, also: string[] = []): Promise<void> {
  for (const userId of new Set([...(await memberIdsOf(constellationId)), ...also])) emitToUser(userId, event, payload, true);
}

/** What a new message in a nebula should do for someone: ding + notify, or nothing. */
export type NebulaAlert = "message" | "mention" | null;

/**
 * Someone's notification setting for a nebula and whether it's muted right now decide the alert:
 * "Only @mentions" and a timed mute let @mentions through (like a muted Glofly chat); "Nothing"
 * stays silent even then.
 */
export function alertFor(level: string, mutedUntil: Date | null, mentioned: boolean, now = Date.now()): NebulaAlert {
  if (level === "none") return null;
  if (mentioned) return "mention";
  if (level === "mentions") return null;
  return mutedUntil && mutedUntil.getTime() > now ? null : "message";
}

/**
 * Something was posted in a nebula: the constellation counts as active now, and every member's
 * dashboard and icon strip refresh its unread counts (`constellation:activity`). For a real
 * message (`preview` given), each member also learns whether it should ding and notify them
 * (`alert`), with what to show.
 */
export async function nebulaActivity(
  conversationId: string,
  senderId: string,
  at: Date,
  mentions: string[],
  preview?: string,
): Promise<void> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return;
  const [c] = await db
    .update(constellations)
    .set({ lastActivityAt: at })
    .where(eq(constellations.id, nebula.constellationId))
    .returning({ name: constellations.name });
  const base = { constellationId: nebula.constellationId, nebulaId: nebula.id, conversationId, senderId, mentions };
  if (preview === undefined) {
    // 0.8.0: only people who can see it (role-only nebulas): its conversation's members.
    for (const userId of await viewersOf(conversationId)) emitToUser(userId, "constellation:activity", base, true);
    return;
  }
  const settings = await db
    .select({
      userId: constellationMembers.userId,
      defaultLevel: constellationMembers.notify,
      level: conversationMembers.notifyLevel,
      mutedUntil: conversationMembers.mutedUntil,
    })
    .from(constellationMembers)
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.userId, constellationMembers.userId), eq(conversationMembers.conversationId, conversationId)),
    )
    .where(eq(constellationMembers.constellationId, nebula.constellationId));
  const [sender] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, senderId));
  const now = Date.now();
  for (const s of settings) {
    const alert = s.userId === senderId ? null : alertFor(s.level ?? s.defaultLevel, s.mutedUntil, mentions.includes(s.userId), now);
    emitToUser(
      s.userId,
      "constellation:activity",
      alert
        ? { ...base, alert, nebulaName: nebula.name, constellationName: c?.name ?? "", senderName: sender?.name ?? "Someone", preview }
        : { ...base, alert: null },
      true,
    );
  }
}

/** The constellation changed (nebulas, roles, members, settings): its members reload it. */
export async function constellationChanged(constellationId: string, also: string[] = []): Promise<void> {
  await tellMembers(constellationId, "constellation:updated", { constellationId }, also);
}

/** Settings → Moderation: what moderators and admins did. */
export async function logModeration(
  constellationId: string,
  actorId: string | null,
  action: string,
  targetUserId: string | null,
  details: Record<string, unknown> | null = null,
): Promise<void> {
  await db.insert(constellationAuditLog).values({ constellationId, actorId, action, targetUserId, details });
}

import { eq } from "drizzle-orm";
import { db } from "../db";
import { constellationAuditLog, constellationMembers, constellations } from "../db/schema";
import { emitToUser } from "../realtime";
import { nebulaOfChat } from "./chats";

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

/**
 * Something was posted in a nebula: the constellation counts as active now, and every member's
 * dashboard and icon strip refresh its unread counts (`constellation:activity`).
 */
export async function nebulaActivity(conversationId: string, senderId: string, at: Date, mentions: string[]): Promise<void> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return;
  await db.update(constellations).set({ lastActivityAt: at }).where(eq(constellations.id, nebula.constellationId));
  await tellMembers(nebula.constellationId, "constellation:activity", {
    constellationId: nebula.constellationId,
    nebulaId: nebula.id,
    conversationId,
    senderId,
    mentions,
  });
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

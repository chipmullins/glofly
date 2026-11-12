import { and, eq, inArray, isNull } from "drizzle-orm";
import { dropFromStages } from "../stages/state";
import { CONSTELLATION_MEMBERS_MAX, CONSTELLATIONS_JOINED_MAX } from "@glofly/shared";
import { db } from "../db";
import type { Tx } from "../messages/routes";
import {
  attachments,
  constellationInvites,
  constellationJoinRequests,
  constellationMemberRoles,
  constellationMembers,
  constellations,
  conversationMembers,
  nebulas,
} from "../db/schema";
import { removeFiles } from "../messages/attachments";
import { removeFromChatCall } from "../calls/service";
import { emitToUser } from "../realtime";
import { constellationChanged } from "./activity";
import { celebrateJoin } from "./community";
import { fireConstellationEvent } from "../integrations/events";
import { toolHook } from "../toolHooks";
import { syncNebulaAccess } from "./access";

// Joining and leaving (2.0). A constellation's members are also members of each of its nebulas'
// conversations (so every chat feature works there); these keep the two in step.

export class ConstellationFull extends Error {}
export class TooManyConstellations extends Error {}

/**
 * Adds someone (inside a transaction that locked the constellation row). `welcomed`: they don't
 * need the welcome screen (the Owner who just made it).
 */
export async function addMember(tx: Tx, constellationId: string, userId: string, opts: { welcomed?: boolean } = {}): Promise<boolean> {
  const [already] = await tx
    .select({ userId: constellationMembers.userId })
    .from(constellationMembers)
    .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)));
  if (already) return false;
  const count = await tx.$count(constellationMembers, eq(constellationMembers.constellationId, constellationId));
  if (count >= CONSTELLATION_MEMBERS_MAX) throw new ConstellationFull();
  const mine = await tx.$count(constellationMembers, eq(constellationMembers.userId, userId));
  if (mine >= CONSTELLATIONS_JOINED_MAX) throw new TooManyConstellations();
  const now = new Date();
  await tx.insert(constellationMembers).values({ constellationId, userId, joinedAt: now, welcomedAt: opts.welcomed ? now : null });
  // 0.8.0: only the nebulas they may see (role-only ones need the role). Everything already there
  // counts as read (a newcomer doesn't start with 500 unread).
  await syncNebulaAccess(constellationId, { userIds: [userId], tx });
  // Joined: their invites and request for it are done.
  await tx
    .delete(constellationInvites)
    .where(and(eq(constellationInvites.constellationId, constellationId), eq(constellationInvites.inviteeId, userId)));
  await tx
    .delete(constellationJoinRequests)
    .where(and(eq(constellationJoinRequests.constellationId, constellationId), eq(constellationJoinRequests.userId, userId)));
  return true;
}

/** After someone joined: everyone sees them, and their dashboard gets the new card. */
export async function afterJoin(constellationId: string, userId: string): Promise<void> {
  await constellationChanged(constellationId);
  // Communities round: outgoing webhooks (Integrations).
  fireConstellationEvent(constellationId, "member.joined", userId);
  // Communities round: Glofly tools (welcome message, logging). Loaded when needed: no import cycle.
  toolHook("onJoin", constellationId, userId);
  emitToUser(userId, "constellations:changed", {}, true);
  // 0.7.5: "Priya joined. Say hi!" and member milestones (never stops the join if it fails).
  await celebrateJoin(constellationId, userId).catch((err) => console.error("Join line failed", err));
}

/**
 * Takes someone out (they left, were kicked or banned, or their account is going): out of every
 * nebula, its voice rooms and roles. Their messages stay.
 */
export async function removeMember(constellationId: string, userId: string): Promise<boolean> {
  const chats = await db.select({ id: nebulas.conversationId }).from(nebulas).where(eq(nebulas.constellationId, constellationId));
  const chatIds = chats.map((c) => c.id);
  const removed = await db.transaction(async (tx) => {
    const gone = await tx
      .delete(constellationMembers)
      .where(and(eq(constellationMembers.constellationId, constellationId), eq(constellationMembers.userId, userId)))
      .returning({ userId: constellationMembers.userId });
    if (!gone.length) return null;
    await tx
      .delete(constellationMemberRoles)
      .where(and(eq(constellationMemberRoles.constellationId, constellationId), eq(constellationMemberRoles.userId, userId)));
    if (chatIds.length) {
      await tx
        .delete(conversationMembers)
        .where(and(inArray(conversationMembers.conversationId, chatIds), eq(conversationMembers.userId, userId)));
      // Files they added but never sent there.
      return tx
        .delete(attachments)
        .where(and(inArray(attachments.conversationId, chatIds), eq(attachments.uploaderId, userId), isNull(attachments.messageId)))
        .returning({ id: attachments.id, conversationId: attachments.conversationId, kind: attachments.kind });
    }
    return [];
  });
  if (removed === null) return false;
  await removeFiles(removed);
  for (const id of chatIds) await removeFromChatCall(id, userId);
  // Communities round 2: off any live stage too.
  await dropFromStages(constellationId, userId);
  fireConstellationEvent(constellationId, "member.left", userId);
  toolHook("onLeave", constellationId, userId);
  await constellationChanged(constellationId, [userId]);
  emitToUser(userId, "constellations:changed", {}, true);
  return true;
}

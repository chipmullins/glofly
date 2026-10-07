import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "../db";
import { attachments, conversationMembers, conversations, sessions, users } from "../db/schema";
import { chatPartnersOf } from "../friends/routes";
import { announcePresence, friendIdsOf } from "../presence";
import { disconnectSessions, emitToUser } from "../realtime";
import { removeFiles } from "../messages/attachments";
import { storage } from "../storage";

// Deleting an account is a two-step thing, like the design says: "You'll have 30 days to
// change your mind." The account is hidden right away and every device is signed out;
// logging in again within 30 days offers to restore it. After that it's removed for good.

export const DELETION_GRACE_DAYS = 30;

/** Tells everyone connected to this person to refresh, so they disappear (or reappear). */
async function tellFriendsAndChats(userId: string, friends: string[], partners: string[]) {
  for (const id of friends) emitToUser(id, "friends:changed", {});
  for (const id of partners) emitToUser(id, "conversations:changed", {});
}

/** Hides the account, signs out every device, and sets the date it will be removed. */
export async function scheduleDeletion(userId: string): Promise<Date> {
  const deleteAfter = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  await db.update(users).set({ deleteAfter }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await disconnectSessions(userId);
  await announcePresence(userId, emitToUser, true);
  await tellFriendsAndChats(userId, await friendIdsOf(userId), await chatPartnersOf(userId));
  return deleteAfter;
}

/** Changed their mind: the account comes back exactly as it was. */
export async function cancelDeletion(userId: string): Promise<void> {
  await db.update(users).set({ deleteAfter: null }).where(eq(users.id, userId));
  await tellFriendsAndChats(userId, await friendIdsOf(userId), await chatPartnersOf(userId));
}

/**
 * Removes accounts whose 30 days are up: their profile, photo, friends, blocks, and their
 * direct-message chats (both sides, with every message and file in them).
 */
export async function purgeDeletedAccounts(): Promise<void> {
  const due = await db
    .select({ id: users.id, avatarVersion: users.avatarVersion })
    .from(users)
    .where(and(isNotNull(users.deleteAfter), lt(users.deleteAfter, new Date())));

  for (const user of due) {
    const friends = await friendIdsOf(user.id);
    const partners = await chatPartnersOf(user.id);

    // Their direct messages (group chats, later, will just lose them as a member).
    const dms = await db
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(conversationMembers, eq(conversationMembers.conversationId, conversations.id))
      .where(and(eq(conversationMembers.userId, user.id), isNotNull(conversations.dmKey)));
    const dmIds = dms.map((c) => c.id);
    const files = dmIds.length
      ? await db
          .select({
            id: attachments.id,
            conversationId: attachments.conversationId,
            kind: attachments.kind,
          })
          .from(attachments)
          .where(inArray(attachments.conversationId, dmIds))
      : [];

    await db.transaction(async (tx) => {
      if (dmIds.length) await tx.delete(conversations).where(inArray(conversations.id, dmIds));
      // Everything else of theirs goes with the account (the database cascades it).
      await tx.delete(users).where(eq(users.id, user.id));
    });

    await removeFiles(files);
    if (user.avatarVersion) {
      await storage
        .remove(`avatars/${user.id}/${user.avatarVersion}.webp`)
        .catch((err) => console.error("Couldn't remove a profile photo", err));
    }
    await tellFriendsAndChats(user.id, friends, partners);
    console.log(`Removed an account at the end of its ${DELETION_GRACE_DAYS} days.`);
  }
}

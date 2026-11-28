import { sql, type SQL } from "drizzle-orm";
import { messages } from "../db/schema";

// 0.12.0 "Clear chat (just for you)". conversation_members.cleared_at hides everything at or before
// it from that one person. The server filters for every app version, so an older app opens a cleared
// chat empty too. Messages are never deleted and nobody else's view changes.

/** Messages `userId` hasn't cleared (use wherever a person's own view of messages is read). */
export function notClearedBy(userId: string): SQL {
  return sql`not exists (select 1 from conversation_members cm where cm.conversation_id = ${messages.conversationId} and cm.user_id = ${userId}::uuid and cm.cleared_at is not null and ${messages.createdAt} <= cm.cleared_at)`;
}

/** How long after clearing Undo still works. */
export const CLEAR_UNDO_MS = 10 * 60 * 1000;

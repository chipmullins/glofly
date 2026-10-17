import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { conversationMembers, messages } from "../db/schema";
import { removeMessageForGood, sendUpdated } from "./routes";

// Lantern messages (0.5.0): a message that fades away after it's been read. Once everyone else in
// the chat has read it (their read position is past it, whether or not they share read receipts),
// it glows for 15 more seconds (everyone sees it fading), then it's deleted for good like any
// deleted message. Older apps see a normal message until then, then "Message deleted".

const FADE_MS = 15_000;
// The partial index messages_lantern_idx keeps this cheap: only lanterns still glowing.
const BATCH = 200;

export async function sweepLanterns(): Promise<void> {
  const now = new Date();
  // Lanterns whose fade is over: gone for good.
  const faded = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.lantern, true), isNull(messages.deletedAt), lte(messages.lanternFadeAt, now)))
    .limit(BATCH);
  for (const m of faded) await removeMessageForGood(m.id);

  // Lanterns everyone else has now read: start fading. (Checked in the database, so a pile of
  // unread lanterns in one chat never holds up the others.)
  const read = await db
    .select({ id: messages.id, conversationId: messages.conversationId })
    .from(messages)
    .where(
      and(
        eq(messages.lantern, true),
        isNull(messages.deletedAt),
        isNull(messages.lanternFadeAt),
        sql`exists (select 1 from ${conversationMembers} cm where cm.conversation_id = ${messages.conversationId} and cm.user_id <> ${messages.senderId})`,
        sql`not exists (select 1 from ${conversationMembers} cm where cm.conversation_id = ${messages.conversationId} and cm.user_id <> ${messages.senderId} and cm.last_read_at < ${messages.createdAt})`,
      ),
    )
    .limit(BATCH);
  for (const m of read) {
    await db.update(messages).set({ lanternFadeAt: new Date(now.getTime() + FADE_MS) }).where(eq(messages.id, m.id));
    await sendUpdated(m.id, m.conversationId);
  }
}

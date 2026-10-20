import { eq } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";
import { storage } from "../storage";
import { noteRedisError, takeSlot } from "../rateLimit";
import { firstLink, previewFor, previewImageKey, savePreviewImage } from "./links";

// Link previews (0.5.0): made in the background after a message is sent (or edited), then
// everyone gets the message again with its card (message:updated). See links.ts for the fetching.

const LINKS_PER_MINUTE = 30;
const PER_PERSON_PER_MINUTE = 6;

// 0.8.0: counted in Redis (shared by every server process, kept through restarts). If Redis
// can't be reached, the counts fall back to this server's memory, as before.
let recent: number[] = [];
const bySender = new Map<string, number[]>();

/** Room for one more preview this minute (server-wide and for this person)? Takes it if so. */
async function previewSlot(senderId: string | undefined): Promise<boolean> {
  const slots = [{ key: "rl:previews:all", limit: LINKS_PER_MINUTE }];
  if (senderId) slots.push({ key: `rl:previews:sender:${senderId}`, limit: PER_PERSON_PER_MINUTE });
  try {
    return await takeSlot(60_000, slots);
  } catch (err) {
    noteRedisError(err);
    return memorySlot(senderId);
  }
}

function memorySlot(senderId: string | undefined): boolean {
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= LINKS_PER_MINUTE) return false;
  if (senderId) {
    const mine = (bySender.get(senderId) ?? []).filter((t) => now - t < 60_000);
    if (mine.length >= PER_PERSON_PER_MINUTE) return false;
    mine.push(now);
    bySender.set(senderId, mine);
    if (bySender.size > 5000) bySender.clear(); // never grows without end
  }
  recent.push(now);
  return true;
}

export async function addLinkPreview(messageId: string, conversationId: string, text: string, senderId?: string): Promise<void> {
  const link = firstLink(text);
  if (!link) return;
  // The whole server makes at most this many previews a minute, and one person only a few of
  // them (a flood of links just goes without previews).
  if (!(await previewSlot(senderId))) return;

  const found = await previewFor(link);
  if (!found) return;
  // Still there, with the same link?
  const [row] = await db
    .select({ body: messages.body, deletedAt: messages.deletedAt })
    .from(messages)
    .where(eq(messages.id, messageId));
  if (!row || row.deletedAt || firstLink(row.body) !== link) return;
  if (found.image) await savePreviewImage(conversationId, messageId, found.image);
  await db.update(messages).set({ linkPreview: found.info }).where(eq(messages.id, messageId));
  // Loaded here (not at the top): routes.ts loads this file too.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sendUpdated } = require("./routes") as typeof import("./routes");
  await sendUpdated(messageId, conversationId);
}

/** Removes a message's saved preview picture (it was deleted, edited, or the card removed). */
export async function removePreviewImage(messageId: string): Promise<void> {
  const [row] = await db.select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.id, messageId));
  if (row) await storage.remove(previewImageKey(row.conversationId, messageId)).catch(() => undefined);
}

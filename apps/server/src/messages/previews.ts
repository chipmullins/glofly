import { eq } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";
import { storage } from "../storage";
import { firstLink, previewFor, previewImageKey, savePreviewImage } from "./links";

// Link previews (0.5.0): made in the background after a message is sent (or edited), then
// everyone gets the message again with its card (message:updated). See links.ts for the fetching.

const LINKS_PER_MINUTE = 30;
let recent: number[] = [];

export async function addLinkPreview(messageId: string, conversationId: string, text: string): Promise<void> {
  const link = firstLink(text);
  if (!link) return;
  // The whole server makes at most this many previews a minute (a flood of links just goes without).
  const now = Date.now();
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= LINKS_PER_MINUTE) return;
  recent.push(now);

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

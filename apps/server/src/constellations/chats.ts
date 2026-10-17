import { eq } from "drizzle-orm";
import { db } from "../db";
import { conversations, nebulas } from "../db/schema";

// Which conversations are nebulas (2.0). A conversation's kind never changes, so it's remembered
// once looked up. Used wherever a chat event goes out, so nebula events reach only apps that know
// Constellations (realtime.ts emitToUser's modernOnly).

const kinds = new Map<string, "dm" | "group" | "nebula">();
const MAX_REMEMBERED = 50_000;

export async function chatKind(conversationId: string): Promise<"dm" | "group" | "nebula" | null> {
  const known = kinds.get(conversationId);
  if (known) return known;
  const [row] = await db.select({ kind: conversations.kind }).from(conversations).where(eq(conversations.id, conversationId));
  if (!row) return null;
  if (kinds.size > MAX_REMEMBERED) kinds.clear();
  kinds.set(conversationId, row.kind);
  return row.kind;
}

export async function isNebulaChat(conversationId: string): Promise<boolean> {
  return (await chatKind(conversationId)) === "nebula";
}

/** A new nebula's conversation (so no lookup is needed). */
export function rememberNebulaChat(conversationId: string): void {
  kinds.set(conversationId, "nebula");
}

/** The nebula behind a conversation, if it is one. */
export async function nebulaOfChat(conversationId: string) {
  const [row] = await db
    .select({
      id: nebulas.id,
      constellationId: nebulas.constellationId,
      kind: nebulas.kind,
      name: nebulas.name,
      readOnly: nebulas.readOnly,
    })
    .from(nebulas)
    .where(eq(nebulas.conversationId, conversationId));
  return row ?? null;
}

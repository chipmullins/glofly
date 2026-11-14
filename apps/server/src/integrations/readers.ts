import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BridgeMessage, BridgePush } from "@glofly/shared";
import { db } from "../db";
import { attachments, constellationApiKeys, messages, nebulas, users } from "../db/schema";
import { safePost } from "../messages/links";
import { registerToolHooks } from "../toolHooks";
import { seesNebulaChat, viewersOf } from "../constellations/access";
import { signature } from "./events";
import { logIntegration } from "./keys";
import type { BotKey } from "./api";

// Communities round (Nov 2026): "messages:read", for bridges (Discord ↔ Glofly, a game's chat).
// Only nebulas the owner picked for the key, and every member of those nebulas sees a notice
// ("Messages here are shared with …": Nebula.sharedWith). Never DMs, groups, lanterns (they fade on
// purpose) or event lines.
//
//   GET /api/v1/nebulas/:nebulaId/messages?after=<messageId>&limit=50   oldest first; no `after` =
//                                                                       the latest `limit`
//   Pushes: message.created / .edited / .deleted to the key's interactions address (PUT
//   /api/v1/interactions), signed with its secret. Its own posts aren't pushed back (no echo loops).

const PAGE_MAX = 100;

/** Keys that may read this nebula right now (not expired), with where to push. */
async function readersOf(constellationId: string, nebulaId: string) {
  return db
    .select({
      id: constellationApiKeys.id,
      name: constellationApiKeys.name,
      botUserId: constellationApiKeys.botUserId,
      url: constellationApiKeys.interactionsUrl,
      secret: constellationApiKeys.interactionsSecret,
    })
    .from(constellationApiKeys)
    .where(
      and(
        eq(constellationApiKeys.constellationId, constellationId),
        sql`'messages:read' = any(${constellationApiKeys.scopes})`,
        sql`${nebulaId}::uuid = any(${constellationApiKeys.readNebulaIds})`,
        or(isNull(constellationApiKeys.expiresAt), gt(constellationApiKeys.expiresAt, new Date())),
      ),
    );
}

/** Nebula id → names of the integrations reading it (for the members' notice). */
export async function sharedWithByNebula(constellationId: string): Promise<Map<string, string[]>> {
  const keys = await db
    .select({ name: constellationApiKeys.name, nebulaIds: constellationApiKeys.readNebulaIds })
    .from(constellationApiKeys)
    .where(
      and(
        eq(constellationApiKeys.constellationId, constellationId),
        sql`'messages:read' = any(${constellationApiKeys.scopes})`,
        or(isNull(constellationApiKeys.expiresAt), gt(constellationApiKeys.expiresAt, new Date())),
      ),
    );
  const out = new Map<string, string[]>();
  for (const k of keys) for (const id of k.nebulaIds) out.set(id, [...(out.get(id) ?? []), k.name]);
  return out;
}

type Row = typeof messages.$inferSelect;
const readable = (m: Row) => !m.deletedAt && !m.event && !m.lantern;

async function forBots(rows: Row[], nebulaId: string): Promise<BridgeMessage[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const senders = [...new Set(rows.map((r) => r.senderId))];
  const people = new Map(
    (await db.select({ id: users.id, username: users.username, displayName: users.displayName, bot: users.bot }).from(users).where(inArray(users.id, senders))).map((u) => [u.id, u]),
  );
  const files = await db
    .select({ messageId: attachments.messageId, kind: attachments.kind, name: attachments.name, position: attachments.position })
    .from(attachments)
    .where(inArray(attachments.messageId, ids))
    .orderBy(asc(attachments.position));
  return rows.map((r) => {
    const u = people.get(r.senderId);
    return {
      id: r.id,
      nebulaId,
      author: { id: r.senderId, username: u?.username ?? "deleted", displayName: u?.displayName ?? "Deleted account", bot: !!u?.bot },
      text: r.body,
      replyToId: r.replyToId,
      threadId: r.threadId ?? null,
      attachments: files.filter((f) => f.messageId === r.id).map((f) => ({ kind: f.kind, name: f.name })),
      gif: !!r.gif,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
    };
  });
}

const lastLog = new Map<string, number>();

/** GET /api/v1/nebulas/:nebulaId/messages (the caller has checked the scope). */
export async function listMessages(k: BotKey, nebulaId: string, after: string | null, limitRaw: number): Promise<{ status: number; json: unknown }> {
  if (!k.readNebulaIds.includes(nebulaId)) {
    return { status: 403, json: { error: "nebula_not_allowed", message: "This key can't read that nebula. Pick it for the key in Integrations." } };
  }
  const [n] = await db
    .select({ conversationId: nebulas.conversationId })
    .from(nebulas)
    .where(and(eq(nebulas.id, nebulaId), eq(nebulas.constellationId, k.constellationId)));
  if (!n) return { status: 404, json: { error: "not_found", message: "That nebula is gone." } };
  // The bot itself must be able to see it (its role), like any member reading a nebula.
  if (!(await seesNebulaChat(k.botUserId, n.conversationId))) {
    return { status: 403, json: { error: "nebula_not_allowed", message: "This bot's role can't see that nebula. Give it a role that can, in Integrations." } };
  }
  const limit = Math.max(1, Math.min(PAGE_MAX, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50));
  const base: SQL[] = [eq(messages.conversationId, n.conversationId), isNull(messages.deletedAt), isNull(messages.event), eq(messages.lantern, false)];
  let rows: Row[];
  if (after) {
    const [cursor] = await db.select({ createdAt: messages.createdAt, id: messages.id }).from(messages).where(and(eq(messages.id, after), eq(messages.conversationId, n.conversationId)));
    if (!cursor) return { status: 400, json: { error: "bad_request", message: "`after` must be a message id from this nebula." } };
    rows = await db
      .select()
      .from(messages)
      .where(and(...base, sql`(${messages.createdAt}, ${messages.id}) > (select m2.created_at, m2.id from messages m2 where m2.id = ${cursor.id})`))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(limit);
  } else {
    rows = (await db.select().from(messages).where(and(...base)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit)).reverse();
  }
  const logKey = `${k.id}:${nebulaId}`;
  if ((lastLog.get(logKey) ?? 0) < Date.now() - 10 * 60_000) {
    if (lastLog.size >= 10_000) lastLog.clear(); // bounded (robustness round, Nov 14)
    lastLog.set(logKey, Date.now());
    await logIntegration({ constellationId: k.constellationId, keyId: k.id, keyName: k.name, action: "messages.read", details: { nebulaId }, ip: k.ip });
  }
  return { status: 200, json: { messages: await forBots(rows.filter(readable), nebulaId) } };
}

/** A nebula message was posted, edited or deleted: tell the keys reading it (in the background). */
async function pushToReaders(conversationId: string, messageId: string, change: "created" | "edited" | "deleted"): Promise<void> {
  const [n] = await db.select({ id: nebulas.id, constellationId: nebulas.constellationId }).from(nebulas).where(eq(nebulas.conversationId, conversationId));
  if (!n) return;
  const keys = (await readersOf(n.constellationId, n.id)).filter((k) => k.url && k.secret);
  if (!keys.length) return;
  // Only bots that can see the nebula right now (their role) are told.
  const seeing = new Set(await viewersOf(conversationId));
  const allowed = keys.filter((k) => seeing.has(k.botUserId));
  if (!allowed.length) return;
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!row) return;
  if (change !== "deleted" && !readable(row)) return;
  if (change === "deleted" && (row.event || row.lantern)) return;
  const [message] = change === "deleted" ? [null] : await forBots([row], n.id);
  for (const k of allowed) {
    if (row.senderId === k.botUserId) continue; // its own post: no echo
    const push: BridgePush = {
      id: randomUUID(),
      type: `message.${change}`,
      constellationId: n.constellationId,
      nebulaId: n.id,
      message,
      messageId,
      createdAt: new Date().toISOString(),
    };
    const body = JSON.stringify(push);
    await safePost(k.url!, body, { "Glofly-Signature": signature(k.secret!, body), "Glofly-Event": push.type, "Glofly-Delivery": push.id });
  }
}

export function startReaderPushes(): void {
  registerToolHooks({ onNebulaMessage: pushToReaders });
}

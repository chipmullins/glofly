import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import {
  AUTOMOD_ACTIONS,
  DEFAULT_AUTOMOD,
  LINK_REPEAT_MINUTES,
  LINK_REPEAT_NEBULAS,
  LINK_SPAM_LINKS,
  LINK_SPAM_SECONDS,
  blockedWordIn,
  linksIn,
  newMemberWait,
  slowModeWait,
  type AutoModSettings,
} from "@glofly/shared";
import { db } from "../db";
import { automodHeld, constellationAuditLog, constellationAutomod, constellationMembers, nebulas } from "../db/schema";
import { redis } from "../redis";
import { nebulaOfChat } from "./chats";
import { can, standingOf, type Standing } from "./perms";
import { logModeration } from "./activity";

// AutoMod lite (0.8.0, approved Oct 20 board 14). Runs on the server for every new nebula
// message, so no app can skip it. Moderators and higher (anyone who can delete messages) are
// never slowed down or filtered. Everything it holds back is in the moderation log with an Undo.
//
// - Blocked words: whole words, any case, l33t spellings too (shared blockedWordIn). The message is
//   held (nobody sees it) and logged; Undo posts it as the sender would have.
// - Link-spam guard: more than 3 links in 10 seconds, or the same link in 3 nebulas within 10
//   minutes, is held the same way.
// - Slow mode (per nebula): one message per N seconds (answers 429, which every app shows).
// - New members wait N minutes before posting (answers 403 with when they can; logged once).

export type AutoModRow = typeof constellationAutomod.$inferSelect;

const cache = new Map<string, { at: number; row: AutoModRow | null }>();
const CACHE_MS = 30_000;

/** A constellation's AutoMod row (null = never turned on), cached for 30 seconds. */
export async function automodRow(constellationId: string): Promise<AutoModRow | null> {
  const hit = cache.get(constellationId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.row;
  const [row] = await db.select().from(constellationAutomod).where(eq(constellationAutomod.constellationId, constellationId));
  if (cache.size > 5000) cache.clear();
  cache.set(constellationId, { at: Date.now(), row: row ?? null });
  return row ?? null;
}

export function forgetAutomod(constellationId: string): void {
  cache.delete(constellationId);
}

export function settingsOf(row: AutoModRow | null): AutoModSettings {
  if (!row) return { ...DEFAULT_AUTOMOD, words: [], slowMode: {} };
  return {
    wordsOn: row.wordsOn,
    words: row.words,
    linkGuardOn: row.linkGuardOn,
    slowModeOn: row.slowModeOn,
    slowMode: row.slowMode ?? {},
    newMemberWaitMinutes: row.newMemberWaitMinutes,
  };
}

/** Moderators and higher are never slowed down or filtered. */
export const exempt = (s: Standing): boolean => s.owner || can(s, "deleteMessages");

export type Refusal = { status: number; error: string; message: string };

const waiveKey = (cid: string, uid: string) => `automod:waived:${cid}:${uid}`;
const waitLogKey = (cid: string, uid: string) => `automod:waitlog:${cid}:${uid}`;
const slowKey = (conversationId: string, uid: string) => `automod:slow:${conversationId}:${uid}`;
const linksKey = (cid: string, uid: string) => `automod:links:${cid}:${uid}`;

/**
 * Checks a new nebula message. Null = send it. Otherwise the answer to give (the message was
 * refused, or held for a moderator and logged).
 */
export async function automodGate(
  conversationId: string,
  userId: string,
  text: string,
  replyToId: string | null,
  now = Date.now(),
): Promise<Refusal | null> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return null;
  const row = await automodRow(nebula.constellationId);
  if (!row) return null;
  const set = settingsOf(row);
  const slowSeconds = set.slowModeOn ? (set.slowMode[nebula.id] ?? 0) : 0;
  const anything = (set.wordsOn && set.words.length > 0) || set.linkGuardOn || slowSeconds > 0 || set.newMemberWaitMinutes > 0;
  if (!anything) return null;
  const s = await standingOf(nebula.constellationId, userId);
  if (!s || exempt(s)) return null;
  const cid = nebula.constellationId;

  // New members wait
  if (set.newMemberWaitMinutes > 0) {
    const [m] = await db
      .select({ joinedAt: constellationMembers.joinedAt })
      .from(constellationMembers)
      .where(and(eq(constellationMembers.constellationId, cid), eq(constellationMembers.userId, userId)));
    const until = m ? m.joinedAt.getTime() + set.newMemberWaitMinutes * 60_000 : 0;
    if (until > now && !(await redis.exists(waiveKey(cid, userId)).catch(() => 0))) {
      const left = (until - now) / 60_000;
      // Logged once per wait (the moderation log's "New member waiting", with "Let them post now").
      const first = await redis.set(waitLogKey(cid, userId), "1", { NX: true, PX: Math.max(1000, until - now) }).catch(() => null);
      if (first === "OK") {
        await logModeration(cid, null, "automod_wait", userId, {
          nebulaId: nebula.id,
          nebulaName: nebula.name,
          until: new Date(until).toISOString(),
          minutes: set.newMemberWaitMinutes,
        });
      }
      return { status: 403, error: "forbidden", message: newMemberWait(left, set.newMemberWaitMinutes) };
    }
  }

  // Slow mode
  if (slowSeconds > 0) {
    const left = await redis.pTTL(slowKey(conversationId, userId)).catch(() => -2);
    if (left > 0) return { status: 429, error: "too_many_requests", message: slowModeWait(left / 1000) };
  }

  // Blocked words
  if (set.wordsOn && set.words.length) {
    const word = blockedWordIn(text, set.words);
    if (word) {
      await hold(cid, nebula, conversationId, userId, text, replyToId, "word", word, now);
      return {
        status: 403,
        error: "forbidden",
        message: "AutoMod held your message: it has a word this constellation doesn't allow. A moderator can let it through.",
      };
    }
  }

  // Link-spam guard
  if (set.linkGuardOn) {
    const links = linksIn(text);
    if (links.length) {
      const key = linksKey(cid, userId);
      const entries = links.map((l, i) => ({ score: now, value: `${now}|${i}|${randomUUID().slice(0, 8)}|${nebula.id}|${l}` }));
      let recent: string[] = [];
      try {
        await redis.zRemRangeByScore(key, 0, now - LINK_REPEAT_MINUTES * 60_000);
        recent = await redis.zRangeByScore(key, now - LINK_REPEAT_MINUTES * 60_000, "+inf");
        await redis.zAdd(key, entries);
        await redis.pExpire(key, LINK_REPEAT_MINUTES * 60_000);
      } catch {
        recent = [];
      }
      const parsed = recent.map((v) => {
        const [at, , , nid, ...rest] = v.split("|");
        return { at: Number(at), nebulaId: nid, link: rest.join("|") };
      });
      const lastSeconds = parsed.filter((p) => p.at > now - LINK_SPAM_SECONDS * 1000).length + links.length;
      let rule: string | null = lastSeconds > LINK_SPAM_LINKS ? "many" : null;
      if (!rule) {
        for (const l of links) {
          const places = new Set(parsed.filter((p) => p.link === l).map((p) => p.nebulaId));
          places.add(nebula.id);
          if (places.size >= LINK_REPEAT_NEBULAS) {
            rule = "repeat";
            break;
          }
        }
      }
      if (rule) {
        await hold(cid, nebula, conversationId, userId, text, replyToId, "links", rule, now);
        return {
          status: 403,
          error: "forbidden",
          message: "AutoMod held your message for a moderator: that's a lot of links at once. A moderator can let it through.",
        };
      }
    }
  }

  if (slowSeconds > 0) await redis.set(slowKey(conversationId, userId), "1", { PX: slowSeconds * 1000 }).catch(() => {});
  return null;
}

async function hold(
  constellationId: string,
  nebula: { id: string; name: string },
  conversationId: string,
  senderId: string,
  body: string,
  replyToId: string | null,
  reason: "word" | "links",
  detail: string,
  now: number,
): Promise<void> {
  // The same message tried again within a minute (a retry) is held once.
  const [same] = await db
    .select({ id: automodHeld.id })
    .from(automodHeld)
    .where(
      and(
        eq(automodHeld.conversationId, conversationId),
        eq(automodHeld.senderId, senderId),
        eq(automodHeld.body, body),
        gt(automodHeld.createdAt, new Date(now - 60_000)),
      ),
    )
    .limit(1);
  if (same) return;
  const [held] = await db
    .insert(automodHeld)
    .values({ constellationId, conversationId, senderId, body, replyToId, reason, detail })
    .returning({ id: automodHeld.id });
  await logModeration(constellationId, null, reason === "word" ? "automod_hidden" : "automod_links", senderId, {
    heldId: held.id,
    nebulaId: nebula.id,
    nebulaName: nebula.name,
    ...(reason === "word" ? { word: detail } : { rule: detail }),
    preview: body.replace(/\s+/g, " ").slice(0, 140),
  });
}

/** "Let them post now" (Undo on a new-member wait). */
export async function waiveWait(constellationId: string, userId: string, minutes: number): Promise<void> {
  await redis.set(waiveKey(constellationId, userId), "1", { EX: Math.max(60, minutes * 60) }).catch(() => {});
}

/** The AutoMod page's log: what AutoMod did lately, with whether each was undone. */
export async function automodLog(constellationId: string, limit = 30) {
  const rows = await db
    .select()
    .from(constellationAuditLog)
    .where(and(eq(constellationAuditLog.constellationId, constellationId), inArray(constellationAuditLog.action, [...AUTOMOD_ACTIONS, "automod_undo"])))
    .orderBy(desc(constellationAuditLog.createdAt))
    .limit(limit * 2);
  const heldIds = rows.map((r) => (r.details as { heldId?: string } | null)?.heldId).filter((x): x is string => !!x);
  const held = heldIds.length ? await db.select().from(automodHeld).where(inArray(automodHeld.id, heldIds)) : [];
  const undone = new Map<string, { by: string | null; at: string }>();
  for (const r of rows) {
    if (r.action !== "automod_undo") continue;
    const d = r.details as { undid?: string } | null;
    if (d?.undid) undone.set(d.undid, { by: r.actorId, at: r.createdAt.toISOString() });
  }
  return rows
    .filter((r) => r.action !== "automod_undo")
    .slice(0, limit)
    .map((r) => {
      const h = held.find((x) => x.id === (r.details as { heldId?: string } | null)?.heldId);
      const u = undone.get(r.id) ?? (h?.releasedAt ? { by: h.releasedBy, at: h.releasedAt.toISOString() } : null);
      return { entry: r, held: h ?? null, undone: u };
    });
}

/** Nebulas of a constellation (for the slow-mode list). */
export async function nebulasOf(constellationId: string) {
  return db
    .select({ id: nebulas.id, name: nebulas.name, kind: nebulas.kind, position: nebulas.position, categoryId: nebulas.categoryId, conversationId: nebulas.conversationId })
    .from(nebulas)
    .where(eq(nebulas.constellationId, constellationId));
}

/** An edit that adds a blocked word is refused (not held). The answer to give, or null. */
export async function automodWordInEdit(conversationId: string, userId: string, text: string): Promise<string | null> {
  const nebula = await nebulaOfChat(conversationId);
  if (!nebula) return null;
  const set = settingsOf(await automodRow(nebula.constellationId));
  if (!set.wordsOn || !set.words.length) return null;
  const s = await standingOf(nebula.constellationId, userId);
  if (!s || exempt(s)) return null;
  return blockedWordIn(text, set.words) ? "AutoMod: that edit has a word this constellation doesn't allow." : null;
}

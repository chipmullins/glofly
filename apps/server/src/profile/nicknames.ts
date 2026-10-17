import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { nicknames } from "../db/schema";

// Nicknames (Oct 2026): a name you give someone that only you see ("johnnyboy" → "John").
//
// Rather than teaching every screen of every app (desktop, phones, older versions) about
// nicknames, the server swaps them in: everything it sends you, over the API or the live
// connection, has your nickname as that person's displayName, with their own name in
// `realName` (newer apps show it on the profile; older apps just see the nickname). Nobody else
// is affected: other people get their own copy of the same data.
//
// Kept in memory per person once loaded (one small query the first time they connect), and
// dropped when they change one. The live server runs one process; with several, a change would
// need to reach the others (Redis pub/sub), noted for later.

type NickMap = Map<string, string>;
const cache = new Map<string, NickMap>();
const MAX_CACHED = 50_000;

/** Your nicknames (loads them the first time). */
export async function nicknamesFor(ownerId: string): Promise<NickMap> {
  const hit = cache.get(ownerId);
  if (hit) return hit;
  const rows = await db
    .select({ targetId: nicknames.targetId, nickname: nicknames.nickname })
    .from(nicknames)
    .where(eq(nicknames.ownerId, ownerId));
  const map: NickMap = new Map(rows.map((r) => [r.targetId, r.nickname]));
  // Never grows without end: past the limit, whoever was loaded longest ago is dropped (and simply
  // loaded again on their next request).
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
  cache.set(ownerId, map);
  return map;
}

/** Your nicknames if they're already loaded (the live connection loads them when it opens). */
export function cachedNicknames(ownerId: string): NickMap | undefined {
  return cache.get(ownerId);
}

/** Sets (or, with null, removes) your nickname for someone. */
export async function setNickname(ownerId: string, targetId: string, nickname: string | null): Promise<void> {
  if (nickname) {
    await db
      .insert(nicknames)
      .values({ ownerId, targetId, nickname })
      .onConflictDoUpdate({ target: [nicknames.ownerId, nicknames.targetId], set: { nickname, updatedAt: new Date() } });
  } else {
    await db.delete(nicknames).where(and(eq(nicknames.ownerId, ownerId), eq(nicknames.targetId, targetId)));
  }
  const map = cache.get(ownerId);
  if (map) {
    if (nickname) map.set(targetId, nickname);
    else map.delete(targetId);
  }
}

const isPlain = (v: object): boolean => {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * The same data with your nicknames in it. Anything shaped like a person ({ id, username,
 * displayName, avatarVersion }) whose id you nicknamed gets displayName = nickname and realName =
 * their own name. Copies only what changes, so data shared with other people stays untouched.
 */
export function withNicknames<T>(value: T, viewerId: string, map: NickMap | undefined): T {
  if (!map || map.size === 0) return value;
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 12 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      let out: unknown[] | null = null;
      for (let i = 0; i < v.length; i++) {
        const next = walk(v[i], depth + 1);
        if (next !== v[i]) {
          out ??= v.slice();
          out[i] = next;
        }
      }
      return out ?? v;
    }
    if (!isPlain(v)) return v; // Dates, Buffers…
    const obj = v as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    for (const key of Object.keys(obj)) {
      const next = walk(obj[key], depth + 1);
      if (next !== obj[key]) {
        out ??= { ...obj };
        out[key] = next;
      }
    }
    const src = out ?? obj;
    if (
      typeof src.id === "string" &&
      typeof src.username === "string" &&
      typeof src.displayName === "string" &&
      "avatarVersion" in src &&
      src.id !== viewerId
    ) {
      const nick = map.get(src.id);
      if (nick && nick !== src.displayName) {
        return { ...src, displayName: nick, realName: typeof src.realName === "string" ? src.realName : src.displayName };
      }
    }
    return out ?? v;
  };
  return walk(value, 0) as T;
}

/** A display name for one person as someone else sees it (push notifications, emails). */
export async function nameFor(viewerId: string, userId: string, displayName: string): Promise<string> {
  if (viewerId === userId) return displayName;
  try {
    return (await nicknamesFor(viewerId)).get(userId) ?? displayName;
  } catch {
    return displayName;
  }
}

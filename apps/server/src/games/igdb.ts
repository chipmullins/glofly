// Game pictures (0.9.1) from IGDB (Twitch's game database). Only the server talks to IGDB, with
// Glofly's Twitch developer app (IGDB_CLIENT_ID / IGDB_CLIENT_SECRET in deploy/.env); nothing about
// the person is sent, only game names. Box art is fetched once, re-saved as WebP in Glofly's
// storage and served by Glofly (GET /games/cover/:imageId), so apps never contact IGDB. IGDB's
// terms ask for credit: the apps show "Game info by IGDB" where they search or show box art.
// Free for non-commercial use; a commercial Glofly needs a partnership with Twitch first.
//
// Off (letter tiles everywhere) until the two settings are there.

import { inArray } from "drizzle-orm";
import type { Readable } from "node:stream";
import sharp from "sharp";
import { gameKey, type GameSearchResult } from "@glofly/shared";
import { db } from "../db";
import { gameArt } from "../db/schema";
import { storage } from "../storage";

const CLIENT_ID = process.env.IGDB_CLIENT_ID?.trim() || "";
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET?.trim() || "";
// Only for testing against a stand-in on this computer; normally Twitch's / IGDB's own.
const TOKEN_URL = process.env.IGDB_TOKEN_URL?.trim() || "https://id.twitch.tv/oauth2/token";
const API_URL = (process.env.IGDB_API_URL?.trim() || "https://api.igdb.com/v4").replace(/\/+$/, "");
const IMAGE_URL = (process.env.IGDB_IMAGE_URL?.trim() || "https://images.igdb.com/igdb/image/upload").replace(/\/+$/, "");

export const igdbConfigured = CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;

/** IGDB image ids are short lower-case letters and digits ("co1wyy"). */
export const isCoverId = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9]{2,40}$/.test(x);

let token: { value: string; until: number } | null = null;
let tokenWait: Promise<string | null> | null = null;

async function accessToken(): Promise<string | null> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  tokenWait ??= (async () => {
    try {
      const q = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "client_credentials" });
      const res = await fetch(`${TOKEN_URL}?${q}`, { method: "POST", signal: AbortSignal.timeout(8000), redirect: "error" });
      if (!res.ok) {
        warn(`IGDB: Twitch refused the app's sign-in (${res.status}). Check IGDB_CLIENT_ID / IGDB_CLIENT_SECRET.`);
        return null;
      }
      const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== "string") return null;
      const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
      token = { value: body.access_token, until: Date.now() + seconds * 1000 };
      return token.value;
    } catch (err) {
      warn(`IGDB: couldn't reach Twitch to sign in: ${(err as Error).message}`);
      return null;
    } finally {
      tokenWait = null;
    }
  })();
  return tokenWait;
}

// IGDB allows 4 requests a second: one at a time, 260 ms apart.
let queue: Promise<unknown> = Promise.resolve();
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => new Promise((r) => setTimeout(r, 260)),
    () => new Promise((r) => setTimeout(r, 260)),
  );
  return run;
}

type IgdbGame = { id?: unknown; name?: unknown; cover?: { image_id?: unknown }; first_release_date?: unknown };

/** IGDB's games query (Apicalypse text). Null if IGDB couldn't be reached. */
async function query(body: string, retried = false): Promise<IgdbGame[] | null> {
  const t = await accessToken();
  if (!t) return null;
  return paced(async () => {
    try {
      const res = await fetch(`${API_URL}/games`, {
        method: "POST",
        headers: { "Client-ID": CLIENT_ID, Authorization: `Bearer ${t}`, Accept: "application/json", "Content-Type": "text/plain" },
        body,
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (res.status === 401 && !retried) {
        token = null;
        return query(body, true);
      }
      if (!res.ok) {
        warn(`IGDB answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
        return null;
      }
      const json = await res.json();
      return Array.isArray(json) ? (json as IgdbGame[]) : null;
    } catch (err) {
      warn(`IGDB couldn't be reached: ${(err as Error).message}`);
      return null;
    }
  });
}

// Problems go to the server log (at most once a minute), so "no pictures" can be explained.
let lastWarn = 0;
function warn(text: string): void {
  if (Date.now() - lastWarn < 60_000) return;
  lastWarn = Date.now();
  console.error(text);
}

/** A games query with the "main games only" filter, or without it if IGDB refuses the filter. */
async function gamesQuery(search: string, limit: number): Promise<IgdbGame[] | null> {
  const strict = await query(`search "${search}"; ${FIELDS} ${MAIN} limit ${limit};`);
  if (strict) return strict;
  return query(`search "${search}"; ${FIELDS} where version_parent = null; limit ${limit};`);
}

/** Text for inside an Apicalypse search "…" (no quotes or backslashes, short). */
const searchText = (q: string) => q.replace(/["\\;]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);

function clean(g: IgdbGame): GameSearchResult | null {
  if (typeof g.id !== "number" || typeof g.name !== "string" || !g.name.trim()) return null;
  const name = g.name.replace(/\s+/g, " ").trim().slice(0, 80);
  const when = typeof g.first_release_date === "number" ? new Date(g.first_release_date * 1000).getUTCFullYear() : null;
  return { key: gameKey(name), name, year: when, cover: isCoverId(g.cover?.image_id) ? g.cover.image_id : null, igdbId: g.id };
}

const FIELDS = "fields name,cover.image_id,first_release_date;";
// Main games, remakes, remasters, expanded games, ports (not DLCs, mods, bundles or episodes).
const MAIN = "where version_parent = null & (game_type = (0,8,9,10,11) | game_type = null);";

/** Remembers what IGDB said about games (so pictures show without asking again). */
async function remember(results: GameSearchResult[]): Promise<void> {
  for (const r of results) {
    await db
      .insert(gameArt)
      .values({ gameKey: r.key, igdbId: r.igdbId ?? null, name: r.name, coverId: r.cover, year: r.year, checkedAt: new Date() })
      .onConflictDoUpdate({ target: gameArt.gameKey, set: { igdbId: r.igdbId ?? null, name: r.name, coverId: r.cover, year: r.year, checkedAt: new Date() } });
  }
}

/** Search for "Find a game". Null when IGDB is off or couldn't be reached. */
export async function searchGames(q: string): Promise<GameSearchResult[] | null> {
  if (!igdbConfigured) return null;
  const text = searchText(q);
  if (text.length < 2) return [];
  const rows = await gamesQuery(text, 8);
  if (!rows) return null;
  const seen = new Set<string>();
  const results = rows.map(clean).filter((r): r is GameSearchResult => !!r && !seen.has(r.key) && !!seen.add(r.key));
  await remember(results.filter((r) => r.cover));
  return results;
}

const RECHECK_MS = 30 * 86_400_000;
const pending = new Map<string, string>(); // key -> name, waiting to be looked up
let working = false;

/** Looks up games we have no picture for yet, in the background (a few a second at most). */
function lookUpLater(games: { key: string; name: string }[]): void {
  if (!igdbConfigured) return;
  for (const g of games) if (pending.size < 500) pending.set(g.key, g.name);
  if (working) return;
  working = true;
  void (async () => {
    try {
      while (pending.size) {
        const [key, name] = pending.entries().next().value as [string, string];
        pending.delete(key);
        const rows = await gamesQuery(searchText(name), 5);
        if (!rows) break; // IGDB down: try again the next time someone needs it
        const match = rows.map(clean).find((r) => r && r.key === key) ?? null;
        await db
          .insert(gameArt)
          .values({ gameKey: key, igdbId: match?.igdbId ?? null, name: match?.name ?? name, coverId: match?.cover ?? null, year: match?.year ?? null, checkedAt: new Date() })
          .onConflictDoUpdate({
            target: gameArt.gameKey,
            set: { igdbId: match?.igdbId ?? null, coverId: match?.cover ?? null, year: match?.year ?? null, checkedAt: new Date() },
          });
      }
    } catch (err) {
      console.error("IGDB lookup failed", err);
    } finally {
      working = false;
    }
  })();
}

/**
 * Box art for some games (by key): what's known now. Games never looked up (or not for 30 days)
 * are looked up in the background, so their pictures show next time.
 */
export async function coversFor(games: { key: string; name: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!games.length) return out;
  const keys = [...new Set(games.map((g) => g.key))];
  const rows = await db.select().from(gameArt).where(inArray(gameArt.gameKey, keys));
  const known = new Map(rows.map((r) => [r.gameKey, r]));
  const missing: { key: string; name: string }[] = [];
  for (const g of games) {
    const r = known.get(g.key);
    if (r?.coverId) out.set(g.key, r.coverId);
    if (!r || (!r.coverId && Date.now() - r.checkedAt.getTime() > RECHECK_MS)) missing.push(g);
  }
  if (missing.length) lookUpLater(missing);
  return out;
}

const coverKey = (id: string) => `game-covers/${id}.webp`;
const fetching = new Map<string, Promise<Buffer | null>>();

/** A cover picture (264×352 WebP), fetched from IGDB once and kept. */
export async function coverImage(id: string): Promise<{ stream: Readable; size: number } | Buffer | null> {
  const kept = await storage.get(coverKey(id));
  if (kept) return kept;
  let wait = fetching.get(id);
  if (!wait) {
    wait = (async () => {
      try {
        const res = await fetch(`${IMAGE_URL}/t_cover_big/${id}.jpg`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          warn(`IGDB picture ${id}: ${res.status}`);
          return null;
        }
        const input = Buffer.from(await res.arrayBuffer());
        if (input.length > 4 * 1024 * 1024) return null;
        const out = await sharp(input, { limitInputPixels: 20_000_000 }).resize(264, 352, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
        await storage.put(coverKey(id), out, "image/webp");
        return out;
      } catch {
        return null;
      } finally {
        fetching.delete(id);
      }
    })();
    fetching.set(id, wait);
  }
  return wait;
}

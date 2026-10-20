import { Router, type Response } from "express";
import { rateLimit } from "../rateLimit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isGifId, type GifInfo } from "@glofly/shared";
import { requireAuth } from "../auth/sessions";
import { db } from "../db";
import { users } from "../db/schema";

// GIFs (0.5.0) from GIPHY. Google shut down Tenor's API for other apps in 2026, so GIPHY it is.
//
// The GIPHY key stays here on the server (GIPHY_API_KEY in deploy/.env): the apps ask Glofly
// for trending / search results, and Glofly asks GIPHY. A GIF message keeps only GIPHY's id; the
// apps show the picture from GIPHY's own servers (their terms ask for that, with "Powered by
// GIPHY" shown in the picker). Family (restricted) accounts only get G-rated GIFs.
//
//   GET /gifs/trending?offset=      → { gifs: GifInfo[], next: number | null }
//   GET /gifs/search?q=&offset=     → same

const KEY = process.env.GIPHY_API_KEY?.trim() || "";
// Only for testing against a stand-in on this computer; normally GIPHY's own.
const GIPHY = (process.env.GIPHY_API_URL?.trim() || "https://api.giphy.com/v1").replace(/\/+$/, "");
export const gifsConfigured = KEY.length > 0;
const PAGE = 24;

export const gifsRouter = Router();
gifsRouter.use(requireAuth);

type Me = { id: string };
const me = (res: Response): Me => res.locals.user as Me;

const gifLimiter = rateLimit("gifs", {
  windowMs: 60 * 1000,
  limit: 60,
  keyGenerator: (_req, res) => me(res).id,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Slow down a little and try again." },
});

type GiphyItem = {
  id?: unknown;
  title?: unknown;
  rating?: unknown;
  images?: { fixed_width?: { width?: unknown; height?: unknown }; original?: { width?: unknown; height?: unknown } };
};

/** Only the id, a short title and the shape: nothing else from GIPHY reaches the apps. */
function clean(item: GiphyItem): GifInfo | null {
  if (!isGifId(item.id)) return null;
  const size = item.images?.fixed_width ?? item.images?.original;
  const width = Number(size?.width);
  const height = Number(size?.height);
  const title = typeof item.title === "string" ? item.title.replace(/\s+GIF(\s+by\s+.*)?$/i, "").trim().slice(0, 80) : "";
  return {
    id: item.id,
    title: title || "GIF",
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 200,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 150,
  };
}

async function rating(userId: string): Promise<"g" | "pg-13"> {
  const [u] = await db.select({ restricted: users.restricted }).from(users).where(eq(users.id, userId));
  return u?.restricted ? "g" : "pg-13";
}

/** GIPHY's answer, "missing" for a 404, or null if GIPHY couldn't be reached. */
async function giphy(path: string, params: Record<string, string>): Promise<unknown | "missing" | null> {
  const query = new URLSearchParams({ api_key: KEY, ...params });
  try {
    const res = await fetch(`${GIPHY}${path}?${query}`, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (res.status === 404 || res.status === 400) return "missing";
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Ratings allowed for everyone, and for family accounts. Anything else is dropped even if GIPHY sends it. */
const RATINGS: Record<"g" | "pg-13", ReadonlySet<string>> = {
  g: new Set(["g"]),
  "pg-13": new Set(["g", "pg", "pg-13"]),
};

function notSetUp(res: Response): boolean {
  if (gifsConfigured) return false;
  res.status(503).json({ error: "gifs_unavailable", message: "GIFs aren't set up on this server yet." });
  return true;
}

const offsetParam = z.coerce.number().int().min(0).max(4975).catch(0);

async function list(res: Response, path: string, extra: Record<string, string>, offset: number): Promise<void> {
  const allowed = await rating(me(res).id);
  const answer = await giphy(path, { limit: String(PAGE), offset: String(offset), rating: allowed, bundle: "messaging_non_clips", ...extra });
  const body = (answer === "missing" ? null : answer) as { data?: GiphyItem[]; pagination?: { total_count?: number; count?: number } } | null;
  if (!body || !Array.isArray(body.data)) {
    res.status(502).json({ error: "gifs_unreachable", message: "Couldn't reach GIPHY. Try again in a moment." });
    return;
  }
  const gifs = body.data
    .filter((item) => RATINGS[allowed].has(String(item.rating ?? "g").toLowerCase()))
    .map(clean)
    .filter((g): g is GifInfo => g !== null);
  const total = Number(body.pagination?.total_count ?? 0);
  const next = offset + PAGE < Math.min(total, 5000) && gifs.length > 0 ? offset + PAGE : null;
  res.set("Cache-Control", "private, max-age=60");
  res.json({ gifs, next });
}

gifsRouter.get("/trending", gifLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  await list(res, "/gifs/trending", {}, offsetParam.parse(req.query.offset));
});

gifsRouter.get("/search", gifLimiter, async (req, res) => {
  if (notSetUp(res)) return;
  const q = z.string().trim().min(1).max(50).safeParse(req.query.q);
  if (!q.success) {
    res.status(400).json({ error: "invalid", message: "Type something to search for." });
    return;
  }
  await list(res, "/gifs/search", { q: q.data, lang: "en" }, offsetParam.parse(req.query.offset));
});

/**
 * Looks a GIF up by id when it's sent: it must exist on GIPHY (and suit a family account), and its
 * title and shape come from GIPHY, not from the app. Null if it can't be used.
 */
export async function gifById(id: string, userId: string): Promise<GifInfo | null | "unavailable"> {
  if (!gifsConfigured) return "unavailable";
  if (!isGifId(id)) return null;
  const answer = await giphy(`/gifs/${id}`, {});
  if (answer === "missing") return null;
  const body = answer as { data?: GiphyItem } | null;
  if (!body) return "unavailable";
  if (!body.data || !isGifId(body.data.id)) return null;
  if (!RATINGS[await rating(userId)].has(String(body.data.rating ?? "g").toLowerCase())) return null;
  return clean(body.data);
}

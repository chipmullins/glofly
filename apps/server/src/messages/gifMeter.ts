import { redis } from "../redis";

// Glofly Control → Usage: how many times this hour the server asked GIPHY for GIFs. GIPHY's free
// (beta) key allows GIPHY_HOURLY_LIMIT calls an hour (100 by default); past that GIPHY answers 429
// and the picker shows nothing until the hour turns. Counted per UTC hour in Redis, kept two days.

export const GIF_HOURLY_LIMIT = Math.max(1, Number(process.env.GIPHY_HOURLY_LIMIT) || 100);

const hourKey = (d: Date) => `gifs:calls:${d.toISOString().slice(0, 13)}`; // "2026-10-28T05"
const refusedKey = (d: Date) => `gifs:refused:${d.toISOString().slice(0, 13)}`;

/** Called once for every request to GIPHY (refused = GIPHY said 429). Never throws. */
export function noteGiphyCall(refused = false): void {
  const now = new Date();
  void (async () => {
    const key = hourKey(now);
    await redis.incr(key);
    await redis.expire(key, 2 * 24 * 60 * 60);
    if (refused) {
      await redis.incr(refusedKey(now));
      await redis.expire(refusedKey(now), 2 * 24 * 60 * 60);
    }
  })().catch(() => undefined);
}

export type GifMeter = {
  limit: number;
  thisHour: number;
  refusedThisHour: number;
  /** The busiest of the last 24 hours */
  busiestHour: number;
  /** Times GIPHY said "too many" in the last 24 hours */
  refusedToday: number;
};

export async function gifMeter(now = new Date()): Promise<GifMeter> {
  const hours = Array.from({ length: 24 }, (_, i) => new Date(now.getTime() - i * 60 * 60_000));
  const [calls, refused] = await Promise.all([redis.mGet(hours.map(hourKey)), redis.mGet(hours.map(refusedKey))]);
  const n = (v: string | null | undefined) => Number(v ?? 0) || 0;
  return {
    limit: GIF_HOURLY_LIMIT,
    thisHour: n(calls[0]),
    refusedThisHour: n(refused[0]),
    busiestHour: Math.max(0, ...calls.map(n)),
    refusedToday: refused.reduce((s, v) => s + n(v), 0),
  };
}

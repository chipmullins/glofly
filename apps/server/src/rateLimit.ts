import { MemoryStore, rateLimit as expressRateLimit, type ClientRateLimitInfo, type Options, type RateLimitRequestHandler, type Store } from "express-rate-limit";
import { redis } from "./redis";

// 0.8.0: every rate limit counts in Redis, so a restart (or a new release) no longer hands
// everyone a fresh allowance. Each limiter has its own name; its counters are the Redis keys
// `rl:<name>:<who>` (who = the person's id, or the address for limits before sign-in), each one
// a plain counter that expires at the end of its window (the same fixed windows as before).
//
// If Redis is unreachable, the limits fall back to counting in this server's memory (what every
// limit did before 0.8.0) until it's back: nobody is locked out, and sign-in guessing stays slow.

/** How long a Redis call may take before the request goes ahead on the in-memory count. */
const REDIS_TIMEOUT_MS = 500;

// One INCR, and the window's expiry set by the request that starts it, in one atomic step.
const INCREMENT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}`;

// Never below zero (like express-rate-limit's own store); keeps the key's expiry.
const DECREMENT = `
local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
if hits > 0 then redis.call('DECR', KEYS[1]) end
return 0`;

let redisDown = false;
function noteRedisError(err: unknown): void {
  if (redisDown) return;
  redisDown = true;
  console.error(
    "Rate limits: Redis isn't answering, so limits count in this server's memory until it's back.",
    err instanceof Error ? err.message : err,
  );
}
function noteRedisOk(): void {
  if (!redisDown) return;
  redisDown = false;
  console.log("Rate limits: Redis is back; limits count there again.");
}

/** Runs a Redis call, failing fast (not queueing) while Redis is disconnected or slow. */
async function fast<T>(call: () => Promise<T>): Promise<T> {
  if (!redis.isReady) throw new Error("Redis is not connected");
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis took too long")), REDIS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** express-rate-limit's Store, counting in Redis (fixed windows, like its MemoryStore). */
export class RedisStore implements Store {
  readonly prefix: string;
  /** Counters live in Redis, shared by every server process. */
  readonly localKeys = false;
  private windowMs = 60_000;
  private readonly fallback = new MemoryStore();

  constructor(name: string) {
    this.prefix = `rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const reply = (await fast(() =>
        redis.eval(INCREMENT, { keys: [this.prefix + key], arguments: [String(this.windowMs)] }),
      )) as [number, number];
      noteRedisOk();
      const [totalHits, ttl] = reply;
      return { totalHits: Number(totalHits), resetTime: new Date(Date.now() + Number(ttl)) };
    } catch (err) {
      noteRedisError(err);
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await fast(() => redis.eval(DECREMENT, { keys: [this.prefix + key] }));
    } catch (err) {
      noteRedisError(err);
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    await this.fallback.resetKey(key);
    try {
      await fast(() => redis.del(this.prefix + key));
    } catch (err) {
      noteRedisError(err);
    }
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    try {
      const [hits, ttl] = await fast(() => Promise.all([redis.get(this.prefix + key), redis.pTTL(this.prefix + key)]));
      if (hits === null) return undefined;
      return { totalHits: Number(hits), resetTime: new Date(Date.now() + Math.max(Number(ttl), 0)) };
    } catch (err) {
      noteRedisError(err);
      return this.fallback.get(key);
    }
  }

  shutdown(): void {
    this.fallback.shutdown();
  }
}

const names = new Set<string>();

/**
 * A rate limit counted in Redis. `name` must be unique across the server (it's the Redis key
 * prefix); everything else is express-rate-limit's options, unchanged.
 */
export function rateLimit(name: string, options: Partial<Options>): RateLimitRequestHandler {
  if (!/^[a-z0-9:-]+$/.test(name)) throw new Error(`Rate limit name "${name}" should be lowercase letters, digits, - or :`);
  if (names.has(name)) throw new Error(`Two rate limits are both called "${name}"`);
  names.add(name);
  return expressRateLimit({
    ...options,
    store: new RedisStore(name),
    // The store never fails (it falls back to memory), but never lock people out if it did.
    passOnStoreError: true,
  });
}

// ───────────── Sliding-window counters (not express middleware) ─────────────

// Each key is a sorted set of timestamps within the last `window` ms. All keys must have room
// (fewer than their limit) or nothing is added; otherwise one is added to every key.
const TAKE = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
for i, key in ipairs(KEYS) do
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= tonumber(ARGV[3 + i]) then return 0 end
end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[3])
  redis.call('PEXPIRE', key, window)
end
return 1`;

/**
 * Takes one slot from every one of these sliding windows (same `windowMs`), or none if any is
 * full. True when there was room. Throws if Redis can't be reached (callers pick a fallback).
 */
export async function takeSlot(windowMs: number, slots: { key: string; limit: number }[]): Promise<boolean> {
  const now = Date.now();
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
  const reply = await fast(() =>
    redis.eval(TAKE, {
      keys: slots.map((s) => s.key),
      arguments: [String(now), String(windowMs), member, ...slots.map((s) => String(s.limit))],
    }),
  );
  noteRedisOk();
  return Number(reply) === 1;
}

export { noteRedisError };

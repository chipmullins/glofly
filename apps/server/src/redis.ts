import { createClient } from "redis";

// Redis holds fast-changing, short-lived state: who's connected right now.
// Anything that must survive a restart lives in Postgres instead.

const url = process.env.REDIS_URL;
if (!url) {
  throw new Error("REDIS_URL is missing. Add it to the .env file in the glofly folder.");
}

export const redis = createClient({
  url,
  socket: {
    // Keep retrying if Redis restarts, waiting up to 5 seconds between tries.
    reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
  },
});

// A dropped connection shouldn't crash the server; the client reconnects on its own.
redis.on("error", (err) => console.error("Redis error:", err.message));

export async function connectRedis(): Promise<void> {
  await redis.connect();
}

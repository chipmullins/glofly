// End-to-end tests make several throwaway accounts a run, more than the sign-up limit allows one
// address in an hour (auth/routes.ts registerLimiter). Before each file, this clears that one
// counter on the dev server's Redis. It refuses to touch anything but a local dev setup.
import { createClient } from "redis";

export async function clearSignupLimit(): Promise<void> {
  const url = process.env.REDIS_URL ?? "";
  const target = process.env.GLOFLY_E2E_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/^(redis:\/\/)(:[^@]*@)?(127\.0\.0\.1|localhost)[:/]/.test(url) || !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(target)) {
    throw new Error("End-to-end tests only run against a local dev server and Redis.");
  }
  const redis = createClient({ url });
  await redis.connect();
  try {
    for await (const keys of redis.scanIterator({ MATCH: "rl:auth:register:*", COUNT: 100 })) {
      const list = Array.isArray(keys) ? keys : [keys];
      if (list.length) await redis.del(list);
    }
  } finally {
    await redis.quit();
  }
}

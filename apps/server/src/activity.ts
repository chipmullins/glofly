import { db } from "./db";
import { activeDays } from "./db/schema";
import { redis } from "./redis";
import { dayIn } from "@glofly/shared";
import { TIME_ZONE } from "./timeZone";

// Control → Insights: one row per person per day they used Glofly (active_days). Redis remembers
// who's already counted today, so this costs one Redis call per request and one insert per person
// per day. Never slows or fails a request. (Only leaf imports: auth/sessions.ts loads this early.)

export function noteActiveDay(userId: string, platform: string | null): void {
  const day = dayIn(new Date(), TIME_ZONE);
  void (async () => {
    const first = await redis.set(`active:${day}:${userId}`, "1", { NX: true, EX: 36 * 60 * 60 });
    if (first !== "OK") return;
    await db
      .insert(activeDays)
      .values({ userId, day, platform: platform ?? "desktop" })
      .onConflictDoNothing();
  })().catch(() => undefined);
}

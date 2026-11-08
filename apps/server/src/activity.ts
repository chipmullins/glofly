import { db } from "./db";
import { activeDays, users } from "./db/schema";
import { eq } from "drizzle-orm";
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

/**
 * 0.9.3: "Last seen" also moves when someone does something without Glofly open (a reply from a
 * notification, a message from a Shortcut): before, it only moved when an open app disconnected,
 * so a friend replying from their lock screen still showed "Last seen 17 hours ago". At most one
 * write a minute per person. Shown only while they're offline, and only if they share it.
 */
export function noteSeen(userId: string): void {
  void (async () => {
    const first = await redis.set(`seen:${userId}`, "1", { NX: true, EX: 60 });
    if (first !== "OK") return;
    await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
  })().catch(() => undefined);
}

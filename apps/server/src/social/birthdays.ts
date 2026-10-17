import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import { redis } from "../redis";
import { emitToUser } from "../realtime";
import { inBackground, notifyFriendNews } from "../push/notify";
import { TIME_ZONE, today } from "./glows";
import { friendIdsOf } from "./routes";

// Birthday glow (0.5.0): people who chose to share their birthday get a 🎂 by their name for
// their friends all day, and at 9 in the morning (Glofly's time zone) their friends get a
// reminder. Only the day is ever shown, never the year.

const REMIND_HOUR = 9;

/** Checked every few minutes; sends the day's reminders once, from 9 AM. */
export async function sweepBirthdays(now = new Date()): Promise<void> {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(now));
  if (hour < REMIND_HOUR) return;
  const day = today(now);
  // Once a day, even with several servers or restarts.
  const first = await redis.set(`birthdays:sent:${day}`, "1", { NX: true, EX: 3 * 24 * 3600 }).catch(() => null);
  if (first !== "OK") return;
  const md = day.slice(5);
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = md === "02-28" && !leap(+day.slice(0, 4)) ? ["02-28", "02-29"] : [md];
  const people = await db
    .select({ id: users.id, displayName: users.displayName, avatarVersion: users.avatarVersion })
    .from(users)
    .where(and(eq(users.shareBirthday, true), isNull(users.deleteAfter), sql`to_char(${users.birthday}, 'MM-DD') in ${days}`));
  for (const p of people) {
    for (const friendId of await friendIdsOf(p.id)) {
      emitToUser(friendId, "social:changed", {});
      inBackground(notifyFriendNews(friendId, p, "🎂 It's their birthday today! Send them some glow.", "day"));
    }
  }
}

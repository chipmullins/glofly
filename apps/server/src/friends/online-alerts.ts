import { and, eq, or } from "drizzle-orm";
import { db } from "../db";
import { onlineAlerts, users } from "../db/schema";
import { redis } from "../redis";
import { friendIdsOf, type Status } from "../presence";
import { blockedEitherWay } from "./rules";
import { inBackground, notifyFriendOnline } from "../push/notify";

// "Notify me when they come online" (0.3.0). Off for everyone until you turn it on for a person
// (the bell on their profile). When they go from offline to online (or away / busy), you get:
// - on an open app: the "friend:online" live event (desktop toast + sound, phone in-app banner),
// - on phones that aren't open: a push notification.
// Never for someone set to Invisible (they stay offline), never while you're on Do not disturb or
// have "Friends coming online" turned off, and at most once every 30 minutes per person so a
// shaky connection doesn't spam you.

export const ONLINE_ALERT_COOLDOWN_S = 30 * 60;
const cooldownKey = (ownerId: string, targetId: string) => `online-alert:${ownerId}:${targetId}`;

type Emit = (userId: string, event: string, payload: unknown) => void;

/** Who you get alerts for (only people who are still your friends count). */
export async function alertTargetsOf(ownerId: string): Promise<string[]> {
  const rows = await db.select({ id: onlineAlerts.targetId }).from(onlineAlerts).where(eq(onlineAlerts.ownerId, ownerId));
  return rows.map((r) => r.id);
}

export async function setOnlineAlert(ownerId: string, targetId: string, on: boolean): Promise<void> {
  if (on) await db.insert(onlineAlerts).values({ ownerId, targetId }).onConflictDoNothing();
  else await db.delete(onlineAlerts).where(and(eq(onlineAlerts.ownerId, ownerId), eq(onlineAlerts.targetId, targetId)));
}

/** Unfriending or blocking ends alerts both ways. */
export async function clearOnlineAlerts(a: string, b: string): Promise<void> {
  await db
    .delete(onlineAlerts)
    .where(
      or(
        and(eq(onlineAlerts.ownerId, a), eq(onlineAlerts.targetId, b)),
        and(eq(onlineAlerts.ownerId, b), eq(onlineAlerts.targetId, a)),
      ),
    );
}

/** Called by presence when someone's status changes. */
export async function onPresenceChange(userId: string, before: Status | null, after: Status, emit: Emit): Promise<void> {
  if (after === "offline" || (before !== null && before !== "offline")) return;
  const owners = await db
    .select({ id: users.id, master: users.onlineAlerts, status: users.statusPreference })
    .from(onlineAlerts)
    .innerJoin(users, eq(users.id, onlineAlerts.ownerId))
    .where(eq(onlineAlerts.targetId, userId));
  if (!owners.length) return;

  const [who] = await db
    .select({ id: users.id, displayName: users.displayName, username: users.username, avatarVersion: users.avatarVersion, deleteAfter: users.deleteAfter })
    .from(users)
    .where(eq(users.id, userId));
  if (!who || who.deleteAfter) return;
  const friends = new Set(await friendIdsOf(userId));

  for (const owner of owners) {
    if (!owner.master || owner.status === "dnd" || !friends.has(owner.id)) continue;
    if (await blockedEitherWay(owner.id, userId)) continue;
    // Cooldown: SET NX only succeeds if they weren't alerted about this person recently.
    const fresh = await redis.set(cooldownKey(owner.id, userId), "1", { NX: true, EX: ONLINE_ALERT_COOLDOWN_S });
    if (fresh !== "OK") continue;
    emit(owner.id, "friend:online", {
      user: { id: who.id, displayName: who.displayName, username: who.username, avatarVersion: who.avatarVersion },
    });
    inBackground(notifyFriendOnline(owner.id, who));
  }
}

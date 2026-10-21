import { eq } from "drizzle-orm";
import { db } from "../db";
import { serverSettings, users } from "../db/schema";

// 0.8.2 Lockdown (Control → Server / Emergency): while it's on, accounts made in the last 24 hours
// can only talk to the friends they already have: no friend requests or friend links, no joining,
// making or posting in constellations. Kept apart from the routes so any part of the server can ask.

export type LockdownState = { on: boolean; since: string | null };
export const LOCKDOWN_NEW_HOURS = 24;
export const LOCKDOWN_MESSAGE = {
  error: "lockdown",
  message: "Glofly is limiting new accounts for a little while. You can do this once your account is a day old.",
} as const;

let lockCache: { state: LockdownState; at: number } | null = null;

export async function getLockdown(): Promise<LockdownState> {
  if (lockCache && Date.now() - lockCache.at < 5000) return lockCache.state;
  try {
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "lockdown"));
    const v = row?.value as Partial<LockdownState> | undefined;
    const state: LockdownState = { on: v?.on === true, since: typeof v?.since === "string" ? v.since : null };
    lockCache = { state, at: Date.now() };
    return state;
  } catch {
    return lockCache?.state ?? { on: false, since: null };
  }
}

/**
 * Is this person held back by Lockdown right now (it's on and their account is under a day old)?
 * Checked when sending friend requests, using friend links, joining or posting in constellations.
 */
export async function lockedDown(userId: string): Promise<boolean> {
  if (!(await getLockdown()).on) return false;
  const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  return !!row && Date.now() - row.createdAt.getTime() < LOCKDOWN_NEW_HOURS * 60 * 60 * 1000;
}

export async function saveLockdown(state: LockdownState): Promise<void> {
  await db
    .insert(serverSettings)
    .values({ key: "lockdown", value: state })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value: state, updatedAt: new Date() } });
  lockCache = { state, at: Date.now() };
}

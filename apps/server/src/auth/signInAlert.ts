import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { knownDevices, users } from "../db/schema";
import { sendEmail } from "../email/send";
import { newSignInEmail } from "../email/templates";
import { deviceAppName } from "@glofly/shared";

// "New sign-in to your Glofly account" (0.7.3): emailed when an account signs in on a device it
// hasn't used before (same device name and app = the same device). Devices signed in when 0.7.3
// arrived were added by migration 0033, so nobody gets one for those. The same key formula is in
// that migration: change both together.

export const deviceKey = (deviceName: string | null, platform: string | null) =>
  createHash("sha256").update(`${deviceName ?? ""}|${platform ?? "desktop"}`, "utf8").digest("hex");

/** Remembers the device; emails the account owner if it's new (and not their very first). */
export async function noteSignIn(userId: string, deviceName: string | null, platform: string | null): Promise<void> {
  const key = deviceKey(deviceName, platform);
  const [{ known }] = await db
    .select({ known: sql<number>`count(*)::int` })
    .from(knownDevices)
    .where(eq(knownDevices.userId, userId));
  const inserted = await db
    .insert(knownDevices)
    .values({ userId, deviceKey: key })
    .onConflictDoUpdate({ target: [knownDevices.userId, knownDevices.deviceKey], set: { lastSeenAt: new Date() } })
    .returning({ fresh: sql<boolean>`(xmax = 0)` });
  if (!inserted[0]?.fresh || known === 0) return;
  const [u] = await db
    .select({ email: users.email, displayName: users.displayName, username: users.username })
    .from(users)
    .where(eq(users.id, userId));
  if (!u) return;
  const device = [deviceName, deviceAppName(platform)].filter(Boolean).join(" · ");
  await sendEmail(newSignInEmail(u, device, new Date()));
}

import type { Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { serverSettings } from "./db/schema";

// Minimum app version (Control → Announcements → Required update). Apps older than this are
// asked to update: every signed-in request, logging in, signing up and the live connection
// answer 426 "update_required" instead. Apps from before 0.1.8 don't say their version, so
// they count as older than any minimum. Nothing is required until a minimum is set.
//
// Each platform has its own minimum, since the phone apps number their versions separately
// (they start at 1.0.0). Apps say which they are in X-Glofly-Platform ("android", "ios");
// the desktop apps don't send it, so no header means desktop and nothing changes for them.

/** "0.1.8" from the app's X-Glofly-Version header, or null (older apps don't send it). */
export function appVersionFrom(header: unknown): string | null {
  return typeof header === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(header) ? header : null;
}

// "web" (Oct 2026) is Glofly in a browser at chat.glofly.app. It numbers its versions like the
// desktop app (it's built from the same screens) but has its own minimum, and it never counts as a
// phone ("Active on mobile", push rules for phones that left Glofly).
export type AppPlatform = "desktop" | "android" | "ios" | "web";
export const PLATFORMS: AppPlatform[] = ["desktop", "android", "ios", "web"];

/** Which app this is, from X-Glofly-Platform (or the live connection's auth). Missing = desktop. */
export function platformFrom(value: unknown): AppPlatform {
  return value === "android" || value === "ios" || value === "web" ? value : "desktop";
}

export const isPlatform = (v: unknown): v is AppPlatform =>
  v === "desktop" || v === "android" || v === "ios" || v === "web";

/** The phone apps (not desktop, not a browser). */
export const isPhonePlatform = (v: unknown): boolean => v === "android" || v === "ios";

export const DOWNLOAD_URL = "https://glofly.app/download";

/** Where each app gets its update ("Please update Glofly" → Download). */
export const DOWNLOAD_URLS: Record<AppPlatform, string> = {
  desktop: DOWNLOAD_URL,
  android: "https://play.google.com/store/apps/details?id=com.glofly.app",
  ios: "https://glofly.app/download/ios",
  // A browser updates by reloading the page.
  web: process.env.WEB_ORIGIN?.trim() || "https://chat.glofly.app",
};

/** The settings key: desktop keeps the original "minVersion" (Control v2 wrote it). */
const settingsKey = (platform: AppPlatform) => (platform === "desktop" ? "minVersion" : `minVersion:${platform}`);

/** Compares "0.2.0"-style versions: negative if a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const isVersion = (v: unknown): v is string =>
  typeof v === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(v);

// Checked on every request, so it's kept for a few seconds (and updated at once when Control
// changes it on this server).
type Minimum = { min: string | null; message: string | null; at: number };
const cached = new Map<AppPlatform, Minimum>();

export async function getMinVersion(
  platform: AppPlatform = "desktop",
): Promise<{ min: string | null; message: string | null }> {
  const hit = cached.get(platform);
  if (hit && Date.now() - hit.at < 10_000) return hit;
  try {
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, settingsKey(platform)));
    const value = row?.value as { version?: unknown; message?: unknown } | undefined;
    const fresh: Minimum = {
      min: isVersion(value?.version) ? value.version : null,
      message: typeof value?.message === "string" && value.message ? value.message : null,
      at: Date.now(),
    };
    cached.set(platform, fresh);
    return fresh;
  } catch {
    // The database is having a moment: don't lock anyone out over it.
    return hit ?? { min: null, message: null };
  }
}

export async function setMinVersion(
  version: string | null,
  message: string | null,
  platform: AppPlatform = "desktop",
): Promise<void> {
  const value = { version, message };
  await db
    .insert(serverSettings)
    .values({ key: settingsKey(platform), value })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value, updatedAt: new Date() } });
  cached.set(platform, { min: version, message, at: Date.now() });
}

/** Is an app reporting this version (or nothing) too old for its platform's minimum? */
export async function tooOld(versionHeader: unknown, platform: AppPlatform = "desktop"): Promise<boolean> {
  const { min } = await getMinVersion(platform);
  if (!min) return false;
  const version = appVersionFrom(versionHeader) ?? "0.0.0";
  return compareVersions(version, min) < 0;
}

/** What a too-old app is told (the app shows "Please update Glofly"). */
export async function updateRequiredBody(platform: AppPlatform = "desktop") {
  const { min, message } = await getMinVersion(platform);
  return {
    error: "update_required",
    message: message ?? "This version of Glofly is too old. Please update to keep using it.",
    minVersion: min,
    downloadUrl: DOWNLOAD_URLS[platform],
  };
}

export async function refuseIfTooOld(req: Request, res: Response): Promise<boolean> {
  const platform = platformFrom(req.headers["x-glofly-platform"]);
  if (!(await tooOld(req.headers["x-glofly-version"], platform))) return false;
  res.status(426).json(await updateRequiredBody(platform));
  return true;
}

/** Put in front of routes older apps must not use (login, sign-up). */
export const requireCurrentApp: RequestHandler = async (req, res, next) => {
  if (await refuseIfTooOld(req, res)) return;
  next();
};

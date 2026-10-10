import type { Request, RequestHandler, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { serverSettings } from "./db/schema";

// Minimum app version (Control → Announcements → Required update). Apps older than this are
// asked to update: every signed-in request, logging in, signing up and the live connection
// answer 426 "update_required" instead. Apps from before 0.1.8 don't say their version, so
// they count as older than any minimum. Nothing is required until a minimum is set.

/** "0.1.8" from the app's X-Glofly-Version header, or null (older apps don't send it). */
export function appVersionFrom(header: unknown): string | null {
  return typeof header === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(header) ? header : null;
}

export const DOWNLOAD_URL = "https://glofly.app/download";

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
let cached: { min: string | null; message: string | null; at: number } | null = null;

export async function getMinVersion(): Promise<{ min: string | null; message: string | null }> {
  if (cached && Date.now() - cached.at < 10_000) return cached;
  try {
    const [row] = await db.select().from(serverSettings).where(eq(serverSettings.key, "minVersion"));
    const value = row?.value as { version?: unknown; message?: unknown } | undefined;
    cached = {
      min: isVersion(value?.version) ? value.version : null,
      message: typeof value?.message === "string" && value.message ? value.message : null,
      at: Date.now(),
    };
  } catch {
    // The database is having a moment: don't lock anyone out over it.
    return cached ?? { min: null, message: null };
  }
  return cached;
}

export async function setMinVersion(version: string | null, message: string | null): Promise<void> {
  const value = { version, message };
  await db
    .insert(serverSettings)
    .values({ key: "minVersion", value })
    .onConflictDoUpdate({ target: serverSettings.key, set: { value, updatedAt: new Date() } });
  cached = { min: version, message, at: Date.now() };
}

/** Is an app reporting this version (or nothing) too old? */
export async function tooOld(versionHeader: unknown): Promise<boolean> {
  const { min } = await getMinVersion();
  if (!min) return false;
  const version = appVersionFrom(versionHeader) ?? "0.0.0";
  return compareVersions(version, min) < 0;
}

/** What a too-old app is told (the app shows "Please update Glofly"). */
export async function updateRequiredBody() {
  const { min, message } = await getMinVersion();
  return {
    error: "update_required",
    message: message ?? "This version of Glofly is too old. Please update to keep using it.",
    minVersion: min,
    downloadUrl: DOWNLOAD_URL,
  };
}

export async function refuseIfTooOld(req: Request, res: Response): Promise<boolean> {
  if (!(await tooOld(req.headers["x-glofly-version"]))) return false;
  res.status(426).json(await updateRequiredBody());
  return true;
}

/** Put in front of routes older apps must not use (login, sign-up). */
export const requireCurrentApp: RequestHandler = async (req, res, next) => {
  if (await refuseIfTooOld(req, res)) return;
  next();
};

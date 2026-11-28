import { createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { storage } from "../storage";
import { BOT_TOKEN_VALUE } from "./discordApi";

// Pictures for the Discord bridge, both ways (a leaf: discord.ts and voice.ts both use it).
//
// Discord → Glofly: a Discord person's picture is copied once into Glofly's storage and served
// from GET /bridge/avatars/<discordUserId>/<hash> (so Glofly apps never load anything from Discord).
//
// Glofly → Discord (Nov 28): Discord loads a webhook's avatar_url itself, without signing in, so
// the usual /avatars/<user>/<version> (signed-in only) never worked: Glofly people showed with
// Discord's default picture. The bridge now hands Discord a signed address instead,
// /bridge/glofly-avatars/<user>/<version>/<sig>.png. Only the server can make one (the signature
// is an HMAC with a key derived from the bot token), it only works for that person's current
// photo, and it's only ever given to Discord along with a message that person sent into a
// bridged nebula.

export const CDN = (process.env.DISCORD_CDN_URL?.trim() || "https://cdn.discordapp.com").replace(/\/+$/, "");

export const discordAvatarKey = (uid: string, hash: string) => `bridge/avatars/${uid}/${hash}.webp`;
const savedAvatars = new Set<string>();

/** Copies a Discord person's picture into Glofly (once). False when it couldn't. */
export async function saveDiscordAvatar(uid: string, hash: string): Promise<boolean> {
  const key = discordAvatarKey(uid, hash);
  if (savedAvatars.has(key)) return true;
  try {
    const res = await fetch(`${CDN}/avatars/${uid}/${hash}.png?size=128`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!res.ok) return false;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 2 * 1024 * 1024) return false;
    const webp = await sharp(data, { limitInputPixels: 4_000_000 }).resize(128, 128, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    await storage.put(key, webp, "image/webp");
    // Only a memory of what's already saved: start over past 5,000 (robustness round, Nov 14).
    if (savedAvatars.size >= 5000) savedAvatars.clear();
    savedAvatars.add(key);
    return true;
  } catch {
    return false;
  }
}

/** `<uid>/<hash>` for BridgedFrom / DiscordVoicePerson, or null (no picture, or it couldn't be copied). */
export async function discordAvatarRef(uid: string, hash: string | null | undefined): Promise<string | null> {
  if (!hash || !/^(a_)?[0-9a-f]{32}$/.test(hash) || !/^\d{5,25}$/.test(uid)) return null;
  return (await saveDiscordAvatar(uid, hash)) ? `${uid}/${hash}` : null;
}

const signingKey = createHmac("sha256", "glofly-bridge-avatars").update(BOT_TOKEN_VALUE || "no-bridge").digest();

export function gloflyAvatarSig(userId: string, version: string): string {
  return createHmac("sha256", signingKey).update(`${userId}/${version}`).digest("base64url").slice(0, 32);
}

export function gloflyAvatarSigOk(userId: string, version: string, sig: string): boolean {
  const want = Buffer.from(gloflyAvatarSig(userId, version));
  const got = Buffer.from(sig);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** The public, signed picture address handed to Discord for a Glofly person's posts. */
export function gloflyAvatarUrl(base: string, userId: string, version: string): string {
  return `${base}/bridge/glofly-avatars/${userId}/${version}/${gloflyAvatarSig(userId, version)}.png`;
}

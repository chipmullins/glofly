// Which requests are photo/file loads (auth/sessions.ts lets them past the minimum app version).

// Photos, files, voice messages and videos the apps load straight by their address. These
// requests can't say the app's version: a browser's <img> sends no extra headers at all, and the
// desktop app's photo loader (main/media.ts) never did. A missing version counts as 0.0.0, so once a
// minimum desktop version was set in Control, every photo, chat photo and download on desktop and
// chat.glofly.app was refused with 426 ("Photo unavailable", "That file is no longer available")
// while the chats themselves kept working. Reading them is harmless for an old app (still signed in,
// still only your own chats), so the minimum doesn't apply to them; everything else still asks.
const MEDIA_READS: RegExp[] = [
  /^\/avatars\/[^/]+\/[^/]+$/,
  /^\/conversations\/[^/]+\/photo\/[^/]+$/,
  /^\/conversations\/[^/]+\/attachments\/[^/]+\/(preview|full|file|poster|video|m4a)$/,
  /^\/conversations\/[^/]+\/messages\/[^/]+\/preview-image$/,
  /^\/stickers\/[^/]+\/image$/,
  /^\/constellations\/[^/]+\/(icon|banner)\/[^/]+$/,
];

/** A GET (or HEAD) for one of the photo/file addresses above. */
export function isMediaRead(method: string, url: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = url.split("?")[0] ?? "";
  return MEDIA_READS.some((r) => r.test(path));
}

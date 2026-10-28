// How many bytes of stored files (photos, videos, voice messages, downloads, profile pictures)
// this server has sent since the last save. storage.ts sendStream adds to it; admin/usage.ts saves
// it to the database every minute (Glofly Control → Usage & costs). No imports, so anything can
// use it. A restart loses at most the last minute's count.

let pending = 0;

export function noteSent(bytes: number): void {
  if (Number.isFinite(bytes) && bytes > 0) pending += bytes;
}

/** Takes what's been counted since the last call (and starts counting from zero again). */
export function takeSent(): number {
  const n = pending;
  pending = 0;
  return n;
}

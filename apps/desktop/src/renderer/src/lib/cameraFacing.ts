// Your own camera shows like a mirror (Settings → Voice & video), but only a camera pointing at
// you: a tablet's or phone's back camera mirrored makes the room and any writing read backwards.

/** A back camera's name, e.g. Android Chrome's "camera2 0, facing back", or "Rear Camera". */
const BACK_LABEL = /\b(back|rear|environment)\b/i

/**
 * Whether this camera points away from you. Uses what the browser reports (facingMode on tablets
 * and phones), otherwise the camera's name. Webcams report neither, so they count as facing you.
 */
export function isBackCamera(track: MediaStreamTrack | null | undefined): boolean {
  if (!track) return false
  const facing = track.getSettings?.().facingMode
  if (facing === 'user') return false
  if (facing === 'environment') return true
  return BACK_LABEL.test(track.label)
}

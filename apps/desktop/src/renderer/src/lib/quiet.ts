import { inQuietHours, type QuietHours } from '@glofly/shared/chatTools'

// 0.7.3 quiet hours (Settings → Notifications & sounds): between the chosen times, no message
// sounds and no notifications on this computer; the ringtone too unless "Let calls ring" is on.
// The server does the same for phones. Kept here for sounds.ts and notify.ts; MainScreen loads it
// at start and again when the account changes on another device.

let current: QuietHours | null = null

export function setQuietHours(q: QuietHours | null): void {
  current = q
}
export const quietHoursSetting = (): QuietHours | null => current

/** Quiet right now? For a call: only if calls don't ring during quiet hours. */
export function inQuiet(forCall = false): boolean {
  if (!current) return false
  if (forCall && current.calls) return false
  return inQuietHours(current)
}

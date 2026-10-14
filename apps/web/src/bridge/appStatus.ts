import type { Paused, UpdateRequired } from '../../../desktop/src/preload/api-types'
import { pausedFrom } from '@glofly/shared/types'
import { API_URL } from './config'
import { emit } from './events'

// "Please update Glofly" and "Glofly is paused", as in the desktop app (src/main/app-status.ts).
// A browser "updates" by reloading the page, so the download is always this page's address.

let required: UpdateRequired | null = null

export const getUpdateRequired = (): UpdateRequired | null => required

/** Called with the server's 426 answer (or the live connection's update notice). */
export function noteUpdateRequired(body: unknown): UpdateRequired {
  const b = (body ?? {}) as { message?: unknown; minVersion?: unknown }
  required = {
    message:
      typeof b.message === 'string' && b.message.length <= 300
        ? b.message
        : 'This version of Glofly is too old. Please reload to keep using it.',
    minVersion:
      typeof b.minVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(b.minVersion)
        ? b.minVersion
        : null,
    downloadUrl: location.origin
  }
  emit({ type: 'app:update-required', ...required })
  return required
}

let paused: Paused | null = null
let timer: ReturnType<typeof setTimeout> | null = null
const CHECK_MS = 30_000

export const getPaused = (): Paused | null => paused

/** Called with the server's 503 "paused" answer or the live connection's notice. True if it was one. */
export function notePaused(body: unknown): boolean {
  const next = pausedFrom(body)
  if (!next) return false
  const changed = !paused || paused.message !== next.message
  paused = next
  if (changed) emit({ type: 'app:paused', ...next })
  scheduleCheck()
  return true
}

function scheduleCheck(delay = CHECK_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void checkPausedNow(), delay)
}

/** Asks the server now. The pause if it's still on, or null once Glofly is back. */
export async function checkPausedNow(): Promise<Paused | null> {
  if (!paused) return null
  try {
    const response = await fetch(`${API_URL}/status`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000)
    })
    const body = (await response.json().catch(() => null)) as {
      paused?: unknown
      message?: unknown
      since?: unknown
    } | null
    if (response.ok && body?.paused === false) {
      paused = null
      if (timer) clearTimeout(timer)
      timer = null
      emit({ type: 'app:resumed' })
      return null
    }
    if (response.ok && body?.paused === true) notePaused({ ...body, error: 'paused' })
  } catch {
    // Can't reach it (restarting, offline): ask again later.
  }
  if (paused) scheduleCheck()
  return paused
}

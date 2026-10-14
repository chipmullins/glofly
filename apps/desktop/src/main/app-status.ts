import { BrowserWindow } from 'electron'
import type { Paused, UpdateRequired } from '../preload/api-types'
import { pausedFrom } from '@glofly/shared/types'

// "Please update Glofly": the server answered 426 update_required (Glofly Control set a
// minimum app version newer than this one). Remembered until Glofly restarts, and the
// window is told so it can show the update screen.

let required: UpdateRequired | null = null

export function getUpdateRequired(): UpdateRequired | null {
  return required
}

/** Only https links from glofly.app are offered as the download. */
function safeDownloadUrl(value: unknown): string {
  const fallback =
    process.platform === 'darwin'
      ? 'https://glofly.app/download/mac'
      : 'https://glofly.app/download'
  if (typeof value !== 'string') return fallback
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !/(^|\.)glofly\.app$/.test(url.hostname)) return fallback
    // Mac copies get the Mac download.
    return process.platform === 'darwin' && url.pathname === '/download' ? fallback : url.href
  } catch {
    return fallback
  }
}

/** Called with the server's 426 answer (or the live connection's update notice). */
export function noteUpdateRequired(body: unknown): UpdateRequired {
  const b = (body ?? {}) as { message?: unknown; minVersion?: unknown; downloadUrl?: unknown }
  required = {
    message:
      typeof b.message === 'string' && b.message.length <= 300
        ? b.message
        : 'This version of Glofly is too old. Please update to keep using it.',
    minVersion:
      typeof b.minVersion === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(b.minVersion)
        ? b.minVersion
        : null,
    downloadUrl: safeDownloadUrl(b.downloadUrl)
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('glofly:event', { type: 'app:update-required', ...required })
  }
  return required
}

// ───────────── "Glofly is paused" (0.4.0) ─────────────
// Glofly Control → Server → Pause Glofly: the server answers 503 "paused" to everything and
// closes live connections (telling the app first). The window shows "Glofly is paused" and this
// asks the server's /status every 30 seconds; once it's back, the window reloads (signing back
// in with the saved session and reconnecting).

let paused: Paused | null = null
let statusUrl: string | null = null
let timer: NodeJS.Timeout | null = null
const CHECK_MS = 30_000

/** Where to ask whether Glofly is still paused (set once at startup). */
export function configurePauseChecks(apiUrl: string): void {
  statusUrl = `${apiUrl}/status`
}

export function getPaused(): Paused | null {
  return paused
}

function send(event: Record<string, unknown>): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('glofly:event', event)
}

/** Called with the server's 503 "paused" answer or the live connection's notice. True if it was one. */
export function notePaused(body: unknown): boolean {
  const next = pausedFrom(body)
  if (!next) return false
  const changed = !paused || paused.message !== next.message
  paused = next
  if (changed) send({ type: 'app:paused', ...next })
  scheduleCheck()
  return true
}

function scheduleCheck(delay = CHECK_MS): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void checkPausedNow(), delay)
}

/** Asks the server now. Returns the pause if still paused, or null once Glofly is back. */
export async function checkPausedNow(): Promise<Paused | null> {
  if (!paused || !statusUrl) return paused
  try {
    const response = await fetch(statusUrl, { signal: AbortSignal.timeout(8_000) })
    const body = (await response.json().catch(() => null)) as {
      paused?: unknown
      message?: unknown
      since?: unknown
    } | null
    if (response.ok && body?.paused === false) {
      paused = null
      if (timer) clearTimeout(timer)
      timer = null
      send({ type: 'app:resumed' })
      return null
    }
    if (response.ok && body?.paused === true) notePaused({ ...body, error: 'paused' })
  } catch {
    // Can't reach it (restarting, offline): ask again later.
  }
  if (paused) scheduleCheck()
  return paused
}

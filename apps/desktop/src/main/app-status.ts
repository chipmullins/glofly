import { BrowserWindow } from 'electron'
import type { UpdateRequired } from '../preload/api-types'

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

import { app, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { friendLinkCodeFrom } from '@glofly/shared/friendLinks'
import { showWindow } from './app-settings'
import type { DeepLink } from '../preload/api-types'

// 0.8.0: glofly:// links. "Open in Glofly" on a friend's invite page (glofly.app/i/<code>) opens
// glofly://i/<code>; a constellation invite page (glofly.app/c/<code>) opens glofly://c/<code>.
// Windows hands the link to a new Glofly as a command-line argument, which the
// one-Glofly-at-a-time lock passes to the running copy (second-instance); macOS sends `open-url`.
// The window does the work, the same way as the Jump List: on a `deep-link` event, and once when
// it's ready, it calls take() and asks "Add Chip as a friend?" (nothing happens by itself).

const SCHEME = 'glofly'

/** A link waiting for the window (Glofly was started by it, or the window wasn't listening). */
let pending: DeepLink | null = null

/** What a glofly:// link asks for, or null for anything else. */
export function parseDeepLink(raw: string): DeepLink | null {
  if (typeof raw !== 'string' || raw.length > 200 || !raw.toLowerCase().startsWith(`${SCHEME}://`))
    return null
  const rest = raw.slice(SCHEME.length + 3)
  if (/^i\//i.test(rest)) {
    const code = friendLinkCodeFrom(`i/${rest.slice(2)}`)
    return code ? { kind: 'friend', code } : null
  }
  const c = rest.match(/^c\/([A-Za-z0-9]{6,16})\/?(?:[?#].*)?$/i)
  return c ? { kind: 'constellation', code: c[1] } : null
}

function deliver(link: DeepLink): void {
  pending = link
  showWindow()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && !window.webContents.isLoading()) {
      window.webContents.send('glofly:event', { type: 'deep-link' })
    }
  }
}

/** The link waiting for the window (once). */
export function takeDeepLink(): DeepLink | null {
  const link = pending
  pending = null
  return link
}

/** A glofly:// link among these command-line arguments (Windows, Linux). */
export function deepLinkFromArgv(argv: readonly string[]): DeepLink | null {
  for (const arg of argv) {
    const link = parseDeepLink(arg)
    if (link) return link
  }
  return null
}

/** A second launch carried a link: true if it did (the window is brought forward either way). */
export function handleDeepLinkArgv(argv: readonly string[]): boolean {
  const link = deepLinkFromArgv(argv)
  if (link) deliver(link)
  return !!link
}

/**
 * Makes Glofly the app for glofly:// links and listens for them. Call before the app is ready
 * (macOS sends `open-url` for the link Glofly was started with very early).
 */
export function setupDeepLinks(): void {
  if (process.defaultApp && process.argv[1]) {
    // A development copy runs as "electron.exe <app folder>": the link must start the same.
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(SCHEME)
  }
  const first = deepLinkFromArgv(process.argv)
  if (first) pending = first
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const link = parseDeepLink(url)
    if (!link) return
    if (app.isReady()) deliver(link)
    else pending = link
  })
}

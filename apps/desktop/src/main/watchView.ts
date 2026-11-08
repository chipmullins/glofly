import { join } from 'path'
import type { BrowserWindow } from 'electron'
import { watchPlayerUrl } from './calls'

// 0.9.3: Twitch and Kick in Watch Together. Their players only play when every page above them
// has a real web address, and the Glofly window is a file on the computer. So for those two the
// window shows the server's player page in a <webview> (a page of its own, at the server's https
// address) instead of an iframe. Locked down here: only the player page may be shown, with no
// Node, its own tiny preload (watchHost.ts: send reports to the window, nothing else), its own
// cookie-less session, no pop-ups and no navigating anywhere else.

const PARTITION = 'watch-together'
const isPlayerPage = (url: string): boolean => {
  try {
    const u = new URL(url)
    const p = new URL(watchPlayerUrl())
    return u.origin === p.origin && u.pathname === p.pathname
  } catch {
    return false
  }
}

export function guardWatchView(window: BrowserWindow): void {
  window.webContents.on('will-attach-webview', (event, prefs, params) => {
    if (!isPlayerPage(params.src) || (params.partition && params.partition !== PARTITION)) {
      event.preventDefault()
      return
    }
    // Whatever the page asked for, the guest gets exactly this.
    delete (prefs as { preloadURL?: string }).preloadURL
    prefs.preload = join(__dirname, '../preload/watchHost.js')
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    prefs.allowRunningInsecureContent = false
    prefs.partition = PARTITION
    params.partition = PARTITION
  })
  window.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(() => ({ action: 'deny' }))
    guest.on('will-navigate', (e, url) => {
      if (!isPlayerPage(url)) e.preventDefault()
    })
    guest.on('will-redirect', (e, url) => {
      if (!isPlayerPage(url)) e.preventDefault()
    })
    guest.session.setPermissionRequestHandler((_wc, permission, callback) =>
      callback(permission === 'fullscreen')
    )
  })
}

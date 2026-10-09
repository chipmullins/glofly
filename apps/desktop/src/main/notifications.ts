import { app, BrowserWindow, nativeImage, Notification } from 'electron'
import type { ShowNotification } from '../preload/api-types'
import { showWindow } from './app-settings'

// Windows notifications (toasts) and the unread badge on the taskbar icon.
//
// The window decides when a notification is worth showing (you're not looking, Do not disturb
// is off, notifications are on) and what it says; this part shows it, keeps one per chat (a new
// message replaces the last one), and brings Glofly to that chat when it's clicked.

/** The notifications on screen, by key, so they can be replaced or taken away. */
const shown = new Map<string, Notification>()

const MAX_TEXT = 300
const MAX_PICTURE = 200 * 1024

/** A picture from the window: only a small PNG drawn by Glofly itself. */
function picture(dataUrl: unknown): Electron.NativeImage | undefined {
  if (
    typeof dataUrl !== 'string' ||
    !dataUrl.startsWith('data:image/png;base64,') ||
    dataUrl.length > MAX_PICTURE
  ) {
    return undefined
  }
  const image = nativeImage.createFromDataURL(dataUrl)
  return image.isEmpty() ? undefined : image
}

export function isShowNotification(value: unknown): value is ShowNotification {
  const v = value as Partial<ShowNotification> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.key === 'string' &&
    v.key.length <= 60 &&
    (v.conversationId === null ||
      (typeof v.conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(v.conversationId))) &&
    typeof v.title === 'string' &&
    typeof v.body === 'string' &&
    (v.icon === null || typeof v.icon === 'string') &&
    (v.call === undefined || typeof v.call === 'boolean')
  )
}

export function showNotification(n: ShowNotification, appIcon: string): void {
  if (!Notification.isSupported()) return
  clearNotification(n.key)
  const toast = new Notification({
    title: n.title.slice(0, 100),
    body: n.body.slice(0, MAX_TEXT),
    icon: picture(n.icon) ?? appIcon,
    // Glofly plays its own sounds (Settings → Notifications & sounds), so Windows stays quiet.
    silent: true,
    timeoutType: n.call ? 'never' : 'default',
    urgency: n.call ? 'critical' : 'normal'
  })
  toast.on('click', () => {
    showWindow()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('glofly:event', {
        type: 'notification:click',
        conversationId: n.conversationId
      })
    }
    clearNotification(n.key)
  })
  toast.on('close', () => {
    if (shown.get(n.key) === toast) shown.delete(n.key)
  })
  shown.set(n.key, toast)
  toast.show()
}

export function clearNotification(key: string): void {
  const old = shown.get(key)
  if (!old) return
  shown.delete(key)
  old.close()
}

/** Takes every Glofly notification away (signing out). */
export function clearAllNotifications(): void {
  for (const key of [...shown.keys()]) clearNotification(key)
}

/** The unread count on the taskbar icon (a small red badge drawn by the window), or the Mac Dock. */
export function setBadge(window: BrowserWindow | null, count: number, image: unknown): void {
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, 999) : 0
  if (process.platform === 'win32') {
    window?.setOverlayIcon(n > 0 ? (picture(image) ?? null) : null, n > 0 ? `${n} unread` : '')
  } else if (process.platform === 'darwin') {
    // The red badge on Glofly's Dock icon (drawn by macOS; "99+" like the taskbar badge).
    app.dock?.setBadge(n === 0 ? '' : n > 99 ? '99+' : String(n))
  } else {
    app.setBadgeCount(n)
  }
}

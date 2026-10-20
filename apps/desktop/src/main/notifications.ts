import { app, BrowserWindow, nativeImage, Notification } from 'electron'
import type { ShowNotification } from '../preload/api-types'
import { showWindow } from './app-settings'
import { markRead, sendMessage } from './messages'
import { badgeNumber, badgeText, cleanReply, replyTarget } from './taskbar-core'

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
  const replyTo = replyTarget(n)
  const toast = new Notification({
    title: n.title.slice(0, 100),
    body: n.body.slice(0, MAX_TEXT),
    icon: picture(n.icon) ?? appIcon,
    // Glofly plays its own sounds (Settings → Notifications & sounds), so Windows stays quiet.
    silent: true,
    timeoutType: n.call ? 'never' : 'default',
    urgency: n.call ? 'critical' : 'normal',
    // Messages (chats, groups, nebulas) get a Reply box, on Windows and the Mac alike. Electron
    // builds the Windows toast itself, so names and text never end up as raw toast XML. It's
    // there even when previews are off: the text stays hidden, answering is still fine.
    ...(replyTo ? { hasReply: true, replyPlaceholder: 'Reply…' } : {})
  })
  if (replyTo) {
    toast.on('reply', (details) => {
      clearNotification(n.key)
      void sendReply(replyTo, details.reply)
    })
  }
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
  const forget = (): void => {
    if (shown.get(n.key) === toast) shown.delete(n.key)
  }
  toast.on('close', forget)
  // Electron 42+ on a Mac: an unsigned test build can't show notifications (they fail instead).
  toast.on('failed', forget)
  shown.set(n.key, toast)
  toast.show()
}

/** Sends a reply typed into a notification, then marks the chat read (here and in the window). */
async function sendReply(conversationId: string, typed: string): Promise<void> {
  const text = cleanReply(typed)
  if (!text) return
  const sent = await sendMessage(conversationId, text)
  if (!sent.ok) {
    // Not sent (offline, signed out, can't post there): say so rather than lose it quietly.
    if (Notification.isSupported()) {
      new Notification({
        title: 'Your reply wasn’t sent',
        body: sent.message.slice(0, MAX_TEXT),
        silent: true
      }).show()
    }
    return
  }
  const read = await markRead(conversationId)
  if (!read.ok) return
  // The window refreshes its chat list (and the badge) like after "mark unread" on another device.
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('glofly:event', {
      type: 'conversation:unread',
      conversationId,
      lastReadAt: new Date().toISOString()
    })
  }
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
  const n = badgeNumber(count)
  if (process.platform === 'win32') {
    window?.setOverlayIcon(n > 0 ? (picture(image) ?? null) : null, n > 0 ? `${n} unread` : '')
  } else if (process.platform === 'darwin') {
    // The red badge on Glofly's Dock icon (drawn by macOS; "99+" like the taskbar badge).
    app.dock?.setBadge(badgeText(n))
  } else {
    app.setBadgeCount(n)
  }
}

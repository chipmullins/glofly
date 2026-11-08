import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, nativeImage, Notification, shell } from 'electron'
import type { ShowNotification, ToastButtonId } from '../preload/api-types'
import { showWindow } from './app-settings'
import { markRead, muteConversation, muteConversationUntil, sendMessage } from './messages'
import { badgeNumber, badgeText, cleanReply, replyTarget } from './taskbar-core'
import { buildToastXml, isRichNotification, payloadFrom, tomorrowMorning } from './toastXml'

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
    (v.call === undefined || typeof v.call === 'boolean') &&
    (v.rich === undefined || isRichNotification(v.rich))
  )
}

// ---------------------------------------------------------------------------------------
// 0.9.3: Glofly's own Windows notifications (round photo, buttons, call style, pictures).

/** Settings → Notifications & sounds → "Glofly-style notifications" (Windows; on by default). */
let richOn = true
export function setRichNotifications(on: boolean): void {
  richOn = on
}

const MAX_RICH_PICTURE = 1_500_000
let pictureDir: string | null = null

/** Where toast pictures go: Windows reads them from disk. Old ones are cleared at start. */
function toastFolder(): string {
  if (pictureDir) return pictureDir
  pictureDir = join(app.getPath('temp'), 'glofly-toasts')
  mkdirSync(pictureDir, { recursive: true })
  try {
    const dayAgo = Date.now() - 24 * 3600_000
    for (const name of readdirSync(pictureDir)) {
      const file = join(pictureDir, name)
      if (statSync(file).mtimeMs < dayAgo) rmSync(file, { force: true })
    }
  } catch {
    // a file in use: next time
  }
  return pictureDir
}

/** Saves a picture from the window (PNG or JPEG data: URL only) and returns its file:/// address. */
function savePicture(dataUrl: unknown, max: number): string | null {
  if (typeof dataUrl !== 'string' || dataUrl.length > max) return null
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return null
  const bytes = Buffer.from(m[2], 'base64')
  // Check it really is that kind of picture (PNG / JPEG signature).
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if ((m[1] === 'png' && !png) || (m[1] === 'jpeg' && !jpeg)) return null
  try {
    const name = `${createHash('sha1').update(bytes).digest('hex')}.${m[1] === 'png' ? 'png' : 'jpg'}`
    const file = join(toastFolder(), name)
    writeFileSync(file, bytes)
    return pathToFileURL(file).href
  } catch {
    return null
  }
}

/** The notifications shown with buttons, by key: what each button index was. */
const richButtons = new Map<string, ToastButtonId[]>()

/**
 * Presses on Glofly's Windows notifications (the toast, a button, or Send in its reply box).
 * Electron hands every one of them here, also after Glofly restarted or the notification object
 * is gone (Action Center). Registered once at start (Windows only).
 */
export function listenToNotificationPresses(): void {
  if (process.platform !== 'win32' || typeof Notification.handleActivation !== 'function') return
  Notification.handleActivation((details) => {
    const p = payloadFrom(details.arguments ?? '')
    if (!p) return
    if (recentlyHandled(details.arguments)) return
    if (details.type === 'reply') {
      const typed = details.reply ?? details.userInputs?.reply ?? ''
      clearNotification(p.k)
      const to = replyTarget({ key: p.k, conversationId: p.c })
      if (to) void sendReply(to, typed)
      return
    }
    const action = p.a ?? (details.type === 'action' ? richButtons.get(p.k)?.[details.actionIndex ?? -1] : undefined)
    if (!action) {
      clickThrough(p.c, p.k)
      clearNotification(p.k)
      return
    }
    clearNotification(p.k)
    void runAction(p.k, p.c, action)
  })
}

const handled = new Map<string, number>()
function recentlyHandled(args: string): boolean {
  const now = Date.now()
  for (const [k, at] of handled) if (now - at > 3000) handled.delete(k)
  if (handled.has(args)) return true
  handled.set(args, now)
  return false
}

function clickThrough(conversationId: string | null, key: string): void {
  showWindow()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('glofly:event', { type: 'notification:click', conversationId, key })
  }
}

/** Buttons that only need the server run here; the rest go to the window (calls, friends, Watch). */
async function runAction(key: string, conversationId: string | null, action: ToastButtonId): Promise<void> {
  if (conversationId && (action === 'read' || action === 'mute-1h' || action === 'mute-tomorrow')) {
    if (action === 'read') await markRead(conversationId)
    else if (action === 'mute-1h') await muteConversation(conversationId, '1h')
    else await muteConversationUntil(conversationId, tomorrowMorning().toISOString())
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('glofly:event', {
        type: 'conversation:unread',
        conversationId,
        lastReadAt: new Date().toISOString()
      })
    }
    return
  }
  // A friend's stream (key "live:…"): the window opens the stream's page, so it goes there.
  if (action === 'open' && !key.startsWith('live:')) {
    showWindow()
    return
  }
  // Answering, joining, watching and opening need Glofly in front; declining doesn't.
  if (action !== 'decline' && action !== 'not-now' && action !== 'accept' && action !== 'mute-live' && !(action === 'open' && key.startsWith('live:'))) showWindow()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('glofly:event', { type: 'notification:action', key, action, conversationId })
  }
}

function showRichNotification(n: ShowNotification & { rich: NonNullable<ShowNotification['rich']> }): void {
  const faceUri = savePicture(n.icon, MAX_PICTURE)
  const pictureUri = savePicture(n.rich.picture, MAX_RICH_PICTURE)
  const toastXml = buildToastXml({
    key: n.key,
    conversationId: n.conversationId,
    title: n.title,
    body: n.body,
    rich: n.rich,
    faceUri,
    pictureUri
  })
  const toast = new Notification({
    toastXml,
    id: n.key.slice(0, 60),
    ...(n.rich.header ? { groupId: n.rich.header.id.slice(0, 60) } : {})
  })
  richButtons.set(n.key, (n.rich.buttons ?? []).map((b) => b.id))
  const forget = (): void => {
    if (shown.get(n.key) === toast) {
      shown.delete(n.key)
      richButtons.delete(n.key)
    }
  }
  toast.on('close', forget)
  // A toast Windows refuses (odd XML, too big a picture): show the plain one instead.
  toast.on('failed', () => {
    forget()
    showPlainNotification({ ...n, rich: undefined }, fallbackIcon)
  })
  shown.set(n.key, toast)
  toast.show()
}

let fallbackIcon = ''

export function showNotification(n: ShowNotification, appIcon: string): void {
  if (!Notification.isSupported()) return
  clearNotification(n.key)
  fallbackIcon = appIcon
  if (process.platform === 'win32' && richOn && n.rich) {
    showRichNotification({ ...n, rich: n.rich })
    return
  }
  showPlainNotification(n, appIcon)
}

function showPlainNotification(n: ShowNotification, appIcon: string): void {
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
  richButtons.delete(key)
  old.close()
}

/** Takes every Glofly notification away (signing out). */
export function clearAllNotifications(): void {
  for (const key of [...shown.keys()]) clearNotification(key)
}

/**
 * Oct 30, 2026: a notification on purpose (Settings' "Send a test", and once after the first
 * sign-in on a Mac, so macOS asks "Allow notifications from Glofly?" right then instead of on
 * the first real message, which would be lost if the answer was slow). macOS also hides the Dock's
 * unread badge until Glofly's notifications are allowed (the "Badges" switch).
 */
export function showTestNotification(appIcon: string, welcome: boolean): boolean {
  if (!Notification.isSupported()) return false
  const toast = new Notification({
    title: welcome ? 'Glofly notifications are on' : 'Notifications work!',
    body: welcome
      ? 'New messages and calls will show up here when Glofly isn’t in front.'
      : 'This is how new messages and calls will show up.',
    icon: appIcon,
    silent: true
  })
  toast.on('click', showWindow)
  toast.show()
  return true
}

/** The computer's own notification settings for Glofly (Mac: System Settings → Notifications). */
export function openNotificationSettings(): void {
  if (process.platform === 'darwin') {
    void shell.openExternal(
      'x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.glofly.app'
    )
  } else if (process.platform === 'win32') {
    void shell.openExternal('ms-settings:notifications')
  }
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

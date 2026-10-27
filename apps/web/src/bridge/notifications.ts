import type { NotificationSettings, ShowNotification } from '../../../desktop/src/preload/api-types'
import { isSignedIn, request } from './api'
import { emit } from './events'
import { notificationSettings, onNotificationSettings } from './settings'

// Notifications in a browser.
//
// - While a Glofly tab is open, the window decides when a notification is worth showing (as in
//   the desktop app) and this shows it through the service worker (iPad home-screen Glofly only
//   allows that way), or the plain Notification API where there's no service worker.
// - With every Glofly tab closed, the server sends web pushes (to this browser's subscription,
//   registered with PUT /devices/push like a phone) and the service worker (src/sw.ts) shows them.
//   The server skips the push while this session's live connection is open.
//
// The browser asks "Allow notifications?" only after a click (Settings → Browser notifications,
// or the banner in the main screen); asking on page load is blocked by most browsers anyway.

export const notificationsSupported = (): boolean => typeof Notification !== 'undefined'
export const pushSupported = (): boolean =>
  'serviceWorker' in navigator && typeof PushManager !== 'undefined' && notificationsSupported()

/** 'granted', 'denied', 'default' (not asked yet), or 'unsupported'. */
export function permission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

let worker: ServiceWorkerRegistration | null = null

/** Registers the service worker (live site only; `npm run dev` has none). */
export async function startServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  try {
    worker = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    // Clicking a notification the service worker showed: open that chat in this tab.
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { type?: unknown; conversationId?: unknown } | null
      if (data?.type !== 'glofly:notification-click') return
      const id = data.conversationId
      emit({
        type: 'notification:click',
        conversationId: typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null
      })
    })
  } catch (err) {
    console.warn('[glofly] service worker not registered', err)
  }
}

const plain = new Map<string, Notification>()

export async function showNotification(n: ShowNotification): Promise<void> {
  if (permission() !== 'granted') return
  const options: NotificationOptions & { renotify?: boolean; requireInteraction?: boolean } = {
    body: n.body.slice(0, 300),
    tag: n.key,
    icon: n.icon ?? '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    // Glofly plays its own sounds (Settings → Notifications & sounds).
    silent: true,
    renotify: true,
    requireInteraction: !!n.call,
    data: { conversationId: n.conversationId }
  }
  const title = n.title.slice(0, 100)
  if (worker) {
    try {
      await worker.showNotification(title, options)
      return
    } catch {
      // Fall back to a plain notification below.
    }
  }
  try {
    plain.get(n.key)?.close()
    const note = new Notification(title, options)
    note.onclick = () => {
      window.focus()
      emit({ type: 'notification:click', conversationId: n.conversationId })
      note.close()
    }
    note.onclose = () => {
      if (plain.get(n.key) === note) plain.delete(n.key)
    }
    plain.set(n.key, note)
  } catch {
    // Some browsers (iPad Safari outside a home-screen app) only show them from a service worker.
  }
}

export async function clearNotification(key: string): Promise<void> {
  plain.get(key)?.close()
  plain.delete(key)
  if (!worker) return
  try {
    for (const note of await worker.getNotifications({ tag: key })) note.close()
  } catch {
    // Nothing to take away.
  }
}

export async function clearAllNotifications(): Promise<void> {
  for (const note of plain.values()) note.close()
  plain.clear()
  if (!worker) return
  try {
    for (const note of await worker.getNotifications()) note.close()
  } catch {
    // Nothing to take away.
  }
}

/** The tab's normal title ("(3) Glofly"); flashTitle swaps it with a call line for a while. */
let titleNow = 'Glofly'
let flashing: ReturnType<typeof setInterval> | null = null

function stopFlashing(): void {
  if (flashing) clearInterval(flashing)
  flashing = null
  document.title = titleNow
  window.removeEventListener('focus', stopFlashing)
}

/**
 * Someone's calling and this tab isn't what you're looking at: its title blinks "📞 Incoming
 * call" (the browser's stand-in for a flashing taskbar button) until you look, for up to 30 s.
 */
export function flashTitle(): void {
  if (document.visibilityState === 'visible' && document.hasFocus()) return
  if (flashing) clearInterval(flashing)
  const until = Date.now() + 30_000
  let on = false
  flashing = setInterval(() => {
    if (Date.now() > until || (document.visibilityState === 'visible' && document.hasFocus())) {
      stopFlashing()
      return
    }
    on = !on
    document.title = on ? '📞 Incoming call · Glofly' : titleNow
  }, 1000)
  window.addEventListener('focus', stopFlashing)
}

/** The unread count: on the tab's title, and on the app icon where the browser has one. */
export function setBadge(count: number): void {
  const n = Number.isInteger(count) && count > 0 ? Math.min(count, 999) : 0
  const base = 'Glofly'
  titleNow = n > 0 ? `(${n > 99 ? '99+' : n}) ${base}` : base
  if (!flashing) document.title = titleNow
  try {
    if (n > 0) void navigator.setAppBadge?.(n).catch(() => undefined)
    else void navigator.clearAppBadge?.().catch(() => undefined)
  } catch {
    // Not supported here.
  }
}

// ---------------------------------------------------------------------------------------
// Asking for permission, and web push

/** Asks "Allow notifications?" (must run straight from a click). Then registers for pushes. */
let asking: Promise<NotificationPermission> | null = null

export async function askPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported'
  let result: NotificationPermission = Notification.permission
  if (result === 'default') {
    // One question at a time (the switch and the settings change can both ask).
    asking ??= Notification.requestPermission()
      .catch(() => Notification.permission)
      .finally(() => {
        asking = null
      })
    result = await asking
  }
  emit({ type: 'notifications:permission', permission: result })
  if (result === 'granted') void syncPush()
  return result
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '==='.slice((base64url.length + 3) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array): boolean => {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

let registered = false
let syncing: Promise<void> | null = null

/**
 * Makes this browser's push registration match the settings: subscribed and registered with the
 * server while signed in with notifications allowed and on; otherwise not.
 */
export function syncPush(): Promise<void> {
  syncing = (syncing ?? Promise.resolve()).then(doSync, doSync)
  return syncing
}

async function doSync(): Promise<void> {
  if (!pushSupported() || !import.meta.env.PROD) return
  const settings = notificationSettings()
  const wanted = isSignedIn() && settings.enabled && Notification.permission === 'granted'
  const reg = worker ?? (await navigator.serviceWorker.getRegistration().catch(() => undefined))
  if (!reg) return
  if (!wanted) {
    if (registered && isSignedIn()) await request('DELETE', '/devices/push').catch(() => undefined)
    registered = false
    return
  }
  const key = await request<{ publicKey: string | null }>('GET', '/devices/web-push-key')
  if (!key.ok || !key.data.publicKey) return // the server can't send web pushes
  const serverKey = keyBytes(key.data.publicKey)
  try {
    let sub = await reg.pushManager.getSubscription()
    if (sub && !sameKey(sub.options.applicationServerKey, serverKey)) {
      await sub.unsubscribe()
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: serverKey
    })
    const result = await request('PUT', '/devices/push', {
      token: JSON.stringify(sub.toJSON()),
      platform: 'web',
      preview: settings.preview
    })
    registered = result.ok
  } catch (err) {
    console.warn('[glofly] web push not set up', err)
  }
}

/** Signing out: this browser stops getting this account's pushes. */
export async function stopPush(): Promise<void> {
  registered = false
  if (!pushSupported()) return
  try {
    const reg = worker ?? (await navigator.serviceWorker.getRegistration())
    const sub = await reg?.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {
    // Already gone.
  }
}

/** Settings → Browser notifications / Show message preview changed. */
export function watchNotificationSettings(): void {
  onNotificationSettings((next: NotificationSettings, prev: NotificationSettings) => {
    // Turning them on asks the browser right here, inside the click (browsers require that).
    if (next.enabled && !prev.enabled && permission() === 'default') {
      void askPermission()
      return
    }
    if (next.enabled !== prev.enabled || next.preview !== prev.preview) void syncPush()
  })
}

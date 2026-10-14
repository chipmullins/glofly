/// <reference lib="webworker" />
// Glofly's service worker: shows web push notifications while every Glofly tab is closed (or in
// the background), and opens the right chat when one is clicked. It caches nothing: the page
// always loads fresh from the site, so a new version is live the moment it's deployed.
//
// What arrives is the same data the phone apps get (apps/server/src/push/notify.ts, calls.ts),
// encrypted end to end by the browser's push service (only this browser can read it).

export {}
declare const self: ServiceWorkerGlobalScope

type PushData = Record<string, string | undefined>

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/** A Glofly tab the person is looking at right now (then the page shows things itself). */
async function visibleClient(): Promise<WindowClient | null> {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return list.find((c) => c.visibilityState === 'visible' && c.focused) ?? null
}

const ICON = '/icons/icon-192.png'
const BADGE = '/icons/badge-96.png'

type Shown = {
  title: string
  options: NotificationOptions & { renotify?: boolean; requireInteraction?: boolean }
}

function notificationFor(data: PushData): Shown | null {
  const common = { icon: ICON, badge: BADGE }
  switch (data.type) {
    case 'message':
      return {
        title: data.title || data.senderName || 'Glofly',
        options: {
          ...common,
          body: data.text || 'New message',
          tag: data.conversationId,
          renotify: true,
          data: { conversationId: data.conversationId ?? null }
        }
      }
    case 'friend_request':
    case 'friend_joined':
      return {
        title: data.title || 'Glofly',
        options: {
          ...common,
          body: data.text || '',
          tag: 'friends',
          data: { conversationId: null }
        }
      }
    case 'friend_online':
      return {
        title: data.title || 'Glofly',
        options: {
          ...common,
          body: data.text || 'is online',
          tag: `online:${data.userId ?? ''}`,
          data: { conversationId: null }
        }
      }
    case 'call_ring': {
      const kind = data.video === '1' ? 'video' : 'voice'
      return {
        title: data.chatTitle
          ? `${data.callerName} · ${data.chatTitle}`
          : data.callerName || 'Glofly',
        options: {
          ...common,
          body:
            data.group === '1'
              ? `Incoming group ${kind} call · Click to answer`
              : `Incoming ${kind} call · Click to answer`,
          tag: data.callId,
          renotify: true,
          requireInteraction: true,
          silent: data.dnd === '1',
          data: { conversationId: data.conversationId ?? null }
        }
      }
    }
    case 'call_missed':
      return {
        title: data.title || 'Missed call',
        options: {
          ...common,
          body: data.text || 'Missed call',
          tag: data.callId,
          silent: data.dnd === '1',
          data: { conversationId: data.conversationId ?? null }
        }
      }
    default:
      return null
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let data: PushData = {}
      try {
        data = (event.data?.json() ?? {}) as PushData
      } catch {
        return
      }
      // The call stopped ringing (answered somewhere, declined, cancelled): take its notification away.
      if (data.type === 'call_stop' && data.callId) {
        const ringing = await self.registration.getNotifications({ tag: data.callId })
        for (const n of ringing) n.close()
        return
      }
      // Glofly is open and in front: the page shows it (and plays the sound) itself.
      if (await visibleClient()) return
      const shown = notificationFor(data)
      if (shown) await self.registration.showNotification(shown.title, shown.options)
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = (event.notification.data as { conversationId?: unknown } | null)?.conversationId
  const conversationId = typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const tab = list.find((c) => new URL(c.url).origin === self.location.origin)
      if (tab) {
        await tab.focus()
        tab.postMessage({ type: 'glofly:notification-click', conversationId })
        return
      }
      // No Glofly tab open: open one at that chat (the page reads ?chat= once it's signed in).
      await self.clients.openWindow(conversationId ? `/?chat=${conversationId}` : '/')
    })()
  )
})

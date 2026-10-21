import { Linking } from 'react-native'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useSession, transport } from '@/state/session'
import { VARIANT } from './config'

// Push alerts (APNs, straight from the Glofly server to topic com.glofly.control). After sign-in the
// phone asks for permission and registers its raw APNs device token (PUT /admin/devices/me/push).
// Alerts never include message text. Tapping one opens the page it's about (its `open` field),
// after sign-in if needed.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/** The `open` page → this app's route. */
export function routeFor(data: Record<string, string>): string {
  switch (data.open) {
    case 'reports':
      return data.reportId ? `/reports?open=${encodeURIComponent(data.reportId)}` : '/reports'
    case 'accounts':
      return data.userId ? `/account/${encodeURIComponent(data.userId)}` : '/accounts'
    case 'constellations':
      return data.constellationId ? `/constellation/${encodeURIComponent(data.constellationId)}` : '/constellations'
    case 'inbox':
      return data.userId ? `/inbox/${encodeURIComponent(data.userId)}` : '/inbox'
    case 'server':
      return '/server'
    default:
      return '/home'
  }
}

/** The alert's own fields (APNs puts them next to `aps`; expo-notifications hands them as data). */
function dataOf(response: Notifications.NotificationResponse): Record<string, string> {
  const content = response.notification.request.content
  const trigger = response.notification.request.trigger as { payload?: Record<string, unknown> } | null
  const raw = { ...(trigger?.payload ?? {}), ...((content.data as Record<string, unknown> | null) ?? {}) }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v
  return out
}

export function openFromAlert(data: Record<string, string>) {
  if (useSession.getState().phase === 'app') router.navigate(routeFor(data) as never)
  else useSession.getState().setPendingOpen(data)
}

let started = false
export function startAlerts() {
  if (started) return
  started = true
  try {
    Notifications.addNotificationResponseReceivedListener((r) => openFromAlert(dataOf(r)))
    // The app was opened by tapping an alert.
    void Notifications.getLastNotificationResponseAsync()
      .then((r) => {
        if (r) openFromAlert(dataOf(r))
      })
      .catch(() => {})
  } catch {
    // Not available (the browser preview).
  }
}

export type PushState = 'on' | 'denied' | 'undetermined' | 'failed'

/** After sign-in: permission, then the APNs token to the server. */
export async function registerForAlerts(ask = true): Promise<PushState> {
  try {
    let perm = await Notifications.getPermissionsAsync()
    if (perm.status !== 'granted' && perm.canAskAgain && ask) {
      perm = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false, allowCriticalAlerts: false },
      })
    }
    if (perm.status !== 'granted') return perm.status === 'denied' ? 'denied' : 'undetermined'
    const device = await Notifications.getDevicePushTokenAsync()
    const hex = String(device.data).toLowerCase()
    if (!/^[0-9a-f]{32,200}$/.test(hex)) return 'failed'
    const token = VARIANT === 'development' ? `sandbox:${hex}` : hex
    const r = await transport.call('PUT', '/admin/devices/me/push', { token })
    return r.ok ? 'on' : 'failed'
  } catch {
    return 'failed'
  }
}

export async function pushPermission(): Promise<PushState> {
  try {
    const p = await Notifications.getPermissionsAsync()
    return p.status === 'granted' ? 'on' : p.status === 'denied' ? 'denied' : 'undetermined'
  } catch {
    return 'failed'
  }
}

export const openIosSettings = () => void Linking.openSettings().catch(() => {})

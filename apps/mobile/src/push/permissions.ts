import { Linking, PermissionsAndroid, Platform } from 'react-native'
import * as Native from 'glofly-native'

// Notification permission (Android 13+ and iPhone ask once) and Android's lock-screen calls.

export type PermissionState = 'granted' | 'denied' | 'unknown'

export async function notificationStatus(): Promise<PermissionState> {
  if (Platform.OS === 'ios') return (await Native.notificationStatus()) as PermissionState
  if (Platform.OS !== 'android') return 'unknown'
  if (Platform.Version < 33) return Native.notificationsEnabled() ? 'granted' : 'denied'
  const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
  return ok && Native.notificationsEnabled() ? 'granted' : 'denied'
}

/** Asks once (Android 13+, iPhone); older Android versions allow notifications by default. */
export async function requestNotifications(): Promise<boolean> {
  if (Platform.OS === 'ios') return Native.requestNotifications()
  if (Platform.OS !== 'android') return false
  if (Platform.Version < 33) return Native.notificationsEnabled()
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)
  return r === PermissionsAndroid.RESULTS.GRANTED
}

export async function openNotificationSettings(): Promise<void> {
  if (Native.openNotificationSettings()) return
  await Linking.openSettings()
}

/** Android 14+ lets people turn off full-screen notifications (lock-screen ringing) per app. */
export async function fullScreenCallsAllowed(): Promise<boolean | null> {
  if (Platform.OS !== 'android') return null
  return Native.canUseFullScreenIntent()
}

export async function openFullScreenCallSettings(): Promise<void> {
  if (Native.openFullScreenIntentSettings()) return
  await Linking.openSettings()
}

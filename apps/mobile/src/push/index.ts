import { Linking, Platform } from 'react-native'
import * as Native from 'glofly-native'
import { isMuted, mentionsMe, type Message } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onLive, isAppActive } from '@/api/realtime'
import { APP_VERSION, PLATFORM, SERVER_URL } from '@/lib/config'
import { prefs } from '@/lib/storage'
import { onSignOut, useSession } from '@/state/session'
import { usePhonePrefs, onPhonePrefsChange } from '@/state/prefs'
import { useStore } from '@/state/store'
import { requestNotifications } from './permissions'
import { playSound, vibrate } from './sounds'

// Push notifications on this phone: the Firebase token goes to the server (tied to this
// sign-in), Glofly's native code shows the notifications, and while the app is open it plays the
// message sound itself instead.

let registeredToken: string | null = null

async function register(): Promise<void> {
  const { status, token: session, user } = useSession.getState()
  if (status !== 'signedIn' || !session || !user) return
  const p = usePhonePrefs.getState()
  Native.configurePush({
    serverUrl: SERVER_URL,
    token: session,
    version: APP_VERSION,
    platform: PLATFORM,
    meId: user.id,
    meName: user.displayName,
    meAvatar: user.avatarVersion,
    vibrate: p.vibrate,
  })
  if (!p.notifications) {
    if (registeredToken) await api.unregisterPush()
    registeredToken = null
    return
  }
  // Ask once after signing in (Android 13+ shows its own prompt).
  const asked = await prefs.get<boolean>('askedNotifications', false)
  if (!asked) {
    await prefs.set('askedNotifications', true)
    await requestNotifications()
  }
  const token = await Native.getPushToken()
  if (!token) return
  // iPhone: Apple's VoIP token too, so calls ring on the lock screen (CallKit).
  const voip = Platform.OS === 'ios' ? Native.voipToken() : null
  const r = await api.registerPush(token, p.preview, voip ?? undefined)
  if (r.ok) registeredToken = token
}

let started = false
export function startPush(): void {
  if (started || Platform.OS === 'web') return
  started = true
  void register()
  // iPhone: a notification tapped while Glofly was starting opens its screen now.
  const link = Native.takeLaunchLink()
  if (link) setTimeout(() => void Linking.openURL(link), 300)
  Native.onNativeEvent('pushToken', () => void register())
  Native.onNativeEvent('voipToken', () => void register())
  onPhonePrefsChange(() => void register())
  useSession.subscribe((s, prev) => {
    if (s.status === 'signedIn' && (prev.status !== 'signedIn' || s.token !== prev.token || s.user?.avatarVersion !== prev.user?.avatarVersion)) void register()
  })
  onSignOut(() => {
    registeredToken = null
    Native.clearPush()
  })
  // Read here or on another device: its notification goes away.
  onLive((event, payload) => {
    if (event === 'read:me' && typeof payload === 'string') Native.cancelChatNotification(payload)
  })
}

/** Called when a chat opens on screen. */
export function chatOpened(conversationId: string) {
  Native.cancelChatNotification(conversationId)
}

// While Glofly is open the server doesn't send pushes, so the app makes the sound itself
// (not for the chat on screen, muted chats unless you're @mentioned, or in Do not disturb).
let lastSound = 0
onLive((event, payload) => {
  if (event !== 'message:new') return
  const { message, counts } = payload as { message: Message; counts: boolean }
  if (!counts || !isAppActive()) return
  if (useStore.getState().myStatus?.status === 'dnd') return
  const chat = useStore.getState().conversations[message.conversationId]
  const me = useSession.getState().user?.id ?? ''
  if (chat && isMuted(chat) && !mentionsMe(message, me)) return
  const p = usePhonePrefs.getState()
  const now = Date.now()
  if (now - lastSound < 1500) return // a burst makes one sound
  lastSound = now
  if (p.sounds) playSound('message')
  if (p.vibrate) vibrate()
})

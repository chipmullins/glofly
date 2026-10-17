import { Linking, Platform } from 'react-native'
import * as Native from 'glofly-native'
import { isMuted, mentionsMe, phoneMessageSound, phoneRingtone, type Message } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onLive, isAppActive } from '@/api/realtime'
import { APP_VERSION, PLATFORM, SERVER_URL } from '@/lib/config'
import { prefs } from '@/lib/storage'
import { onSignOut, useSession } from '@/state/session'
import { usePhonePrefs, onPhonePrefsChange } from '@/state/prefs'
import { useStore } from '@/state/store'
import { useCx } from '@/state/constellations'
import { notificationStatus, requestNotifications } from './permissions'
import { playSound, vibrate } from './sounds'

// Push notifications on this phone: the Firebase token goes to the server (tied to this
// sign-in), Glofly's native code shows the notifications, and while the app is open it plays the
// message sound itself instead.

let registeredToken: string | null = null

/** The picked sounds, for the native side (notification channels, CallKit, in-app tones on iPhone). */
function applySounds(): { messageSound: string; ringtone: string } {
  const p = usePhonePrefs.getState()
  const message = phoneMessageSound(p.messageSound)
  const ring = phoneRingtone(p.ringtone)
  Native.setSounds(message.native, ring.native)
  return { messageSound: message.id, ringtone: ring.id }
}

async function register(): Promise<void> {
  const sounds = applySounds()
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
  // Ask once after signing in (Android 13+ shows its own prompt). iPhone: also whenever iOS says it
  // was never asked. "Asked" is saved in the Keychain, which outlives the app: after a reinstall
  // (or a TestFlight build replacing an ad hoc one) iOS forgets the answer but the flag stayed, so
  // Glofly never asked again, got no push address, and notifications (and lock-screen calls)
  // silently stopped. iOS only ever shows its prompt once per install, so asking is harmless.
  const asked = await prefs.get<boolean>('askedNotifications', false)
  const neverAsked = Platform.OS === 'ios' && (await notificationStatus()) === 'unknown'
  if (!asked || neverAsked) {
    await prefs.set('askedNotifications', true)
    await requestNotifications()
  }
  const token = await Native.getPushToken()
  if (!token) return
  // iPhone: Apple's VoIP token too, so calls ring on the lock screen (CallKit).
  const voip = Platform.OS === 'ios' ? Native.voipToken() : null
  // The picked sounds too: iPhone notifications name the sound file (Android's are made on the phone).
  const r = await api.registerPush(token, p.preview, voip ?? undefined, sounds)
  if (r.ok) registeredToken = token
}

/** Registers this phone again now (after notifications were just allowed). */
export function refreshPush(): void {
  void register()
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

// 0.7.0: nebula messages while Glofly is open. Their sound follows your setting for that nebula
// (or the constellation's default): all messages, only @mentions, or nothing; a mute still lets
// @mentions through. Never for the nebula on screen, your own messages, or in Do not disturb.
onLive((event, payload) => {
  if (event !== 'nebula:message') return
  const message = payload as Message
  if (!isAppActive()) return
  const me = useSession.getState().user?.id ?? ''
  if (message.senderId === me || message.event) return
  if (useStore.getState().myStatus?.status === 'dnd') return
  const cx = useCx.getState()
  if (cx.viewing === message.conversationId) return
  const place = cx.chats[message.conversationId]
  const detail = place ? cx.details[place.constellationId] : undefined
  const nebula = detail?.nebulas.find((n) => n.id === place?.nebulaId)
  const mention = mentionsMe(message, me)
  const level = nebula?.notify ?? detail?.me.notify ?? 'mentions'
  const quiet = !!nebula?.mutedUntil && new Date(nebula.mutedUntil).getTime() > Date.now()
  if (!mention && (level !== 'all' || quiet)) return
  if (level === 'none' && !mention) return
  const p = usePhonePrefs.getState()
  const now = Date.now()
  if (now - lastSound < 1500) return
  lastSound = now
  if (p.sounds) playSound('message')
  if (p.vibrate) vibrate()
})

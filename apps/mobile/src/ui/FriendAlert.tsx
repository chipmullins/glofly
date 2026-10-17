import { useEffect } from 'react'
import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import type { PublicUser } from '@glofly/shared'
import { onLive, isAppActive } from '@/api/realtime'
import { playSound, vibrate } from '@/push/sounds'
import { usePhonePrefs } from '@/state/prefs'
import { useStore } from '@/state/store'
import { Avatar } from './Avatar'
import { Icon } from './icons'
import * as api from '@/api/glofly'
import { startCallIn } from '@/calls/controller'
import { Text } from './kit'
import { useTheme } from './theme'

// The banner at the top of the app (0.3.0) for "Maya is online" (the bell on a friend's profile)
// and "Maya joined Glofly from your invite". Phones that aren't open get a push notification
// instead (the server decides). Tapping it opens their profile.

type Alert = { key: number; user: PublicUser; text: string; hang?: boolean }
const useAlert = create<{ alert: Alert | null }>(() => ({ alert: null }))

const SHOW_MS = 4500

function show(user: PublicUser, text: string, hang = false) {
  if (!isAppActive()) return
  // The server already skips Do not disturb for "is online"; keep the app quiet too.
  const dnd = useStore.getState().myStatus?.status === 'dnd'
  const p = usePhonePrefs.getState()
  if (!dnd && p.sounds) playSound('message')
  if (!dnd && p.vibrate) vibrate()
  useAlert.setState({ alert: { key: Date.now(), user, text, hang } })
}

onLive((event, payload) => {
  if (event === 'friend:online') show(payload as PublicUser, 'is online')
  else if (event === 'friend:joined') show(payload as PublicUser, "joined Glofly from your invite. You're friends now!")
  else if (event === 'hang:ping') {
    // 0.5.0 "Want to hang?": a friend is free for a call, with a Call button.
    const { userId } = payload as { userId: string }
    const user = useStore.getState().friends.friends.find((f) => f.id === userId)
    if (user) show(user, 'is free to hang for the next hour', true)
  }
})

async function callFriend(userId: string) {
  const r = await api.openDm(userId)
  if (r.ok) void startCallIn(r.data.id, false)
}

export function FriendAlert() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const alert = useAlert((s) => s.alert)

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => {
      if (useAlert.getState().alert?.key === alert.key) useAlert.setState({ alert: null })
    }, alert.hang ? 15_000 : SHOW_MS)
    return () => clearTimeout(t)
  }, [alert])

  if (!alert) return null
  const open = () => {
    useAlert.setState({ alert: null })
    router.push(`/profile/${alert.user.id}`)
  }
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 8, zIndex: 70 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${alert.user.displayName} ${alert.text}. Open their profile.`}
        onPress={open}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          padding: 12,
          borderRadius: 20,
          backgroundColor: c.sheet,
          borderWidth: 1,
          borderColor: c.line,
          boxShadow: '0 10px 28px rgba(0,0,0,0.22)',
        }}
      >
        <Avatar user={alert.user} size={40} status="online" ring={alert.hang ? c.online : c.sheet} />
        <Text size={15} style={{ flex: 1, lineHeight: 21 }} numberOfLines={2}>
          <Text size={15} weight="bold" style={{ lineHeight: 21 }}>
            {alert.user.displayName}
          </Text>{' '}
          {alert.text}
        </Text>
        {alert.hang ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Call ${alert.user.displayName}`}
            onPress={() => {
              useAlert.setState({ alert: null })
              void callFriend(alert.user.id)
            }}
            style={{ height: 38, paddingHorizontal: 14, borderRadius: 19, backgroundColor: c.online, flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <Icon name="phone" size={16} color="#FFFFFF" />
            <Text size={14} weight="bold" style={{ color: '#FFFFFF', lineHeight: 19 }}>
              Call
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </View>
  )
}

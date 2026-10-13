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
import { Text } from './kit'
import { useTheme } from './theme'

// The banner at the top of the app (0.3.0) for "Maya is online" (the bell on a friend's profile)
// and "Maya joined Glofly from your invite". Phones that aren't open get a push notification
// instead (the server decides). Tapping it opens their profile.

type Alert = { key: number; user: PublicUser; text: string }
const useAlert = create<{ alert: Alert | null }>(() => ({ alert: null }))

const SHOW_MS = 4500

function show(user: PublicUser, text: string) {
  if (!isAppActive()) return
  // The server already skips Do not disturb for "is online"; keep the app quiet too.
  const dnd = useStore.getState().myStatus?.status === 'dnd'
  const p = usePhonePrefs.getState()
  if (!dnd && p.sounds) playSound('message')
  if (!dnd && p.vibrate) vibrate()
  useAlert.setState({ alert: { key: Date.now(), user, text } })
}

onLive((event, payload) => {
  if (event === 'friend:online') show(payload as PublicUser, 'is online')
  else if (event === 'friend:joined') show(payload as PublicUser, "joined Glofly from your invite. You're friends now!")
})

export function FriendAlert() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const alert = useAlert((s) => s.alert)

  useEffect(() => {
    if (!alert) return
    const t = setTimeout(() => {
      if (useAlert.getState().alert?.key === alert.key) useAlert.setState({ alert: null })
    }, SHOW_MS)
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
        <Avatar user={alert.user} size={40} status="online" ring={c.sheet} />
        <Text size={15} style={{ flex: 1 }} numberOfLines={2}>
          <Text size={15} weight="bold">
            {alert.user.displayName}
          </Text>{' '}
          {alert.text}
        </Text>
      </Pressable>
    </View>
  )
}

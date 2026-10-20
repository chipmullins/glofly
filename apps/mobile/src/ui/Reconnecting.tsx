import { useEffect, useRef, useState } from 'react'
import { Animated, View } from 'react-native'
import { useStore } from '@/state/store'
import { Text } from './kit'
import { useTheme } from './theme'
import { useReduceMotionOn } from './RowLife'

// 0.7.5: a calm "Reconnecting…" strip inside a chat while the live connection is down (only after
// a couple of seconds, so a blip stays quiet). Messages you send meanwhile wait and go again by
// themselves once Glofly is back.

export function ReconnectingStrip({ night }: { night?: boolean }) {
  const { c } = useTheme()
  const connected = useStore((s) => s.connected)
  const [show, setShow] = useState(false)
  const reduce = useReduceMotionOn()
  const pulse = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (connected) return setShow(false)
    const t = setTimeout(() => setShow(true), 2500)
    return () => clearTimeout(t)
  }, [connected])
  useEffect(() => {
    if (!show || reduce) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [show, reduce, pulse])
  if (!show) return null
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityLabel="Reconnecting to Glofly"
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 6, backgroundColor: night ? '#241d1a' : c.surface, borderBottomWidth: 1, borderBottomColor: night ? 'rgba(255,255,255,0.07)' : c.line }}
    >
      <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: night ? '#ffb347' : c.accent, opacity: pulse }} />
      <Text size={13} weight="bold" style={{ color: night ? '#c9b8ab' : c.muted }}>
        Reconnecting…
      </Text>
    </View>
  )
}

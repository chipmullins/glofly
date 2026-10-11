import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Animated, View } from 'react-native'
import { typingText, type PublicUser } from '@glofly/shared'
import { Avatar } from '@/ui/Avatar'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { firstName } from '@/lib/format'

// "Typing…": three firefly dots glowing in turn, in a bubble like the design.

function Dot({ delay, color }: { delay: number; color: string }) {
  const v = useRef(new Animated.Value(0.35)).current
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return v.setValue(1)
      loop = Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 380, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.35, duration: 380, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ]),
      )
      loop.start()
    })
    return () => loop?.stop()
  }, [v, delay])
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, opacity: v, boxShadow: '0 0 6px 1px rgba(255,165,74,0.6)' }} />
}

export function TypingBubble({ userIds, people, isGroup }: { userIds: string[]; people: Record<string, PublicUser>; isGroup: boolean }) {
  const { c } = useTheme()
  const first = people[userIds[0]]
  const names = userIds.map((id) => firstName(people[id]?.displayName ?? 'Someone'))
  return (
    <View style={{ paddingHorizontal: 12, marginTop: 6, gap: 2 }} accessibilityLiveRegion="polite" accessibilityLabel={typingText(names)}>
      {isGroup ? (
        <Text size={12} tone="muted" style={{ marginLeft: 48 }}>
          {typingText(names)}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
        {first ? <Avatar user={first} size={28} /> : <View style={{ width: 28 }} />}
        <View style={{ height: 38, paddingHorizontal: 14, borderRadius: 18, borderBottomLeftRadius: 6, backgroundColor: c.them, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Dot delay={0} color="#FFA54A" />
          <Dot delay={200} color="#E08A45" />
          <Dot delay={400} color="#B9714A" />
        </View>
      </View>
    </View>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Platform, View, type DimensionValue } from 'react-native'
import { useReduceMotion } from '@/constellations/motion'
import { useTheme } from './theme'

// Loading placeholders: soft grey shapes where rows and bubbles are about to be, gently
// shimmering (still with Reduce Motion). They only show after 150 ms, so a quick load never
// flashes them.

export const SKELETON_DELAY_MS = 150

/** True once `ms` has passed since the placeholder was first shown. */
function useShowAfter(ms: number): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms)
    return () => clearTimeout(t)
  }, [ms])
  return show
}

/** A shared 0→1→0 pulse for every shape in one placeholder (one animation, not one per bar). */
function usePulse(on: boolean): Animated.Value {
  const value = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!on) {
      value.setValue(0.5)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(value, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [on, value])
  return value
}

type Kind = 'chats' | 'friends' | 'messages'

export function Skeleton({ kind, night, rows = kind === 'messages' ? 7 : 8 }: { kind: Kind; night?: boolean; rows?: number }) {
  const show = useShowAfter(SKELETON_DELAY_MS)
  const still = useReduceMotion((s) => s.on)
  const { c } = useTheme()
  const pulse = usePulse(show && !still)
  if (!show) return null
  const shade = night ? '#2a1c17' : c.surface2
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })
  const bar = (width: DimensionValue, height: number, radius = height / 2) => (
    <View style={{ width, height, borderRadius: radius, backgroundColor: shade }} />
  )
  return (
    <Animated.View
      accessible
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={{ opacity, paddingVertical: 8 }}
    >
      {Array.from({ length: rows }, (_, i) =>
        kind === 'messages' ? (
          // Bubbles of different lengths, theirs on the left and yours on the right.
          <View key={i} style={{ paddingHorizontal: 14, paddingVertical: 5, alignItems: i % 3 === 1 ? 'flex-end' : 'flex-start' }}>
            {bar(['62%', '48%', '70%', '38%', '56%', '44%', '66%'][i % 7] as DimensionValue, i % 4 === 2 ? 58 : 38, 18)}
          </View>
        ) : (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: kind === 'chats' ? 72 : 64 }}>
            {bar(kind === 'chats' ? 48 : 44, kind === 'chats' ? 48 : 44)}
            <View style={{ flex: 1, gap: 8 }}>
              {bar(['46%', '58%', '38%', '52%'][i % 4] as DimensionValue, 12)}
              {bar(['72%', '64%', '80%', '56%'][i % 4] as DimensionValue, 10)}
            </View>
            {kind === 'chats' ? bar(32, 10) : null}
          </View>
        ),
      )}
    </Animated.View>
  )
}

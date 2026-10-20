import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, View } from 'react-native'
import { useTheme } from './theme'

// 0.7.5 "Life in the chat list" (ChatListLife.dc.html): the typing dots in a chat's row, and the
// soft glow a chat gets when a new message bumps it to the top. With Reduce Motion: no dots (the
// row just says "typing…") and no glow.

/** Reduce Motion, kept current. */
export function useReduceMotionOn(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let alive = true
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setOn(v))
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setOn)
    return () => {
      alive = false
      sub.remove()
    }
  }, [])
  return on
}

function Dot({ delay, color }: { delay: number; color: string }) {
  const v = useRef(new Animated.Value(0.45)).current
  const y = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(v, { toValue: 1, duration: 330, useNativeDriver: true }),
          Animated.timing(y, { toValue: -3, duration: 330, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(v, { toValue: 0.45, duration: 330, useNativeDriver: true }),
          Animated.timing(y, { toValue: 0, duration: 330, useNativeDriver: true }),
        ]),
        Animated.delay(440 - delay),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [v, y, delay])
  return <Animated.View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: color, opacity: v, transform: [{ translateY: y }] }} />
}

/** Three small bouncing dots before "typing…" (nothing with Reduce Motion). */
export function RowTypingDots() {
  const { c } = useTheme()
  const reduce = useReduceMotionOn()
  if (reduce) return null
  return (
    <View style={{ flexDirection: 'row', gap: 3, alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Dot delay={0} color={c.accent} />
      <Dot delay={150} color={c.accent} />
      <Dot delay={300} color={c.accent} />
    </View>
  )
}

/** A soft accent glow over a row, once each time `glowKey` changes (0 = none). */
export function RowGlow({ glowKey }: { glowKey: number }) {
  const { c } = useTheme()
  const reduce = useReduceMotionOn()
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!glowKey || reduce) return
    v.setValue(0)
    const a = Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 1200, useNativeDriver: true }),
    ])
    a.start()
    return () => a.stop()
  }, [glowKey, reduce, v])
  if (!glowKey || reduce) return null
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        top: 2,
        bottom: 2,
        borderRadius: 16,
        backgroundColor: c.accentSoft,
        borderWidth: 1.5,
        borderColor: c.accent,
        opacity: v,
        boxShadow: `0 0 18px ${c.accent}55`,
      }}
    />
  )
}

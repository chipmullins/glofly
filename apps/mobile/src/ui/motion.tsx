import { useEffect, useState, type ReactNode } from 'react'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type EntryAnimationsValues,
  type LayoutAnimation,
} from 'react-native-reanimated'

// 0.7.5 motion (Motion.dc.html), the same timings as the desktop app: opening is 240 ms with a
// tiny overshoot, closing 160 ms with no bounce. Sheets and dialogs rise 40 px as they fade in,
// and a message you send rises into place (24 px, from 96 % size, 260 ms). Reduce Motion: fades
// only (Reanimated skips entering animations then; the Modal's own fade remains).

export const OPEN_EASE = Easing.bezier(0.2, 0.9, 0.3, 1.15)
export const CLOSE_EASE = Easing.bezier(0.4, 0, 1, 1)
export const OPEN_MS = 240
export const CLOSE_MS = 160

/** Entering animation for a dialog card or a bottom sheet's panel (inside a fading Modal). */
export function riseIn(_values: EntryAnimationsValues): LayoutAnimation {
  'worklet'
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 40 }] },
    animations: {
      opacity: withTiming(1, { duration: 180 }),
      transform: [{ translateY: withTiming(0, { duration: OPEN_MS, easing: OPEN_EASE }) }],
    },
  }
}

// A message you send is drawn twice: first as "sending", then as the server's copy (a new row).
// The second one carries on from where the first one's rise had got to, so the swap never jumps.
const RISE_MS = 260
const rising = new Map<string, number>()
const riseKey = (conversationId: string, body: string) => `${conversationId}\u0000${body}`

/** Wraps one chat row; `sending` rows rise in, and their saved copy finishes the same rise. */
export function Rise({ conversationId, body, sending, mine, children }: { conversationId: string; body: string; sending: boolean; mine: boolean; children: ReactNode }) {
  const reduce = useReducedMotion()
  // Worked out once, on the row's first draw: where its rise starts (1 = no rise).
  const [from] = useState(() => {
    if (!mine || reduce) return 1
    const key = riseKey(conversationId, body)
    const now = Date.now()
    if (sending) {
      if (!rising.has(key)) rising.set(key, now)
      return 0
    }
    const startedAt = rising.get(key)
    if (startedAt === undefined) return 1
    const elapsed = now - startedAt
    if (elapsed >= RISE_MS) {
      rising.delete(key)
      return 1
    }
    return elapsed / RISE_MS
  })
  const progress = useSharedValue(from)
  useEffect(() => {
    if (from >= 1) return
    progress.value = withTiming(1, { duration: Math.round(RISE_MS * (1 - from)), easing: OPEN_EASE })
    // Forget it once both copies have had their chance.
    const key = riseKey(conversationId, body)
    const t = setTimeout(() => rising.delete(key), RISE_MS + 200)
    return () => clearTimeout(t)
    // Only on the first draw of the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, 0.2 + progress.value * 1.2),
    transform: [{ translateY: (1 - progress.value) * 24 }, { scale: 0.96 + progress.value * 0.04 }],
  }))
  if (from >= 1) return <>{children}</>
  return <Animated.View style={style}>{children}</Animated.View>
}

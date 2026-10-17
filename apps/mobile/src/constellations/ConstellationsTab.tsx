import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { useCx } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { flyIn } from './transition'
import { openHomeDock } from './HomeDock'
import { useReduceMotion } from './motion'
import { GalaxyIcon, N } from './ui'

// The 5th tab (board 1): the galaxy pill with a glowing dot. It's the "portal": tap to fly into
// Constellations; swipe up on it (or hold it) for the nebula dock without leaving Glofly home.
// Light theme: a dark pill with an amber galaxy; dark theme: an orange pill (like the desktop).

export function ConstellationsTab() {
  const { c, dark } = useTheme()
  const ref = useRef<View>(null)
  const mentions = useCx((s) => s.mentionsUnread)
  const reduce = useReduceMotion((s) => s.on)
  const glow = useSharedValue(0)
  useEffect(() => {
    if (reduce) return
    glow.value = withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }), -1, true)
    return () => cancelAnimation(glow)
  }, [reduce, glow])
  const dot = useAnimatedStyle(() => ({ boxShadow: `0 0 ${6 + 8 * glow.value}px ${1 + 3 * glow.value}px rgba(255,179,71,${0.45 + 0.35 * glow.value})` }))

  const go = () => {
    ref.current?.measureInWindow((x, y, w, h) => flyIn(w ? { x: x + w / 2, y: y + h / 2 } : null))
  }
  const gesture = Gesture.Race(
    Gesture.Fling()
      .direction(Directions.UP)
      .onEnd(() => runOnJS(openHomeDock)()),
    Gesture.LongPress()
      .minDuration(380)
      .onStart(() => runOnJS(openHomeDock)()),
    Gesture.Tap().onEnd(() => runOnJS(go)()),
  )
  const pill = dark ? { bg: N.orange, icon: N.orangeInk } : { bg: '#24170F', icon: N.amber }
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={mentions ? `Constellations, ${mentions} mentions of you` : 'Constellations'}
        accessibilityHint="Swipe up or hold for your constellations and pinned nebulas"
        accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Nebula dock' }]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? openHomeDock() : go())}
        style={{ flex: 1.25, alignItems: 'center', gap: 4 }}
      >
        <View ref={ref} collapsable={false} style={{ width: 50, height: 32, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 50, height: 28, borderRadius: 14, backgroundColor: pill.bg, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 14px rgba(255,165,74,${mentions ? 0.45 : 0.35})` }}>
            <GalaxyIcon size={20} color={pill.icon} />
            {mentions > 0 ? (
              <View style={{ position: 'absolute', right: -6, top: -6, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: N.violet, borderWidth: 2, borderColor: c.navBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text size={10} weight="bold" style={{ color: N.violetInk }}>
                  @{mentions > 9 ? '9+' : mentions}
                </Text>
              </View>
            ) : (
              <Animated.View style={[{ position: 'absolute', right: 2, top: 1, width: 7, height: 7, borderRadius: 4, backgroundColor: N.amber }, dot]} />
            )}
          </View>
        </View>
        <Text size={11.5} weight="bold" numberOfLines={1} style={{ color: c.ink, letterSpacing: -0.1 }}>
          Constellations
        </Text>
      </View>
    </GestureDetector>
  )
}

import { useMemo, type ReactNode } from 'react'
import { View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { Text } from '@/ui/kit'

// 0.7.5 chat rhythm: swipe a message left to see exactly when it was sent (the time slides in
// on the right, and the message springs back when you let go). Vertical scrolling still wins.

const REVEAL = 64

export function SwipeTime({ time, children }: { time: string; children: ReactNode }) {
  const x = useSharedValue(0)
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(-14)
        .failOffsetX(14)
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          x.value = Math.max(-REVEAL, Math.min(0, e.translationX * 0.6))
        })
        .onFinalize(() => {
          x.value = withSpring(0, { damping: 18, stiffness: 220 })
        }),
    [x],
  )
  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  const showing = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-REVEAL, -24, 0], [1, 0.3, 0]),
    transform: [{ translateX: interpolate(x.value, [-REVEAL, 0], [0, 16]) }],
  }))
  return (
    <GestureDetector gesture={pan}>
      <View>
        <Animated.View style={moving}>{children}</Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', right: 10, top: 0, bottom: 0, justifyContent: 'center' }, showing]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text size={12} tone="muted">
            {time}
          </Text>
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

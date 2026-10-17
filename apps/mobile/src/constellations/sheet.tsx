import { useEffect, useState, type ReactNode } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SHEET_MAX_WIDTH } from '@/ui/dialogs'
import { ThemeOverride, type ThemeMode } from '@/ui/theme'
import { N } from './ui'
import { useReduceMotion } from './motion'

// Bottom sheets on the night side (the canvas's: #1c1210, a #4a372b top edge, 28 pt corners, a
// 40 × 5 handle). Drag the handle down (or tap outside) to close.

/** The handle at the top of a sheet. */
export function Handle({ color = N.edge2, width = 40 }: { color?: string; width?: number }) {
  return <View style={{ alignSelf: 'center', width, height: 5, borderRadius: 3, backgroundColor: color }} />
}

/**
 * A sheet over everything (a Modal, so it also covers the tab bar). `top`: how far from the top
 * its full height reaches (the canvas varies it by sheet); `fit`: as tall as its content instead.
 */
export function NightModal({
  visible = true,
  onClose,
  children,
  top = 120,
  fit,
  bg = N.card,
  edge = N.edge,
  mode = 'night',
  backdrop = 'rgba(5,3,2,0.55)',
  footer,
  padded = true,
  accessibilityLabel,
}: {
  visible?: boolean
  onClose: () => void
  children: ReactNode
  top?: number
  fit?: boolean
  bg?: string
  edge?: string
  mode?: ThemeMode | null
  backdrop?: string
  /** Pinned to the bottom of the sheet (the main button) */
  footer?: ReactNode
  padded?: boolean
  accessibilityLabel?: string
}) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const drag = useSharedValue(0)
  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY)
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 800) runOnJS(onClose)()
      drag.value = withTiming(0, { duration: 160 })
    })
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }))
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeOverride mode={mode}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: backdrop }]} />
            <Animated.View
              accessibilityViewIsModal
              accessibilityLabel={accessibilityLabel}
              style={[
                {
                  backgroundColor: bg,
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  borderTopWidth: 1,
                  borderColor: edge,
                  boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
                  width: '100%',
                  maxWidth: SHEET_MAX_WIDTH,
                  alignSelf: 'center',
                  maxHeight: height - Math.max(top, insets.top + 12),
                },
                fit ? null : { height: height - Math.max(top, insets.top + 12) },
                moved,
              ]}
            >
              <GestureDetector gesture={pan}>
                <View style={{ paddingTop: 8, paddingBottom: 8 }}>
                  <Handle />
                </View>
              </GestureDetector>
              <View style={{ flexShrink: 1, flexGrow: fit ? 0 : 1, paddingHorizontal: padded ? 18 : 0 }}>{children}</View>
              {footer ? <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: N.line, backgroundColor: bg }}>{footer}</View> : <View style={{ height: insets.bottom + 8 }} />}
            </Animated.View>
          </KeyboardAvoidingView>
        </ThemeOverride>
      </GestureHandlerRootView>
    </Modal>
  )
}

/**
 * A sheet inside the screen (no Modal), sliding up from `bottom` (above a tab bar), with a backdrop.
 * Drag down to close; `onPullUp` = "keep pulling" (the dock opens All chats).
 */
export function InlineSheet({
  open,
  onClose,
  onPullUp,
  children,
  bottom = 0,
  style,
  backdrop = 'rgba(0,0,0,0.35)',
  float,
}: {
  open: boolean
  onClose: () => void
  onPullUp?: () => void
  children: ReactNode
  bottom?: number
  style?: StyleProp<ViewStyle>
  backdrop?: string | null
  /** A floating card (8 pt from the sides) instead of edge to edge */
  float?: boolean
}) {
  const reduce = useReduceMotion((s) => s.on)
  const [shown, setShown] = useState(open)
  const y = useSharedValue(open ? 0 : 1)
  const drag = useSharedValue(0)
  useEffect(() => {
    if (open) setShown(true)
    y.value = withTiming(open ? 0 : 1, { duration: reduce ? 0 : open ? 260 : 200, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done && !open) runOnJS(setShown)(false)
    })
  }, [open, reduce, y])
  const pan = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onUpdate((e) => {
      drag.value = e.translationY > 0 ? e.translationY : onPullUp ? e.translationY * 0.4 : 0
    })
    .onEnd((e) => {
      if (e.translationY > 70 || e.velocityY > 700) runOnJS(onClose)()
      else if (onPullUp && (e.translationY < -50 || e.velocityY < -700)) runOnJS(onPullUp)()
      drag.value = withTiming(0, { duration: 160 })
    })
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value + y.value * 520 }], opacity: 1 - y.value * 0.6 }))
  const dim = useAnimatedStyle(() => ({ opacity: 1 - y.value }))
  if (!shown) return null
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 25 }]} pointerEvents="box-none">
      {backdrop ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: backdrop }, dim]}>
          <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ position: 'absolute', left: float ? 8 : 0, right: float ? 8 : 0, bottom, maxWidth: float ? SHEET_MAX_WIDTH : undefined, alignSelf: 'center' }, style, sheet]}>{children}</Animated.View>
      </GestureDetector>
    </View>
  )
}

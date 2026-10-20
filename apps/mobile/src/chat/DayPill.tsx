import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, View, type ViewToken } from 'react-native'
import { dayLabel, type Message } from '@glofly/shared'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { useReduceMotionOn } from '@/ui/RowLife'

// 0.7.5 sticky day: while you scroll a chat, a small pill at the top says which day you're in
// ("Today", "Yesterday", "Monday", "Oct 12"). It fades away a moment after you stop.

const HIDE_AFTER_MS = 1200

export function useDayPill<T extends { message: Message }>() {
  const [label, setLabel] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [visible, setVisible] = useState(false)
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (hide.current) clearTimeout(hide.current)
    },
    [],
  )

  // The list is newest-first (inverted): the oldest message on screen is the one at the top.
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
    let top: ViewToken<T> | null = null
    for (const v of viewableItems) if (v.index !== null && (!top || (top.index ?? -1) < v.index)) top = v
    if (top?.item) setLabel(dayLabel(top.item.message.createdAt))
  }).current
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10 }).current

  const start = useCallback(() => {
    if (hide.current) clearTimeout(hide.current)
    setDragging(true)
    setVisible(true)
  }, [])
  const end = useCallback(() => {
    setDragging(false)
    if (hide.current) clearTimeout(hide.current)
    hide.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS)
  }, [])

  return {
    label,
    visible: visible && !!label,
    dragging,
    listProps: {
      onViewableItemsChanged,
      viewabilityConfig,
      onScrollBeginDrag: start,
      onMomentumScrollBegin: start,
      onScrollEndDrag: end,
      onMomentumScrollEnd: end,
    },
  }
}

export function DayPill({ label, visible }: { label: string | null; visible: boolean }) {
  const { c } = useTheme()
  const reduce = useReduceMotionOn()
  const v = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const a = Animated.timing(v, { toValue: visible ? 1 : 0, duration: reduce ? 0 : 200, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [visible, reduce, v])
  if (!label) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center', zIndex: 5 }}>
      <Animated.View
        style={{
          opacity: v,
          transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
          paddingHorizontal: 12,
          paddingVertical: 5,
          borderRadius: 999,
          backgroundColor: c.sheet,
          borderWidth: 1,
          borderColor: c.line,
          boxShadow: '0 4px 14px rgba(28,18,16,0.14)',
        }}
      >
        <Text size={12} weight="bold" tone="muted" style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>
          {label}
        </Text>
      </Animated.View>
    </View>
  )
}

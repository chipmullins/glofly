import { useRef, useState, type ReactNode } from 'react'
import { Animated, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'

// Drag to reorder (Oct 13): press and hold a row, then drag it up or down; the others slide out of
// the way. Holding without dragging does what a long press did before (the row's menu), once you
// let go. Used for pinned chats (Chats) and the Groups list.
//
// The rows are drawn in a plain column (not inside a FlatList cell), so the dragged row can sit
// above its neighbours. Lists here are short (pins max 50; groups), so that's fine.

const HOLD_MS = 350

let active = false
/**
 * True while a row is being held/dragged. A row's own long-press (fires at 500 ms) checks this, so
 * holding a draggable row never opens its menu mid-drag; the menu comes from onHold on release.
 */
export const reorderActive = () => active
const MOVED = 8 // px: less than this between hold and release counts as "just held"

export function ReorderList<T>({
  items,
  keyOf,
  renderItem,
  onReorder,
  onHold,
  enabled = true,
}: {
  items: T[]
  keyOf: (item: T) => string
  renderItem: (item: T, dragging: boolean) => ReactNode
  /** The new order of every item's key. */
  onReorder: (keys: string[]) => void
  /** Held without dragging (the old long-press). */
  onHold: (item: T) => void
  enabled?: boolean
}) {
  const rowH = useRef(72)
  const shifts = useRef(new Map<string, Animated.Value>()).current
  const dragY = useRef(new Animated.Value(0)).current
  const drag = useRef<{ key: string; from: number; to: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  const shiftOf = (key: string) => {
    let v = shifts.get(key)
    if (!v) shifts.set(key, (v = new Animated.Value(0)))
    return v
  }

  function reset() {
    for (const v of shifts.values()) v.setValue(0)
    dragY.setValue(0)
    drag.current = null
    active = false
    setDragging(null)
  }

  function moveTo(to: number) {
    const d = drag.current
    if (!d || d.to === to) return
    d.to = to
    void Haptics.selectionAsync().catch(() => {})
    items.forEach((item, j) => {
      const key = keyOf(item)
      if (key === d.key) return
      const target = j > d.from && j <= to ? -rowH.current : j < d.from && j >= to ? rowH.current : 0
      Animated.timing(shiftOf(key), { toValue: target, duration: 140, useNativeDriver: true }).start()
    })
  }

  return (
    <View>
      {items.map((item, index) => {
        const key = keyOf(item)
        const isDragged = dragging === key
        const gesture = Gesture.Pan()
          .enabled(enabled && items.length > 0)
          .activateAfterLongPress(HOLD_MS)
          .runOnJS(true)
          .onStart(() => {
            drag.current = { key, from: index, to: index }
            active = true
            dragY.setValue(0)
            setDragging(key)
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {})
          })
          .onUpdate((e) => {
            const d = drag.current
            if (!d || d.key !== key) return
            dragY.setValue(e.translationY)
            const to = Math.max(0, Math.min(items.length - 1, Math.round(d.from + e.translationY / rowH.current)))
            moveTo(to)
          })
          .onEnd((e) => {
            const d = drag.current
            if (!d || d.key !== key) return
            if (Math.abs(e.translationY) < MOVED && d.to === d.from) {
              reset()
              onHold(item)
              return
            }
            const keys = items.map(keyOf)
            keys.splice(d.from, 1)
            keys.splice(d.to, 0, key)
            const changed = d.to !== d.from
            Animated.timing(dragY, { toValue: (d.to - d.from) * rowH.current, duration: 120, useNativeDriver: true }).start(() => {
              reset()
              if (changed) onReorder(keys)
            })
          })
          .onFinalize((_e, success) => {
            // Cancelled (e.g. the list scrolled away): put everything back.
            if (!success && drag.current?.key === key) reset()
          })
        return (
          <GestureDetector key={key} gesture={gesture}>
            <Animated.View
              onLayout={index === 0 ? (e: LayoutChangeEvent) => (rowH.current = e.nativeEvent.layout.height || rowH.current) : undefined}
              style={{
                zIndex: isDragged ? 10 : 0,
                elevation: isDragged ? 8 : 0,
                transform: [{ translateY: isDragged ? dragY : shiftOf(key) }, { scale: isDragged ? 1.02 : 1 }],
                ...(isDragged ? { boxShadow: '0 8px 24px rgba(0,0,0,0.25)' } : null),
              }}
            >
              {renderItem(item, isDragged)}
            </Animated.View>
          </GestureDetector>
        )
      })}
    </View>
  )
}

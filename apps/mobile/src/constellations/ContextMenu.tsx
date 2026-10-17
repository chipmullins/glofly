import { useEffect, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, View, useWindowDimensions, type View as RNView } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { ThemeOverride } from '@/ui/theme'
import { useReduceMotion } from './motion'
import { N } from './ui'

// Press and hold on the night side (canvas boards 4b and 6): everything else dims, the thing you
// held lifts a little where it was, and its menu opens right under it (or above it, near the
// bottom). Used for nebulas and for messages.

export type MenuItem = {
  key: string
  label: string
  icon?: ReactNode
  /** Small text on the right ("1 h · 8 h · 24 h · Until on", "3 of 8") */
  detail?: string
  chevron?: boolean
  danger?: boolean
  /** A heading above this item, on the darker band ("Moderator") */
  section?: string
  disabled?: boolean
}

type Anchor = { x: number; y: number; w: number; h: number }
/** Quick reactions across the top of a message's menu (picked = yours). Picking one returns "react:<emoji>". */
export type MenuReactions = { emojis: string[]; picked: string[]; more?: boolean }
type MenuState = { anchor: Anchor; preview: ReactNode; items: MenuItem[]; reactions?: MenuReactions; done: (key: string | null) => void } | null

const useMenu = create<{ menu: MenuState }>(() => ({ menu: null }))

/** Where something is on screen (for the menu to open beside it). */
export function measure(ref: RNView | null): Promise<Anchor | null> {
  return new Promise((resolve) => {
    if (!ref) return resolve(null)
    ref.measureInWindow((x, y, w, h) => resolve(w || h ? { x, y, w, h } : null))
  })
}

/** Opens the menu; resolves with the picked item's key (null = closed). */
export function openContextMenu(anchor: Anchor, preview: ReactNode, items: MenuItem[], reactions?: MenuReactions): Promise<string | null> {
  return new Promise((resolve) => {
    useMenu.getState().menu?.done(null)
    useMenu.setState({ menu: { anchor, preview, items, reactions, done: resolve } })
  })
}

const ROW = 50

export function ContextMenuHost() {
  const menu = useMenu((s) => s.menu)
  const reduce = useReduceMotion((s) => s.on)
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const shown = useSharedValue(0)

  useEffect(() => {
    shown.value = 0
    if (menu) shown.value = withTiming(1, { duration: reduce ? 0 : 180, easing: Easing.out(Easing.cubic) })
  }, [menu, reduce, shown])

  const dim = useAnimatedStyle(() => ({ opacity: shown.value }))
  const lift = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.03 * shown.value }] }))
  const pop = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: 0.94 + 0.06 * shown.value }] }))

  if (!menu) return null
  const close = (key: string | null) => {
    useMenu.setState({ menu: null })
    menu.done(key)
  }
  const sections = menu.items.filter((i) => i.section).length
  const menuH = menu.items.length * ROW + sections * 30 + (menu.reactions ? 62 : 0)
  const side = 18
  const w = Math.min(width - side * 2, 420)
  const left = Math.max(side, Math.min(menu.anchor.x, width - side - w))
  // The preview stays where it was, unless the menu wouldn't fit below or above it.
  const top0 = Math.max(insets.top + 8, Math.min(menu.anchor.y, height - insets.bottom - 16 - menuH - 14 - menu.anchor.h))
  const below = top0 + menu.anchor.h + 14
  const fitsBelow = below + menuH <= height - insets.bottom - 12
  const menuTop = fitsBelow ? below : Math.max(insets.top + 8, top0 - 14 - menuH)
  const previewTop = fitsBelow ? top0 : Math.min(top0, menuTop + menuH + 14)

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close(null)}>
      <ThemeOverride mode="night">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(5,3,2,0.62)' }, dim]}>
          <Pressable accessibilityLabel="Close menu" style={StyleSheet.absoluteFill} onPress={() => close(null)} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: menu.anchor.x, top: previewTop, width: menu.anchor.w }, lift]}>
          {menu.preview}
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            { position: 'absolute', left, width: w, top: menuTop, borderRadius: 18, backgroundColor: N.card, borderWidth: 1, borderColor: N.edge, boxShadow: '0 20px 50px rgba(0,0,0,0.6)', overflow: 'hidden' },
            pop,
          ]}
        >
          {menu.reactions ? (
            <View accessibilityLabel="Quick reactions" style={{ height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: N.line2 }}>
              {menu.reactions.emojis.map((e) => {
                const on = menu.reactions!.picked.includes(e)
                return (
                  <Pressable key={e} accessibilityRole="button" accessibilityLabel={on ? `Remove your ${e}` : `React ${e}`} onPress={() => close(`react:${e}`)} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? N.raised : 'transparent', borderWidth: on ? 1 : 0, borderColor: N.amber }}>
                    <Text size={22}>{e}</Text>
                  </Pressable>
                )
              })}
              {menu.reactions.more ? (
                <Pressable accessibilityRole="button" accessibilityLabel="More reactions" onPress={() => close('react:more')} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: N.card2 }}>
                  <Icon name="emojiAdd" size={20} color={N.ink2} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {menu.items.map((item, i) => {
            const last = i === menu.items.length - 1
            const nextIsSection = !!menu.items[i + 1]?.section
            const inSection = menu.items.slice(0, i + 1).some((x) => x.section)
            return (
              <View key={item.key}>
                {item.section ? (
                  <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, backgroundColor: N.side, borderTopWidth: 1, borderTopColor: N.line2 }}>
                    <Text size={11} weight="bold" style={{ color: N.violetText, letterSpacing: 0.88, textTransform: 'uppercase' }}>
                      {item.section}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={item.detail && !item.chevron ? `${item.label}, ${item.detail}` : item.label}
                  accessibilityState={{ disabled: !!item.disabled }}
                  disabled={item.disabled}
                  onPress={() => close(item.key)}
                  android_ripple={{ color: N.line2 }}
                  style={({ pressed }) => ({
                    height: ROW,
                    paddingHorizontal: 16,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    borderBottomWidth: last || nextIsSection ? 0 : 1,
                    borderBottomColor: N.line,
                    backgroundColor: pressed ? N.card2 : inSection ? N.side : 'transparent',
                    opacity: item.disabled ? 0.45 : 1,
                  })}
                >
                  {item.icon ?? null}
                  <Text size={15} weight={item.danger ? 'bold' : 'regular'} numberOfLines={1} style={{ flex: 1, color: item.danger ? N.redText : N.ink }}>
                    {item.label}
                  </Text>
                  {item.detail ? (
                    <Text size={item.chevron ? 13 : 12} numberOfLines={1} style={{ color: item.chevron ? N.muted : N.faint, flexShrink: 1 }}>
                      {item.detail}
                    </Text>
                  ) : null}
                  {item.chevron ? <Icon name="chevronRight" size={16} color={N.faint} strokeWidth={2.2} /> : null}
                </Pressable>
              </View>
            )
          })}
        </Animated.View>
      </ThemeOverride>
    </Modal>
  )
}

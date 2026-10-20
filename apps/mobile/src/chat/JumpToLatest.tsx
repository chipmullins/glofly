import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { Pressable, View, type FlatList, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import type { Message } from '@glofly/shared'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { reduceMotion } from '@/constellations/motion'
import { newLabel, newSince } from './jumpCount'

// "Jump to latest" for a chat or a nebula: once you've scrolled up more than a screen, a small
// round button shows at the bottom right, with "N new" when messages came in below you. New
// messages never move you (no auto-scroll while you're reading back); tapping goes to the newest
// and marks the chat read. The lists are upside down, so offset 0 is the newest message.

const NEAR_BOTTOM = 48

export function useJumpToLatest<T>(
  /** The chat's messages, newest first */
  newestFirst: readonly Message[],
  meId: string,
  /** Changing chats starts over */
  chatId: string,
  list: RefObject<FlatList<T> | null>,
  markRead: () => void,
) {
  const [away, setAway] = useState(false)
  const [anchor, setAnchor] = useState<string | null>(null)
  const awayRef = useRef(false)
  const newestRef = useRef(newestFirst)
  newestRef.current = newestFirst

  useEffect(() => {
    awayRef.current = false
    setAway(false)
    setAnchor(null)
  }, [chatId])

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement } = e.nativeEvent
    const y = contentOffset.y
    // More than a screen up shows the button; back near the newest hides it again.
    const next = awayRef.current ? y > NEAR_BOTTOM : y > layoutMeasurement.height
    if (next === awayRef.current) return
    awayRef.current = next
    setAway(next)
    setAnchor(next ? (newestRef.current[0]?.id ?? null) : null)
  }, [])

  const jump = useCallback(() => {
    list.current?.scrollToOffset({ offset: 0, animated: !reduceMotion() })
    awayRef.current = false
    setAway(false)
    setAnchor(null)
    markRead()
  }, [list, markRead])

  const count = away ? newSince(newestFirst, anchor, meId) : 0
  return {
    away,
    count,
    jump,
    /** For the FlatList */
    listProps: {
      onScroll,
      scrollEventThrottle: 64,
      // Reading back: a message arriving below doesn't push what you're reading around.
      maintainVisibleContentPosition: away ? { minIndexForVisible: 0 } : undefined,
    },
  }
}

export function JumpToLatestButton({ visible, count, onPress, night }: { visible: boolean; count: number; onPress: () => void; night?: boolean }) {
  const { c } = useTheme()
  if (!visible) return null
  const bg = night ? '#2a1c17' : c.sheet
  const edge = night ? '#4a372b' : c.line
  const ink = night ? '#f5ede6' : c.ink
  const accent = night ? '#ffb347' : c.accent
  const accentInk = night ? '#1c1210' : c.accentInk
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: 14, bottom: 12, alignItems: 'flex-end' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count ? `Jump to latest, ${newLabel(count)}` : 'Jump to latest'}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          height: 44,
          minWidth: 44,
          paddingHorizontal: count ? 14 : 0,
          justifyContent: 'center',
          borderRadius: 22,
          backgroundColor: count ? accent : bg,
          borderWidth: count ? 0 : 1,
          borderColor: edge,
          boxShadow: `0 4px 14px ${night ? 'rgba(0,0,0,0.45)' : c.shadow}`,
          opacity: pressed ? 0.88 : 1,
        })}
      >
        {count ? (
          <Text size={14} weight="bold" style={{ color: accentInk }}>
            {newLabel(count)}
          </Text>
        ) : null}
        <Icon name="arrowDown" size={20} color={count ? accentInk : ink} />
      </Pressable>
    </View>
  )
}

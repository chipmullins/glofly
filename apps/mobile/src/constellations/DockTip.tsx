import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { prefs } from '@/lib/storage'
import { useCx } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { useHomeDock } from './HomeDock'
import { N } from './ui'

// 0.9.1: a one-time tip above the Constellations tab, so people find the nebula dock (hold the tab
// or swipe up on it). Shows once you're in a constellation and haven't opened the dock yet; it
// goes for good when you tap "Got it" or open the dock any way.

const KEY = 'tips.dock'
let seenNow = false

export function DockTip() {
  const inOne = useCx((s) => s.cards.length > 0)
  const dockOpen = useHomeDock((s) => !!s.open)
  const [seen, setSeen] = useState<boolean | null>(seenNow ? true : null)
  useEffect(() => {
    if (seen !== null) return
    void prefs.get<boolean>(KEY, false).then((v) => setSeen(v || seenNow))
  }, [seen])
  const done = () => {
    seenNow = true
    setSeen(true)
    void prefs.set(KEY, true)
  }
  // Opening the dock is the lesson: no need to show it again.
  useEffect(() => {
    if (dockOpen && seen === false) done()
  }, [dockOpen, seen])
  if (seen !== false || !inOne || dockOpen) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: '100%', paddingBottom: 12 }}>
      {/* Covers the new-chat button for the moment it shows (until Got it); the arrow sits over the Constellations tab
          (4th of 5, a little wider: its middle is at about 69% of the bar). */}
      <View
        accessibilityRole="alert"
        style={{ marginLeft: 12, marginRight: 12, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 14, paddingRight: 6, paddingVertical: 8, borderRadius: 16, backgroundColor: N.card2, borderWidth: 1, borderColor: N.edge2, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}
      >
        <Text size={13} style={{ color: N.ink, flex: 1, lineHeight: 18 }}>
          <Text size={13} weight="bold" style={{ color: N.amber }}>
            Tip:{' '}
          </Text>
          Hold Constellations (or swipe up on it) for your nebula dock.
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Got it, hide this tip" onPress={done} hitSlop={6} style={{ height: 44, paddingHorizontal: 10, justifyContent: 'center' }}>
          <Text size={13} weight="bold" style={{ color: N.amber }}>
            Got it
          </Text>
        </Pressable>
      </View>
      <View style={{ position: 'absolute', left: '69%', bottom: 6, width: 12, height: 12, marginLeft: -6, transform: [{ rotate: '45deg' }], backgroundColor: N.card2, borderRightWidth: 1, borderBottomWidth: 1, borderColor: N.edge2 }} />
    </View>
  )
}

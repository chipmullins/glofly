import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler'
import { runOnJS } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { unreadTotal } from '@/lib/chats'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { useCx } from '@/state/constellations'
import { Text } from '@/ui/kit'
import { flyHome } from './transition'
import { openDmDock, useDock } from './dock'
import { haptic } from './motion'
import { CountBadge, Face, GalaxyIcon, Glyph, HomeGlyph, N } from './ui'
import { VoiceBar } from './Voice'
export { NIGHT_TAB_HEIGHT } from './ui'

// The tab bar inside Constellations (board 1/8a): Home (the firefly) · Constellations · Mentions ·
// You. Home is the "portal": tap it to fly home, swipe up on it (or hold it) for your Glofly
// chats without leaving the night.

export type NightTab = 'constellations' | 'mentions' | 'you' | null

export function NightTabBar({ active }: { active: NightTab }) {
  const insets = useSafeAreaInsets()
  const me = useSession((s) => s.user)
  const unread = useStore((s) => unreadTotal(Object.values(s.conversations)))
  const mentions = useCx((s) => s.mentionsUnread)
  const dockOpen = useDock((s) => s.dm !== null)

  const homeGesture = Gesture.Race(
    Gesture.Fling()
      .direction(Directions.UP)
      .onEnd(() => runOnJS(openDmDock)()),
    Gesture.LongPress()
      .minDuration(380)
      .onStart(() => runOnJS(openDmDock)()),
    Gesture.Tap().onEnd(() => runOnJS(flyHome)()),
  )

  const goTab = (tab: Exclude<NightTab, null>) => {
    if (tab === active) return
    haptic.select()
    if (tab === 'constellations') router.navigate('/constellations')
    else router.navigate(tab === 'mentions' ? '/constellations/mentions' : '/constellations/you')
  }

  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', paddingTop: 6, paddingHorizontal: 6, paddingBottom: Math.max(insets.bottom, 10) + 2, backgroundColor: 'rgba(18,12,10,0.95)', borderTopWidth: 1, borderTopColor: N.line2 }}
    >
      <VoiceBar />
      <GestureDetector gesture={homeGesture}>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={unread ? `Home, back to Glofly, ${unread} unread chats` : 'Home, back to Glofly'}
          accessibilityHint="Swipe up or hold for your Glofly chats"
          accessibilityActions={[{ name: 'activate' }, { name: 'longpress', label: 'Your Glofly chats' }]}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? openDmDock() : flyHome())}
          style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: 50 }}
        >
          <View style={{ width: 18, height: 3, borderRadius: 2, backgroundColor: dockOpen ? N.amber : N.edge2 }} />
          <HomeGlyph />
          <Text size={11} weight={dockOpen ? 'bold' : 'medium'} style={{ color: dockOpen ? N.amber : N.ink2 }}>
            Home
          </Text>
          {unread > 0 ? <CountBadge count={unread} ring="rgba(18,12,10,0.95)" style={{ position: 'absolute', left: '50%', marginLeft: 6, top: 4 }} /> : null}
        </View>
      </GestureDetector>
      <TabItem label="Constellations" on={active === 'constellations'} onPress={() => goTab('constellations')}>
        <GalaxyIcon size={24} color={active === 'constellations' ? N.amber : N.ink2} />
      </TabItem>
      <TabItem label="Mentions" on={active === 'mentions'} onPress={() => goTab('mentions')} badge={mentions} badgeLabel={mentions ? `, ${mentions} new` : ''}>
        <Glyph name="mention" size={24} color={active === 'mentions' ? N.amber : N.ink2} />
        {mentions > 0 ? <CountBadge count={mentions} mention ring="rgba(18,12,10,0.95)" style={{ position: 'absolute', left: '50%', marginLeft: 6, top: -4 }} /> : null}
      </TabItem>
      <TabItem label="You" on={active === 'you'} onPress={() => goTab('you')}>
        {me ? <Face user={me} size={24} me style={active === 'you' ? { boxShadow: `0 0 0 2px ${N.amber}` } : undefined} /> : null}
      </TabItem>
    </View>
  )
}

function TabItem({ label, on, onPress, children, badgeLabel = '' }: { label: string; on: boolean; onPress: () => void; children: React.ReactNode; badge?: number; badgeLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label}${badgeLabel}`}
      onPress={onPress}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 3, minHeight: 50 }}
    >
      <View>{children}</View>
      <Text size={11} weight={on ? 'bold' : 'medium'} numberOfLines={1} style={{ color: on ? N.amber : N.ink2 }}>
        {label}
      </Text>
    </Pressable>
  )
}

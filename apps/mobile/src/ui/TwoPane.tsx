import { View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Chats from '@/app/(main)/(tabs)/chats'
import Groups from '@/app/(main)/(tabs)/groups'
import Friends from '@/app/(main)/(tabs)/friends'
import Settings from '@/app/(main)/(tabs)/settings'
import { paneWidth, usePaneTab, type PaneTab } from '@/lib/layout'
import { PaneTabBar } from './TabBar'
import { Text } from './kit'
import { useTheme } from './theme'

// iPad (0.4.0): the two-pane layout. The left pane is the phone app's four tabs (Chats, Groups,
// Friends, Settings) with their bar at the bottom; the right pane is everything they open (a chat,
// a profile, a settings page), shown by (main)/_layout.tsx's Stack. See lib/layout.ts.

const PAGES: Record<PaneTab, () => React.JSX.Element | null> = { chats: Chats, groups: Groups, friends: Friends, settings: Settings }

/** The left pane. All four tabs stay mounted (hidden when not shown), so each keeps its scroll and search. */
export function LeftPane({ hidden }: { hidden?: boolean }) {
  const { c } = useTheme()
  const { width } = useWindowDimensions()
  const tab = usePaneTab((s) => s.tab)
  return (
    <View
      style={{
        width: paneWidth(width),
        display: hidden ? 'none' : 'flex',
        backgroundColor: c.bg,
        borderRightWidth: 1,
        borderRightColor: c.line,
      }}
    >
      <View style={{ flex: 1 }}>
        {(Object.keys(PAGES) as PaneTab[]).map((key) => {
          const Page = PAGES[key]
          return (
            <View key={key} style={{ flex: 1, display: key === tab ? 'flex' : 'none' }}>
              <Page />
            </View>
          )
        })}
      </View>
      <PaneTabBar />
    </View>
  )
}

/** The right pane before anything is opened. */
export function EmptyPane() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const tab = usePaneTab((s) => s.tab)
  const hint =
    tab === 'friends'
      ? 'Pick a friend to message them.'
      : tab === 'groups'
        ? 'Pick a group to open it here.'
        : tab === 'settings'
          ? 'Pick a setting to see it here.'
          : 'Pick a chat to open it here.'
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32, paddingTop: insets.top }}>
      <Image source={require('../../assets/firefly.png')} style={{ width: 72, height: 53, opacity: 0.9 }} contentFit="contain" accessibilityIgnoresInvertColors />
      <Text display size={24} style={{ textAlign: 'center' }} accessibilityRole="header">
        Glow on. Say hi.
      </Text>
      <Text tone="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
        {hint}
      </Text>
    </View>
  )
}

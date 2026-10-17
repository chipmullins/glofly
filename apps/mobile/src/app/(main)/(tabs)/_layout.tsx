import { Platform } from 'react-native'
import { Tabs } from 'expo-router'
import { TabBar } from '@/ui/TabBar'
import { useTheme } from '@/ui/theme'
import { EmptyPane } from '@/ui/TwoPane'
import { usePaneTab, useWide } from '@/lib/layout'
import Animated from 'react-native-reanimated'
import { useHomeAwayStyle } from '@/constellations/transition'

// iPhone: no slide between tabs. Tapping tabs quickly interrupted the "shift" animation and could
// leave the new tab off screen, showing a blank (white) page until you tapped back and forth.
// The scene background is the app's own color, so nothing ever flashes white either way.
const animation = Platform.OS === 'ios' ? 'none' : 'shift'

export default function TabsLayout() {
  const { c } = useTheme()
  const wide = useWide()
  const initialTab = usePaneTab((s) => s.tab)
  // Glofly 2.0: Glofly home slides away while the night (Constellations) is up.
  const homeAway = useHomeAwayStyle()
  // iPad (two panes): the tabs live in the left pane (ui/TwoPane.tsx); here, the right pane's
  // "nothing open yet". Narrow again (Split View): the phone tabs, on the same tab as before.
  if (wide)
    return (
      <Animated.View style={[{ flex: 1 }, homeAway]}>
        <EmptyPane />
      </Animated.View>
    )
  return (
    <Animated.View style={[{ flex: 1 }, homeAway]}>
    <Tabs
      initialRouteName={initialTab}
      screenOptions={{ headerShown: false, animation, sceneStyle: { backgroundColor: c.bg } }}
      tabBar={(props) => <TabBar {...props} />}
    >
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="groups" options={{ title: 'Groups' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
    </Animated.View>
  )
}

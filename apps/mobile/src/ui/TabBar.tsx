import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ComponentProps } from 'react'
import type { Tabs } from 'expo-router'
import { Icon, type IconName } from './icons'
import { Text } from './kit'
import { useTheme } from './theme'
import { useStore } from '@/state/store'
import { unreadTotal } from '@/lib/chats'

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

// The bottom navigation bar from the design: Chats · Friends · Groups · Settings
// (Friends moved before Groups, Oct 13; the order itself comes from the screens in (tabs)/_layout.tsx).

const TABS: Record<string, { label: string; icon: IconName }> = {
  chats: { label: 'Chats', icon: 'chatsLine' },
  groups: { label: 'Groups', icon: 'groups' },
  friends: { label: 'Friends', icon: 'friends' },
  settings: { label: 'Settings', icon: 'gear' },
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const conversations = useStore((s) => s.conversations)
  const incoming = useStore((s) => s.friends.incoming.length)
  const all = Object.values(conversations)
  const badges: Record<string, number> = {
    chats: unreadTotal(all),
    groups: unreadTotal(all.filter((x) => x.kind === 'group')),
    friends: incoming,
    settings: 0,
  }
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: c.navBg, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12) + 4 }}
    >
      {state.routes.map((route, index) => {
        const tab = TABS[route.name]
        if (!tab) return null
        const focused = state.index === index
        const badge = badges[route.name] ?? 0
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={badge ? `${tab.label}, ${badge} new` : tab.label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name)
            }}
            style={{ flex: 1, alignItems: 'center', gap: 4 }}
          >
            <View style={{ width: 64, height: 32, borderRadius: 16, backgroundColor: focused ? c.accentSoft : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={focused && route.name === 'chats' ? 'chats' : tab.icon} size={22} color={focused ? c.ink : c.muted} />
              {badge > 0 ? (
                <View style={{ position: 'absolute', left: 38, top: -2, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: c.dnd, alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={11} weight="bold" style={{ color: '#FFFFFF' }}>
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text size={12} weight={focused ? 'bold' : 'medium'} style={{ color: focused ? c.ink : c.muted }}>
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ComponentProps } from 'react'
import type { Tabs } from 'expo-router'
import { Icon, type IconName } from './icons'
import { Text } from './kit'
import { c } from './theme'
import { useCounts } from '@/lib/hooks'

type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

// The tab bar from TabBar.dc.html: Home · Reports (gold badge = open reports) · Accounts ·
// Constellations · Server, on #1b1238 with gold for the current tab.

const TABS: Record<string, { label: string; icon: IconName }> = {
  home: { label: 'Home', icon: 'home' },
  reports: { label: 'Reports', icon: 'reports' },
  accounts: { label: 'Accounts', icon: 'accounts' },
  constellations: { label: 'Constellations', icon: 'constellations' },
  server: { label: 'Server', icon: 'server' },
}

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets()
  const openReports = useCounts((s) => s.openReports)
  return (
    <View
      accessibilityRole="tabbar"
      style={{
        flexDirection: 'row',
        backgroundColor: c.tabBar,
        borderTopWidth: 1,
        borderTopColor: c.tabBorder,
        paddingTop: 6,
        paddingHorizontal: 4,
        paddingBottom: Math.max(insets.bottom, 8),
      }}
    >
      {state.routes.map((route, i) => {
        const tab = TABS[route.name]
        if (!tab) return null
        const on = state.index === i
        const badge = route.name === 'reports' && openReports > 0 ? openReports : 0
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={badge ? `${tab.label}, ${badge} open` : tab.label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!on && !event.defaultPrevented) navigation.navigate(route.name)
            }}
            style={{ flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 3 }}
          >
            <View style={{ height: 24 }}>
              <Icon name={tab.icon} size={24} width={1.9} color={on ? c.gold : c.onVioletMuted} />
              {badge ? (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    left: 16,
                    minWidth: 18,
                    height: 18,
                    paddingHorizontal: 5,
                    borderRadius: 9,
                    backgroundColor: c.gold,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text size={11} weight="bold" color={c.goldInk} maxFontSizeMultiplier={1.2}>
                    {badge > 99 ? '99+' : badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text size={10.5} weight={on ? 'semi' : 'medium'} color={on ? c.gold : c.onVioletMuted} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              {tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

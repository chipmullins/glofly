import { View } from 'react-native'
import { router, usePathname } from 'expo-router'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useCall } from '@/calls/controller'
import { Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { dismissLit, useCampfire } from './store'
import { FireButton } from './ui'
import { useFire, useStill } from './lib'

// "Campfire is lit · Join" (Start board): a game master lit a table in the call you're in.
// Shown over everything (but not at that table), until you join or close it.

export function CampfireLitBanner() {
  const fire = useFire()
  const still = useStill()
  const insets = useSafeAreaInsets()
  const path = usePathname()
  const callId = useCall((s) => s.call?.id ?? null)
  const lit = useCampfire((s) => Object.values(s.lit).find((l) => l.callId === callId && !s.litDismissed[l.campaignId]))
  const atTable = useCampfire((s) => (lit ? !!s.tables[lit.campaignId] : false))
  if (!lit || !callId || atTable || path.startsWith('/campfire')) return null
  return (
    <Animated.View
      key={lit.campaignId}
      entering={still ? undefined : FadeInDown.duration(260)}
      exiting={still ? undefined : FadeOutUp.duration(180)}
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 8, zIndex: 70, alignSelf: 'center', maxWidth: 520, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: fire.panel, borderWidth: 1, borderColor: 'rgba(255,179,71,0.3)', boxShadow: '0 14px 40px rgba(0,0,0,0.45)' }}
    >
      <Icon name="campfire" size={20} color={fire.amber} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text size={14} weight="bold" style={{ color: fire.ink }}>
          Campfire is lit
        </Text>
        <Text size={12} numberOfLines={1} style={{ color: fire.muted }}>
          {lit.name}
        </Text>
      </View>
      <FireButton label="Not now" kind="quiet" height={44} size={13} onPress={() => dismissLit(lit.campaignId)} style={{ paddingHorizontal: 8, borderWidth: 0 }} />
      <FireButton label="Join" kind="primary" height={44} size={13} a11y={`Join ${lit.name}`} onPress={() => router.push({ pathname: '/campfire/[id]', params: { id: lit.campaignId } })} style={{ paddingHorizontal: 16, borderRadius: 10 }} />
    </Animated.View>
  )
}

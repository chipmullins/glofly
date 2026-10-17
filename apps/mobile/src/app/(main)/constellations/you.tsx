import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { STATUS_LABEL } from '@glofly/shared'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { useCx } from '@/state/constellations'
import { statusMenu } from '@/lib/status'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { NightSky } from '@/constellations/sky'
import { NightTabBar } from '@/constellations/NightTabBar'
import { flyHome } from '@/constellations/transition'
import { GamesCard } from '@/constellations/games'
import { Card, Face, GalaxyIcon, IconBox, N, Row } from '@/constellations/ui'

// You (the night tab bar's last tab): your status, My games, and the way back to your profile and
// Glofly's settings.

const DOT = { online: N.online, away: N.away, dnd: N.red, invisible: N.edge2 } as const

export default function YouScreen() {
  const insets = useSafeAreaInsets()
  const me = useSession((s) => s.user)
  const status = useStore((s) => s.myStatus)
  const cards = useCx((s) => s.cards)
  if (!me) return null
  const owned = cards.filter((c) => c.role.owner).length
  const s = status?.status ?? 'online'
  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky flies={1} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 140, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <Text display size={24} accessibilityRole="header">
          You
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2 }}>
          <Face user={me} size={64} me />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text display size={21} numberOfLines={1}>
              {me.displayName}
            </Text>
            <Text size={13} style={{ color: N.muted }} numberOfLines={1}>
              @{me.username}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Status: ${STATUS_LABEL[s]}${status?.statusText ? `, ${status.statusText}` : ''}. Change`} onPress={() => void statusMenu()} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: N.card2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: DOT[s] }} />
              <Text size={13} weight="medium" numberOfLines={1}>
                {STATUS_LABEL[s]}
                {status?.statusText ? ` · ${status.statusText}` : ''}
              </Text>
              <Icon name="chevronDown" size={12} color={N.muted} />
            </Pressable>
          </View>
        </View>
        <GamesCard userId={me.id} isMe />
        <Card>
          <Row icon={<IconBox><GalaxyIcon size={18} /></IconBox>} label="Your constellations" detail={`${cards.length}${owned ? ` · you own ${owned}` : ''}`} chevron onPress={() => router.navigate('/constellations')} />
          <Row icon={<IconBox><Icon name="pencil" size={17} color={N.ink} /></IconBox>} label="Edit profile" chevron onPress={() => router.push('/edit-profile')} />
          <Row icon={<IconBox><Icon name="gear" size={17} color={N.ink} /></IconBox>} label="Glofly settings" sub="Theme, notifications, account" chevron last onPress={() => flyHome(() => router.navigate('/settings'))} />
        </Card>
        <Text size={12} style={{ color: N.faint, textAlign: 'center' }}>
          Each constellation has its own notifications: open it, then Settings.
        </Text>
      </ScrollView>
      <NightTabBar active="you" />
    </View>
  )
}

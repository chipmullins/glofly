import { View } from 'react-native'
import { useCall } from '@/calls/controller'
import { useCx } from '@/state/constellations'
import { useWide } from '@/lib/layout'
import { NebulaList, SideStrip } from '@/constellations/Inside'
import { VoiceStage } from '@/constellations/Voice'
import { flyHome } from '@/constellations/transition'
import { openDmDock } from '@/constellations/dock'
import { router } from 'expo-router'
import { useStore } from '@/state/store'
import { unreadTotal } from '@/lib/chats'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Text } from '@/ui/kit'
import { N } from '@/constellations/ui'

// The voice stage you're in (canvas board 5; iPad: the strip and a dimmed sidebar beside it, with
// the DM Dock as a popover from Home).

export default function VoiceScreen() {
  const wide = useWide()
  const voice = useCall((s) => s.voice)
  const c = useCx((s) => (voice ? s.details[voice.constellationId] : undefined))
  const homeCount = useStore((s) => unreadTotal(Object.values(s.conversations)))
  const insets = useSafeAreaInsets()
  if (!wide || !c) return <VoiceStage />
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: N.deep, paddingTop: insets.top }}>
      <SideStrip current={c.id} homeCount={homeCount} onHome={() => flyHome()} onHomeHold={() => openDmDock(false)} onAll={() => router.navigate('/constellations')} onPick={(id) => router.navigate({ pathname: '/constellations/[cid]', params: { cid: id } })} onAdd={() => router.navigate('/constellations')} />
      <View style={{ width: 260, paddingTop: 16, paddingHorizontal: 10, backgroundColor: N.side, borderRightWidth: 1, borderRightColor: N.card2, opacity: 0.35 }}>
        <Text display size={20} style={{ paddingHorizontal: 8, paddingBottom: 12 }}>
          {c.name}
        </Text>
        <NebulaList c={c} dense selected={voice?.nebulaId} onOpen={(n) => router.navigate({ pathname: '/constellations/[cid]', params: { cid: c.id, nebula: n.id } })} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <VoiceStage wide />
      </View>
    </View>
  )
}

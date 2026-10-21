import { useEffect } from 'react'
import { View } from 'react-native'
import { router, useIsFocused, useLocalSearchParams } from 'expo-router'
import { loadDetail, onRemovedFrom, useCx } from '@/state/constellations'
import { useWide } from '@/lib/layout'
import { Spinner, Text } from '@/ui/kit'
import { NebulaChat } from '@/constellations/NebulaChat'
import { VoiceLobby } from '@/constellations/Voice'
import { N, NightButton, NightCenter } from '@/constellations/ui'
import { rememberCxPlace } from '@/constellations/nav'
import { stepNebula } from '@/constellations/roles'
import { useKeyCommand } from '@/lib/keys'

// One nebula on a phone: a text nebula's chat, or a voice nebula's lobby. On iPad the nebula opens
// inside the constellation's layout instead.

export default function NebulaScreen() {
  const { cid, nid } = useLocalSearchParams<{ cid: string; nid: string }>()
  const c = useCx((s) => s.details[cid]) ?? null
  const problem = useCx((s) => s.problems[cid])
  const wide = useWide()
  const n = c?.nebulas.find((x) => x.id === nid) ?? null

  useEffect(() => {
    if (!c) void loadDetail(cid)
  }, [cid, c])
  // 0.7.1: the Constellations tab brings you back to this nebula
  useEffect(() => {
    rememberCxPlace(cid, nid)
  }, [cid, nid])
  useEffect(
    () =>
      onRemovedFrom((id) => {
        if (id === cid) router.replace('/constellations')
      }),
    [cid],
  )
  useEffect(() => {
    if (wide && c) router.replace({ pathname: '/constellations/[cid]', params: { cid, nebula: nid } })
  }, [wide, c, cid, nid])
  // 0.8.0 keyboard: ⌥↑ / ⌥↓ (Alt on Android) to the previous / next nebula.
  const focused = useIsFocused()
  const step = (dir: -1 | 1) => {
    const next = c ? stepNebula(c, nid, dir) : null
    if (next) router.replace({ pathname: '/constellations/[cid]/nebula/[nid]', params: { cid, nid: next.id } })
  }
  useKeyCommand('prevNebula', () => step(-1), focused && !!c && !wide)
  useKeyCommand('nextNebula', () => step(1), focused && !!c && !wide)

  if (!c || !n) {
    const gone = !!c && !n
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        <NightCenter>
          {gone || problem ? (
            <>
              <Text size={15} style={{ color: N.ink2, textAlign: 'center' }}>
                {gone ? "That nebula isn't there any more." : problem}
              </Text>
              <NightButton kind="outline" label={gone ? `Back to ${c!.name}` : 'Back to Constellations'} onPress={() => (gone ? router.replace({ pathname: '/constellations/[cid]', params: { cid } }) : router.replace('/constellations'))} />
            </>
          ) : (
            <Spinner />
          )}
        </NightCenter>
      </View>
    )
  }
  return n.kind === 'voice' ? <VoiceLobby c={c} n={n} /> : <NebulaChat c={c} n={n} />
}

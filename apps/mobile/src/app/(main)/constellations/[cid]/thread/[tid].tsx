import { useEffect } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { loadDetail, useCx } from '@/state/constellations'
import { Spinner, Text } from '@/ui/kit'
import { ThreadScreen } from '@/constellations/Threads'
import { N, NightCenter } from '@/constellations/ui'

// Communities round (Nov 2026): a thread or a forum post on a phone (canvas boards 20, 22).
export default function ThreadRoute() {
  const { cid, tid, nid } = useLocalSearchParams<{ cid: string; tid: string; nid: string }>()
  const c = useCx((s) => s.details[cid]) ?? null
  const n = c?.nebulas.find((x) => x.id === nid) ?? null
  useEffect(() => {
    if (!c) void loadDetail(cid)
  }, [cid, c])
  // 0.9.1: the nebula is gone or hidden from you: say so instead of spinning forever.
  if (c && !n)
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        <NightCenter>
          <Text size={15} weight="bold" style={{ color: N.ink, textAlign: 'center' }}>
            This isn't available any more.
          </Text>
          <Text size={14} weight="bold" accessibilityRole="button" onPress={() => router.back()} style={{ color: N.amber, marginTop: 14, padding: 10 }}>
            Go back
          </Text>
        </NightCenter>
      </View>
    )
  if (!c || !n)
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        <NightCenter>
          <Spinner />
        </NightCenter>
      </View>
    )
  return <ThreadScreen c={c} n={n} threadId={tid} />
}

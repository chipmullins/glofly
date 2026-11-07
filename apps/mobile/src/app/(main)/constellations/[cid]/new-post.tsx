import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { useCx } from '@/state/constellations'
import { NewPostScreen } from '@/constellations/Threads'
import { N } from '@/constellations/ui'

// Communities round (Nov 2026): a new forum post on a phone.
export default function NewPostRoute() {
  const { cid, nid } = useLocalSearchParams<{ cid: string; nid: string }>()
  const c = useCx((s) => s.details[cid]) ?? null
  const n = c?.nebulas.find((x) => x.id === nid) ?? null
  if (!c || !n) return <View style={{ flex: 1, backgroundColor: N.bg }} />
  return <NewPostScreen c={c} n={n} />
}

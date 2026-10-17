import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { loadDetail, useCx } from '@/state/constellations'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { MemberList, openMemberSheet } from '@/constellations/Members'
import { can } from '@/constellations/roles'
import { N, NightCenter, NightHeader, SearchBox } from '@/constellations/ui'

// Members, grouped by role (canvas board 4). Tap or hold someone for their actions.

export default function MembersScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useCx((s) => s.details[cid]) ?? null
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!c) void loadDetail(cid)
  }, [cid, c])
  if (!c) {
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        <NightCenter>
          <Spinner />
        </NightCenter>
      </View>
    )
  }
  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightHeader
        title={
          <Text size={17} weight="bold" accessibilityRole="header">
            Members <Text size={17} weight="medium" style={{ color: N.muted }}>· {c.members.length}</Text>
          </Text>
        }
        right={
          can(c, 'invite') ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Invite people" onPress={() => router.push({ pathname: '/constellations/[cid]/settings/invites', params: { cid } })} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="addPerson" size={18} color={N.amber} />
            </Pressable>
          ) : null
        }
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search members" />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <MemberList c={c} query={q} onPick={(m) => openMemberSheet(c.id, m.user.id)} />
      </ScrollView>
    </View>
  )
}

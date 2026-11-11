import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import type { ConstellationMember } from '@glofly/shared'
import { request } from '@/api/http'
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
  // Communities round 2 (board 4a): big constellations only send staff + people online; a search
  // asks the server, which finds anyone.
  const [found, setFound] = useState<ConstellationMember[] | null>(null)
  const partial = !!c?.membersPartial
  useEffect(() => {
    if (!c) void loadDetail(cid)
  }, [cid, c])
  useEffect(() => {
    if (!partial || !q.trim()) return
    let gone = false
    const t = setTimeout(() => {
      void request<{ members: ConstellationMember[] }>('GET', `/constellations/${cid}/members?q=${encodeURIComponent(q.trim())}&limit=100`).then((r) => {
        if (!gone && r.ok) setFound(r.data.members)
      })
    }, 250)
    return () => {
      gone = true
      clearTimeout(t)
    }
  }, [partial, q, cid])
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
            Members <Text size={17} weight="medium" style={{ color: N.muted }}>· {(c.memberCount ?? c.members.length).toLocaleString('en-US')}</Text>
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
        <MemberList c={partial && q.trim() && found ? { ...c, members: found } : c} query={q} onPick={(m) => openMemberSheet(c.id, m.user.id)} />
        {partial && !q.trim() ? (
          <Text size={12.5} style={{ color: N.muted, padding: 10, marginTop: 8, borderRadius: 12, backgroundColor: N.card2 }}>
            Offline members ({((c.memberCount ?? 0) - c.members.length).toLocaleString('en-US')}) are hidden in constellations over 1,000 people. Search finds anyone.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}

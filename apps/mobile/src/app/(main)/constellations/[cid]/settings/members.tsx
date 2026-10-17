import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { timeAgo, type ConstellationBan, type ConstellationDetail, type JoinRequest } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay } from '@/state/constellations'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { firstName } from '@/lib/format'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { MemberList, openMemberSheet } from '@/constellations/Members'
import { can, roleColor, topRole } from '@/constellations/roles'
import { runDetail, SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, Card, Glyph, N, NightButton, SearchBox, Segmented } from '@/constellations/ui'

// Members (canvas board 7b): join requests (Decline / Let in), everyone, bans (Unban), and
// transferring ownership.

type Tab = 'requests' | 'everyone' | 'bans'

export default function MembersSettings() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  if (!c) return <SettingsScreen title="Members" c={null}>{null}</SettingsScreen>
  return <Members c={c} />
}

function Members({ c }: { c: ConstellationDetail }) {
  const meId = useSession((s) => s.user?.id ?? '')
  const friends = useStore((s) => s.friends.friends)
  const canRequests = can(c, 'approveRequests')
  const canBans = can(c, 'ban')
  const [tab, setTab] = useState<Tab>(canRequests && c.pendingRequests ? 'requests' : 'everyone')
  const [requests, setRequests] = useState<JoinRequest[] | null>(null)
  const [bans, setBans] = useState<ConstellationBan[] | null>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (canRequests) void cx.requests(c.id).then((r) => r.ok && setRequests(r.data.requests))
    if (canBans) void cx.bans(c.id).then((r) => r.ok && setBans(r.data.bans))
  }, [c.id, canRequests, canBans, c.pendingRequests])

  async function decide(r: JoinRequest, approve: boolean) {
    if (await runDetail(() => cx.decide(c.id, r.user.id, approve))) {
      haptic.success()
      setRequests((l) => l?.filter((x) => x.user.id !== r.user.id) ?? null)
      cxSay(approve ? `${firstName(r.user.displayName, r.user.username)} is in.` : 'Request declined.')
    }
  }
  async function unban(b: ConstellationBan) {
    const r = await cx.unban(c.id, b.user.id)
    if (!r.ok) return cxSay(r.message)
    setBans((l) => l?.filter((x) => x.user.id !== b.user.id) ?? null)
    cxSay(`${firstName(b.user.displayName, b.user.username)} can join again.`)
  }
  async function transfer() {
    const others = c.members.filter((m) => m.user.id !== meId).sort((a, b) => topRole(c, b.user.id).position - topRole(c, a.user.id).position)
    if (!others.length) return cxSay("There's nobody else here yet.")
    const pick = await chooseFrom(
      others.slice(0, 30).map((m) => ({ key: m.user.id, label: m.user.displayName, detail: topRole(c, m.user.id).name })),
      'Who should own it?',
    )
    const m = others.find((x) => x.user.id === pick)
    if (!m) return
    const ok = await confirm({ title: `Make ${m.user.displayName} the Owner?`, message: `You'll become an Admin of ${c.name}, and only they can give it back.`, confirmLabel: 'Transfer ownership', danger: true })
    if (ok && (await runDetail(() => cx.transfer(c.id, m.user.id)))) {
      haptic.success()
      cxSay(`${firstName(m.user.displayName, m.user.username)} owns ${c.name} now.`)
    }
  }
  const friendOf = (id: string) => friends.find((f) => f.id === id)

  const tabs: { id: Tab; name: string }[] = [
    ...(canRequests ? [{ id: 'requests' as const, name: `Requests${requests?.length ? ` · ${requests.length}` : ''}` }] : []),
    { id: 'everyone', name: 'Everyone' },
    ...(canBans ? [{ id: 'bans' as const, name: `Bans${bans?.length ? ` · ${bans.length}` : ''}` }] : []),
  ]

  return (
    <SettingsScreen title="Members" c={c}>
      {tabs.length > 1 ? <Segmented label="Show" options={tabs} value={tab} onChange={setTab} /> : null}
      {tab === 'requests' ? (
        requests === null ? (
          <Spinner />
        ) : requests.length ? (
          requests.map((r) => (
            <Card key={r.user.id} style={{ padding: 14, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar user={r.user} size={42} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={15} weight="bold" numberOfLines={1}>
                    {r.user.displayName}
                  </Text>
                  <Text size={12} style={{ color: N.muted }} numberOfLines={1}>
                    {friendOf(r.user.id) ? 'Your friend · ' : ''}
                    {r.note ? '' : 'No note · '}asked {timeAgo(r.createdAt)}
                  </Text>
                </View>
              </View>
              {r.note ? (
                <Text size={14} style={{ color: N.ink2, fontStyle: 'italic' }}>
                  “{r.note}”
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <NightButton kind="outline" label="Decline" style={{ flex: 1 }} onPress={() => void decide(r, false)} />
                <NightButton kind="green" label="Let in" style={{ flex: 1 }} onPress={() => void decide(r, true)} />
              </View>
            </Card>
          ))
        ) : (
          <Text size={14} style={{ color: N.muted }}>
            Nobody's waiting to join.
          </Text>
        )
      ) : null}
      {tab === 'everyone' ? (
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Search members" />
          <MemberList c={c} query={q} onPick={(m) => openMemberSheet(c.id, m.user.id)} />
        </>
      ) : null}
      {tab === 'bans' ? (
        bans === null ? (
          <Spinner />
        ) : bans.length ? (
          <Card>
            {bans.map((b, i) => (
              <View key={b.user.id} style={{ minHeight: 60, paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: i === bans.length - 1 ? 0 : 1, borderBottomColor: N.line }}>
                <Avatar user={b.user} size={38} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={15} weight="bold" numberOfLines={1}>
                    {b.user.displayName}
                  </Text>
                  <Text size={12} style={{ color: N.muted }} numberOfLines={2}>
                    {b.by ? `By ${firstName(b.by.displayName, b.by.username)}` : 'Banned'} · {timeAgo(b.createdAt)}
                    {b.reason ? ` · ${b.reason}` : ''}
                  </Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel={`Unban ${b.user.displayName}`} onPress={() => void unban(b)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: N.edge2, justifyContent: 'center' }}>
                  <Text size={13} weight="bold">
                    Unban
                  </Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : (
          <Text size={14} style={{ color: N.muted }}>
            Nobody's banned.
          </Text>
        )
      ) : null}
      {c.me.owner ? (
        <>
          <Caps style={{ marginTop: 8 }}>Ownership</Caps>
          <Card>
            <Pressable accessibilityRole="button" onPress={() => void transfer()} style={{ minHeight: 60, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Glyph name="crown" size={18} color={roleColor(topRole(c, meId))} />
              <View style={{ flex: 1, paddingVertical: 8 }}>
                <Text size={15}>Transfer ownership</Text>
                <Text size={12} style={{ color: N.muted }}>
                  Pick someone. You become an Admin.
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={N.faint} />
            </Pressable>
          </Card>
        </>
      ) : null}
    </SettingsScreen>
  )
}

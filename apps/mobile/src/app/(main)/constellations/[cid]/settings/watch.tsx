import { useCallback, useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { router, useLocalSearchParams, type Href } from 'expo-router'
import { VERIFICATION_LEVELS, type NightWatch } from '@glofly/shared'
import { nightWatch } from '@/api/nightwatch'
import { cxSay, useCx } from '@/state/constellations'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Chip, ChipRow, Glyph, N, NightButton } from '@/constellations/ui'
import { haptic } from '@/constellations/motion'
import { ago, metaOf, TONE, titleOf } from '@/constellations/nightwatch'

// Communities round 2: Night watch on a phone (approved board 1e, left): the queue for moderators.
// Tapping an item opens it (watch-item) with one-tap actions. Safety is set up on a computer.

type Tab = 'all' | 'report' | 'held' | 'appeal'

export default function NightWatchScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [data, setData] = useState<NightWatch | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    void nightWatch.dashboard(cid).then((r) => (r.ok ? setData(r.data) : cxSay(r.message)))
  }, [cid])
  useEffect(load, [load])
  // Live: a new report, held message or appeal (the server bunches these).
  const tick = useCx((s) => s.watchTick[cid] ?? 0)
  useEffect(() => {
    if (tick) load()
  }, [tick, load])

  if (!data) {
    return (
      <SettingsScreen title="Night watch" c={c}>
        <Spinner />
      </SettingsScreen>
    )
  }
  const n = data.counts
  const items = data.queue.filter((q) => tab === 'all' || q.kind === tab)
  const paused = data.raid.pausedUntil
  return (
    <SettingsScreen title="Night watch" c={c}>
      {paused ? (
        <View accessibilityLiveRegion="polite" style={{ padding: 14, borderRadius: 16, backgroundColor: '#2a1406', gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Glyph name="lock" size={18} color={N.amber} />
            <Text size={14} style={{ flex: 1 }}>
              <Text size={14} weight="bold">Joins paused.</Text> They reopen at {new Date(paused).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
              {data.raid.heldJoiners ? ` ${data.raid.heldJoiners} raid joiners wait for a look.` : ''}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {data.raid.heldJoiners && data.can.timeout ? (
              <NightButton
                label="Let them talk"
                kind="outline"
                height={38}
                busy={busy}
                onPress={async () => {
                  setBusy(true)
                  const r = await nightWatch.raidClear(cid)
                  setBusy(false)
                  if (!r.ok) return cxSay(r.message)
                  load()
                }}
              />
            ) : null}
            {data.can.safety || data.can.ban ? (
              <NightButton
                label="Reopen joins"
                height={38}
                busy={busy}
                onPress={async () => {
                  setBusy(true)
                  const r = await nightWatch.reopenJoins(cid)
                  setBusy(false)
                  if (!r.ok) return cxSay(r.message)
                  haptic.success()
                  load()
                }}
              />
            ) : null}
          </View>
        </View>
      ) : (
        <View accessibilityRole="text" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: '#13261c', borderWidth: 1, borderColor: '#23503a' }}>
          <Glyph name="shield" size={16} color={N.greenText} />
          <Text size={13} style={{ flex: 1 }}>
            All calm · Verification {VERIFICATION_LEVELS.find((l) => l.id === data.safety.verification)?.name}
          </Text>
        </View>
      )}
      <ChipRow inset={16}>
        {(
          [
            ['all', `Needs a look ${n.reports + n.held + n.appeals}`],
            ['report', `Reports ${n.reports}`],
            ['held', `Held ${n.held}`],
            ...(data.can.ban ? [['appeal', `Appeals ${n.appeals}`]] : []),
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <Chip key={id} label={label} on={tab === id} onPress={() => setTab(id)} />
        ))}
      </ChipRow>
      {items.length === 0 ? (
        <Text size={14} style={{ color: N.muted, paddingVertical: 12 }}>
          Nothing waiting. Reports and messages AutoMod holds show up here.
        </Text>
      ) : null}
      <View style={{ gap: 8 }}>
        {items.map((q) => (
          <Pressable
            key={`${q.kind}:${q.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${titleOf(q)}. ${metaOf(q)}`}
            onPress={() => router.push(`/constellations/${cid}/settings/watch-item?kind=${q.kind}&id=${q.id}` as Href)}
            style={({ pressed }) => ({ padding: 12, borderRadius: 14, backgroundColor: pressed ? N.card2 : '#1c1512', borderWidth: 1, borderColor: '#2f241e', gap: 6 })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 24, height: 24, borderRadius: 7, backgroundColor: TONE[q.kind === 'held' && q.reason === 'mentions' ? 'mentions' : q.kind], alignItems: 'center', justifyContent: 'center' }}>
                {q.kind === 'report' ? <Icon name="flag" size={13} color="#fff" /> : q.kind === 'appeal' ? <Icon name="mail" size={13} color="#fff" /> : <Glyph name="shield" size={13} color="#fff" />}
              </View>
              <Text size={14} weight="bold" style={{ flex: 1 }} numberOfLines={1}>
                {titleOf(q)}
              </Text>
              <Text size={11.5} style={{ color: N.muted }}>
                {ago(q.createdAt)}
              </Text>
            </View>
            <Text size={12.5} style={{ color: N.muted }} numberOfLines={2}>
              {metaOf(q)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text size={12} style={{ color: N.faint }}>
        Safety and AutoMod are set up on a computer or chat.glofly.app.
      </Text>
    </SettingsScreen>
  )
}

import { useEffect, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { api, type ConstellationRow, type ConstellationStatus } from '@control/api'
import { Card, Chip, Muted, Pill, Row, Screen, Status, Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { c, font } from '@/ui/theme'
import { flagsFor, tileColor } from '@/lib/labels'
import { useLoad } from '@/lib/hooks'

// Constellations (Constellations.dc.html): search, filter chips, totals, and a list with chips.

const FILTERS: { id: ConstellationStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reports', label: 'Has reports' },
  { id: 'growing', label: 'Growing' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'taken_down', label: 'Taken down' },
]

export default function Constellations() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ConstellationStatus>('all')
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.constellations(query, status), [query, status])
  const totals = data?.totals

  return (
    <Screen title="Constellations" onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderWidth: 1, borderColor: c.fieldBorder, borderRadius: 12, backgroundColor: c.card }}>
        <Icon name="search" size={16} color={c.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Name, owner or invite link"
          placeholderTextColor="#a8968a"
          accessibilityLabel="Search constellations"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ flex: 1, fontFamily: font.body, fontSize: 15, color: c.ink, height: 44 }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }} style={{ marginHorizontal: -16 }}>
        {FILTERS.map((f) => (
          <Pill key={f.id} label={f.label} on={status === f.id} onPress={() => setStatus(f.id)} />
        ))}
      </ScrollView>

      {totals ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {[
            [totals.constellations, 'Constellations'],
            [totals.nebulas, 'Nebulas'],
            [totals.voiceLive, 'Voice rooms live'],
          ].map(([n, label]) => (
            <View key={String(label)} accessible accessibilityLabel={`${label}: ${n}`} style={{ flex: 1, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12 }}>
              <Text display weight="bold" size={20}>
                {Number(n).toLocaleString('en-US')}
              </Text>
              <Muted size={12}>{label}</Muted>
            </View>
          ))}
        </View>
      ) : null}

      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {data ? (
        data.constellations.length ? (
          <Card pad={12}>
            {data.constellations.map((r, i) => (
              <ConstellationListRow key={r.id} r={r} first={i === 0} />
            ))}
          </Card>
        ) : (
          <Status empty={query ? `Nothing matches “${query}”.` : 'No constellations here.'} />
        )
      ) : null}
      {data?.hasMore ? <Muted style={{ textAlign: 'center' }}>Showing the biggest 50. Search to find others.</Muted> : null}
    </Screen>
  )
}

function ConstellationListRow({ r, first }: { r: ConstellationRow; first: boolean }) {
  const flags = flagsFor(r)
  return (
    <Row
      first={first}
      minHeight={64}
      chevron={false}
      onPress={() => router.push(`/constellation/${r.id}`)}
      left={
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tileColor(r.id), alignItems: 'center', justifyContent: 'center', opacity: r.takenDownAt ? 0.5 : 1 }}>
          <Text display weight="bold" size={16} color={c.white} maxFontSizeMultiplier={1.2}>
            {[...r.name.trim()][0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
      }
      title={r.name}
      sub={`@${r.owner.username} · ${r.memberCount.toLocaleString('en-US')} member${r.memberCount === 1 ? '' : 's'}${r.nebulaCount !== undefined ? ` · ${r.nebulaCount} nebula${r.nebulaCount === 1 ? '' : 's'}` : ''}`}
      right={
        flags.length ? (
          <View style={{ gap: 4, alignItems: 'flex-end' }}>
            {flags.slice(0, 2).map(([label, tone]) => (
              <Chip key={label} small label={label} tone={tone} />
            ))}
          </View>
        ) : null
      }
    />
  )
}

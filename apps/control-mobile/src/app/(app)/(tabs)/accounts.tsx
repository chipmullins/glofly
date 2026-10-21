import { useEffect, useState } from 'react'
import { ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { api, type Filter } from '@control/api'
import { ago } from '@control/format'
import { Avatar, Card, Chip, Muted, Pill, Row, Screen, Status } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { c, font } from '@/ui/theme'
import { STATUS_CHIP } from '@/lib/labels'
import { useLoad } from '@/lib/hooks'

// Accounts: search + filter chips; tap one for the account page.

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'invited', label: 'Invited' },
  { id: 'unconfirmed', label: 'Email not confirmed' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'deleting', label: 'Being deleted' },
]

export default function Accounts() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.accounts(query, filter), [query, filter])

  return (
    <Screen title="Accounts" onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderWidth: 1, borderColor: c.fieldBorder, borderRadius: 12, backgroundColor: c.card }}>
        <Icon name="search" size={16} color={c.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Username, name or email"
          placeholderTextColor="#a8968a"
          accessibilityLabel="Search accounts"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={{ flex: 1, fontFamily: font.body, fontSize: 15, color: c.ink, height: 44 }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginHorizontal: -16 }} contentInset={{ left: 16, right: 16 }} contentOffset={{ x: -16, y: 0 }}>
        {FILTERS.map((f) => (
          <Pill key={f.id} label={data?.counts[f.id] !== undefined && f.id !== 'all' ? `${f.label} · ${data.counts[f.id]}` : f.label} on={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </ScrollView>
      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {data ? (
        data.accounts.length || data.invites.length ? (
          <Card style={{ paddingHorizontal: 12 }}>
            {data.invites.map((inv, i) => (
              <Row
                key={inv.id}
                first={i === 0}
                left={<Avatar id={inv.id} name={inv.displayName} size={40} />}
                title={`@${inv.username}`}
                sub={`Invited ${ago(inv.sentAt)} · ${inv.email}`}
                right={<Chip small label={inv.status === 'expired' ? 'Invite expired' : inv.status === 'pending' ? 'Invited' : inv.status} tone={inv.status === 'expired' ? 'off' : 'hot'} />}
                chevron={false}
                minHeight={62}
              />
            ))}
            {data.accounts.map((a, i) => {
              const chip = STATUS_CHIP[a.status]
              return (
                <Row
                  key={a.id}
                  first={i === 0 && !data.invites.length}
                  left={<Avatar id={a.id} name={a.displayName || a.username} size={40} online={a.online} ring={c.card} />}
                  title={a.displayName || `@${a.username}`}
                  sub={`@${a.username} · ${a.online ? 'online now' : a.lastSeenAt ? `seen ${ago(a.lastSeenAt)}` : `joined ${ago(a.createdAt)}`}`}
                  right={chip ? <Chip small label={chip[0]} tone={chip[1]} /> : a.isAdmin ? <Chip small label="Admin" tone="hot" /> : a.restricted ? <Chip small label="Family" tone="frozen" /> : null}
                  onPress={() => router.push(`/account/${a.id}`)}
                  minHeight={62}
                />
              )
            })}
          </Card>
        ) : (
          <Status empty={query ? `No one matches “${query}”.` : 'No accounts here.'} />
        )
      ) : null}
      {data?.more ? <Muted style={{ textAlign: 'center' }}>Showing the first matches. Search to narrow it down.</Muted> : null}
    </Screen>
  )
}

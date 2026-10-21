import { useEffect, useState } from 'react'
import { TextInput, View } from 'react-native'
import { api, type AuditEntry } from '@control/api'
import { when } from '@control/format'
import { Button, Card, Muted, Screen, Status, Text } from '@/ui/kit'
import { Icon } from '@/ui/icons'
import { c, font } from '@/ui/theme'
import { useLoad } from '@/lib/hooks'

// The audit log: everything done in Control (desktop and phone), read-only, with search.
export default function Audit() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [older, setOlder] = useState<AuditEntry[]>([])
  const [more, setMore] = useState<boolean | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 300)
    return () => clearTimeout(t)
  }, [q])
  const { data, error, loading, refreshing, refresh } = useLoad(() => api.audit(query), [query])
  useEffect(() => {
    setOlder([])
    setMore(null)
  }, [data])

  const entries = [...(data?.entries ?? []), ...older]
  const hasMore = more ?? data?.hasMore ?? false

  async function loadMore() {
    const last = entries[entries.length - 1]
    if (!last) return
    setLoadingMore(true)
    const r = await api.audit(query, last.createdAt)
    setLoadingMore(false)
    if (r.ok) {
      setOlder((o) => [...o, ...r.data.entries])
      setMore(r.data.hasMore)
    }
  }

  return (
    <Screen back title="Audit log" onRefresh={refresh} refreshing={refreshing}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderWidth: 1, borderColor: c.fieldBorder, borderRadius: 12, backgroundColor: c.card }}>
        <Icon name="search" size={16} color={c.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Action, account or note"
          placeholderTextColor="#a8968a"
          accessibilityLabel="Search the audit log"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={{ flex: 1, fontFamily: font.body, fontSize: 15, color: c.ink, height: 44 }}
        />
      </View>
      <Status loading={loading} error={!data ? error : null} onRetry={refresh} />
      {data && !entries.length ? <Status empty="Nothing found." /> : null}
      {entries.length ? (
        <Card style={{ paddingVertical: 2 }}>
          {entries.map((e, i) => (
            <View key={e.id} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.divider, gap: 2 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Text size={14} weight="semi" style={{ flex: 1 }}>
                  {e.action}
                  {e.targetLabel ? <Text size={14} color={c.muted}>{`  ${e.targetLabel}`}</Text> : null}
                </Text>
              </View>
              {e.note ? <Text size={13.5}>{e.note}</Text> : null}
              <Muted>{[when(e.createdAt), e.adminUsername ? `@${e.adminUsername}` : null, e.ip].filter(Boolean).join(' · ')}</Muted>
            </View>
          ))}
        </Card>
      ) : null}
      {hasMore ? <Button label="Show older" kind="secondary" height={46} busy={loadingMore} onPress={() => void loadMore()} /> : null}
    </Screen>
  )
}

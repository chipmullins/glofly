import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { SEARCH_HAS, attachmentSummary, highlightPieces, lastWeekday, searchWords, shortBody, type PublicUser, type SearchHas } from '@glofly/shared'
import { loadDetail, useCx } from '@/state/constellations'
import { useWide } from '@/lib/layout'
import { Spinner, Text } from '@/ui/kit'
import { community, requestJump, type CxSearchResult } from '@/constellations/communityTools'
import { haptic } from '@/constellations/motion'
import { Chip, ChipRow, Face, N, NightCenter, NightHeader, SearchBox, StarGlyph } from '@/constellations/ui'

// Search a whole constellation on phones (0.8.0, approved board 9): every nebula you can see,
// with from: / in: / has: / before: filters, results grouped by nebula. Tap one to jump there.

type Picker = 'from' | 'in' | 'has' | 'before' | null
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function beforeChoices(): { label: string; at: string }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const out = [{ label: 'Today', at: new Date(today.getTime() + 86_400_000).toISOString() }, { label: 'Yesterday', at: today.toISOString() }]
  for (let i = 2; i <= 6; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    out.push({ label: DAYS[d.getDay()], at: lastWeekday(d.getDay(), now).toISOString() })
  }
  return out
}

const whenLabel = (iso: string) => {
  const d = new Date(iso)
  return (Date.now() - d.getTime()) / 86_400_000 < 6
    ? d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ConstellationSearch() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useCx((s) => s.details[cid]) ?? null
  const wide = useWide()
  const [q, setQ] = useState('')
  const [from, setFrom] = useState<PublicUser | null>(null)
  const [inNebula, setIn] = useState<{ id: string; name: string } | null>(null)
  const [has, setHas] = useState<SearchHas | null>(null)
  const [before, setBefore] = useState<{ label: string; at: string } | null>(null)
  const [picker, setPicker] = useState<Picker>(null)
  const [results, setResults] = useState<CxSearchResult[] | null>(null)
  const [more, setMore] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (!c) void loadDetail(cid)
  }, [cid, c])

  const ready = q.trim().length >= 2 || !!from || !!has || !!inNebula
  const filters = useMemo(() => ({ q, from: from?.id ?? null, in: inNebula?.id ?? null, has, before: before?.at ?? null }), [q, from, inNebula, has, before])
  useEffect(() => {
    if (!ready) {
      setResults(null)
      setProblem(null)
      return
    }
    const n = ++seq.current
    const t = setTimeout(() => {
      setBusy(true)
      void community.search(cid, filters).then((r) => {
        if (n !== seq.current) return
        setBusy(false)
        if (r.ok) {
          setResults(r.data.results)
          setMore(r.data.hasMore)
          setProblem(null)
        } else setProblem(r.message)
      })
    }, 300)
    return () => clearTimeout(t)
  }, [cid, filters, ready])

  const words = useMemo(() => searchWords(q), [q])
  // One list: a heading row before each nebula's results
  const rows = useMemo(() => {
    const out: ({ kind: 'head'; key: string; name: string; count: number } | { kind: 'hit'; key: string; r: CxSearchResult })[] = []
    const groups = new Map<string, CxSearchResult[]>()
    for (const r of results ?? []) groups.set(r.nebula.id, [...(groups.get(r.nebula.id) ?? []), r])
    for (const [id, items] of groups) {
      out.push({ kind: 'head', key: `h:${id}`, name: items[0].nebula.name, count: items.length })
      for (const r of items) out.push({ kind: 'hit', key: r.message.id, r })
    }
    return out
  }, [results])

  if (!c) {
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        <NightCenter>
          <Spinner />
        </NightCenter>
      </View>
    )
  }

  const jump = (r: CxSearchResult) => {
    haptic.select()
    requestJump(r.nebula.id, r.message.id)
    if (wide) router.replace({ pathname: '/constellations/[cid]', params: { cid, nebula: r.nebula.id } })
    else router.replace({ pathname: '/constellations/[cid]/nebula/[nid]', params: { cid, nid: r.nebula.id } })
  }
  const nebulaCount = new Set((results ?? []).map((r) => r.nebula.id)).size
  const count = results?.length ?? 0
  const summary = problem ?? (!ready ? 'Type a word, or pick a filter.' : busy && !results ? 'Searching…' : `${count}${more ? '+' : ''} ${count === 1 ? 'message' : 'messages'} in ${nebulaCount} ${nebulaCount === 1 ? 'nebula' : 'nebulas'} · newest first`)
  const chip = (id: Exclude<Picker, null>, label: string, on: string | null, clear: () => void) => (
    <Chip key={id} label={on ? `✓ ${on}` : `+ ${label}`} on={!!on || picker === id} onPress={() => (on ? clear() : setPicker(picker === id ? null : id))} />
  )

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightHeader close title={<Text size={17} weight="bold" accessibilityRole="header">Search {c.name}</Text>} />
      <View style={{ paddingHorizontal: 16, gap: 10, paddingBottom: 8 }}>
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${c.name}`} focusRing autoFocus />
        <ChipRow inset={16}>
          {chip('from', 'from:', from ? `from: ${from.displayName.split(/\s+/)[0]}` : null, () => setFrom(null))}
          {chip('in', 'in:', inNebula ? `in: #${inNebula.name}` : null, () => setIn(null))}
          {chip('has', 'has:', has ? `has: ${has}` : null, () => setHas(null))}
          {chip('before', 'before:', before ? `before: ${before.label}` : null, () => setBefore(null))}
        </ChipRow>
        {picker ? (
          <View accessibilityRole="list" style={{ borderRadius: 16, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, padding: 6, maxHeight: 260 }}>
            <FlatList
              keyboardShouldPersistTaps="handled"
              data={
                picker === 'from'
                  ? c.members.map((m) => ({ key: m.user.id, label: m.user.displayName, pick: () => setFrom(m.user), user: m.user }))
                  : picker === 'in'
                    ? c.nebulas.filter((x) => x.kind === 'text').map((x) => ({ key: x.id, label: `# ${x.name}`, pick: () => setIn({ id: x.id, name: x.name }), user: null }))
                    : picker === 'has'
                      ? SEARCH_HAS.map((h) => ({ key: h.id, label: h.name, pick: () => setHas(h.id), user: null }))
                      : beforeChoices().map((b) => ({ key: b.label, label: b.label, pick: () => setBefore(b), user: null }))
              }
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    item.pick()
                    setPicker(null)
                  }}
                  style={{ minHeight: 44, paddingHorizontal: 10, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  {item.user ? <Face user={item.user} size={26} /> : null}
                  <Text size={15}>{item.label}</Text>
                </Pressable>
              )}
            />
          </View>
        ) : null}
        <Text size={13} style={{ color: N.muted }} accessibilityLiveRegion="polite">
          {summary}
        </Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(x) => x.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          const last = results?.at(-1)
          if (!more || !last) return
          void community.search(cid, filters, last.message.id).then((r) => {
            if (r.ok) {
              setResults((l) => [...(l ?? []), ...r.data.results])
              setMore(r.data.hasMore)
            }
          })
        }}
        ListEmptyComponent={
          ready && results && !busy ? (
            <Text size={14} style={{ color: N.muted, textAlign: 'center', paddingTop: 30 }}>
              {from || has || inNebula || before ? 'Nothing matches all those filters. Try removing one.' : 'Nothing found. Try other words.'}
            </Text>
          ) : null
        }
        renderItem={({ item }) =>
          item.kind === 'head' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 8 }}>
              <StarGlyph size={12} color={N.orange} />
              <Text size={12} weight="bold" style={{ color: N.muted, letterSpacing: 0.8 }}>
                {item.name.toUpperCase()} · {item.count} {item.count === 1 ? 'RESULT' : 'RESULTS'}
              </Text>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.r.sender?.displayName ?? 'Someone'}: ${shortBody(item.r.message.body)}. Jump to it`}
              onPress={() => jump(item.r)}
              style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 16, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2 }}
            >
              {item.r.sender ? <Face user={item.r.sender} size={32} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                  <Text size={14} weight="bold">
                    {(item.r.sender?.displayName ?? 'Someone').split(/\s+/)[0]}
                  </Text>
                  <Text size={12} style={{ color: N.muted }}>
                    {whenLabel(item.r.message.createdAt)}
                  </Text>
                </View>
                <Text size={14} style={{ lineHeight: 20 }}>
                  {highlightPieces(shortBody(item.r.message.body) || attachmentSummary(item.r.message.attachments), words).map((p, i) =>
                    p.hit ? (
                      <Text key={i} size={14} style={{ backgroundColor: '#ffe2b8', color: '#24170f' }}>
                        {p.text}
                      </Text>
                    ) : (
                      <Text key={i} size={14}>
                        {p.text}
                      </Text>
                    ),
                  )}
                </Text>
              </View>
              <Text size={12} weight="bold" style={{ color: N.amber, alignSelf: 'center' }}>
                Jump
              </Text>
            </Pressable>
          )
        }
      />
    </View>
  )
}

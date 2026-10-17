import { useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONSTELLATION_TYPES, VISIBILITY_LABELS, type ConstellationType, type DirectoryEntry } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { cxSay, putDetail, refreshCards } from '@/state/constellations'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Spinner, Text, webNoOutline } from '@/ui/kit'
import { font } from '@/ui/theme'
import { NightSky } from '@/constellations/sky'
import { AskToJoinSheet, JoinButton } from '@/constellations/CreateJoin'
import { haptic } from '@/constellations/motion'
import { ConstellationIcon, N } from '@/constellations/ui'

// The directory (canvas board 2, "Directory search"): search public constellations, narrow by
// kind and tag, "Open to join", and join or ask to join right from the list.

export default function DirectoryScreen() {
  const params = useLocalSearchParams<{ type?: string; tag?: string }>()
  const insets = useSafeAreaInsets()
  const [q, setQ] = useState('')
  const [type, setType] = useState<ConstellationType | null>(CONSTELLATION_TYPES.some((t) => t.id === params.type) ? (params.type as ConstellationType) : null)
  const [tag, setTag] = useState<string | null>(params.tag ?? null)
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<DirectoryEntry[] | null>(null)
  const [more, setMore] = useState(false)
  const [asking, setAsking] = useState<DirectoryEntry | null>(null)
  const gen = useRef(0)

  async function load(offset = 0) {
    const g = ++gen.current
    const r = await cx.directory(q, type, tag, offset)
    if (g !== gen.current) return
    if (!r.ok) return cxSay(r.message)
    setResults((old) => (offset ? [...(old ?? []), ...r.data.results] : r.data.results))
    setMore(r.data.hasMore)
  }
  useEffect(() => {
    const t = setTimeout(() => void load(0), q ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, type, tag])

  async function pickKind() {
    const pick = await chooseFrom([{ key: '', label: 'Any kind', checked: !type }, ...CONSTELLATION_TYPES.map((t) => ({ key: t.id, label: t.name, checked: type === t.id }))], 'Kind')
    if (pick !== null) setType((pick || null) as ConstellationType | null)
  }

  const replace = (e: DirectoryEntry) => setResults((l) => l?.map((x) => (x.id === e.id ? e : x)) ?? null)
  async function join(e: DirectoryEntry) {
    if (e.joined) return router.push({ pathname: '/constellations/[cid]', params: { cid: e.id } })
    if (e.visibility === 'approval') {
      if (e.requested) {
        const ok = await confirm({ title: 'Take back your request?', message: `You asked to join ${e.name}.`, confirmLabel: 'Take it back' })
        if (!ok) return
        const r = await cx.cancelRequest(e.id)
        if (!r.ok) return cxSay(r.message)
        return replace({ ...e, requested: false })
      }
      return setAsking(e)
    }
    const r = await cx.join(e.id)
    if (!r.ok) return cxSay(r.message)
    if ('constellation' in r.data && 'nebulas' in r.data.constellation) {
      haptic.success()
      putDetail(r.data.constellation)
      void refreshCards()
      replace({ ...e, joined: true })
      router.push({ pathname: '/constellations/[cid]', params: { cid: e.id } })
    }
  }

  const shown = (results ?? []).filter((e) => !open || (e.visibility === 'public' && !e.joined))
  const kindName = type ? CONSTELLATION_TYPES.find((t) => t.id === type)?.name : null

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky flies={1} />
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 18, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: N.card, borderWidth: 1.5, borderColor: N.amber, boxShadow: '0 0 16px rgba(255,165,74,0.2)' }}>
            <Icon name="search" size={16} color={N.muted} />
            <TextInput value={q} onChangeText={setQ} placeholder="Find a constellation" placeholderTextColor={N.muted} selectionColor={N.amber} autoFocus={!params.type && !params.tag} autoCorrect={false} returnKeyType="search" accessibilityLabel="Find a constellation" style={[{ flex: 1, height: 44, color: N.ink, fontFamily: font.body, fontSize: 15 }, webNoOutline]} />
            {q ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQ('')} hitSlop={10}>
                <Icon name="close" size={14} color={N.muted} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" onPress={() => (router.canGoBack() ? router.back() : router.replace('/constellations'))} style={{ height: 44, justifyContent: 'center' }}>
            <Text size={15} weight="bold" style={{ color: N.amber }}>
              Cancel
            </Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Kind: ${kindName ?? 'any'}. Change`} onPress={() => void pickKind()} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: kindName ? 0 : 1, borderColor: N.edge, backgroundColor: kindName ? N.amber : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text size={13} weight={kindName ? 'bold' : 'medium'} style={{ color: kindName ? N.amberInk : N.ink }}>
              {kindName ?? 'Any kind'}
            </Text>
            <Icon name="chevronDown" size={12} color={kindName ? N.amberInk : N.ink} />
          </Pressable>
          {tag ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Tag ${tag}. Remove`} onPress={() => setTag(null)} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: N.line2, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text size={13} weight="bold" style={{ color: N.tag }}>
                #{tag}
              </Text>
              <Icon name="close" size={12} color={N.tag} strokeWidth={2.4} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: open }} onPress={() => setOpen(!open)} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, borderWidth: open ? 0 : 1, borderColor: N.edge, backgroundColor: open ? N.amber : 'transparent', justifyContent: 'center' }}>
            <Text size={13} weight={open ? 'bold' : 'medium'} style={{ color: open ? N.amberInk : N.ink }}>
              Open to join
            </Text>
          </Pressable>
        </View>
        {results ? (
          <Text size={13} style={{ color: N.muted }} accessibilityLiveRegion="polite">
            {shown.length === 1 ? '1 constellation' : `${shown.length}${more ? '+' : ''} constellations`}
          </Text>
        ) : null}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(e) => e.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: insets.bottom + 40, gap: 10 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => more && results && void load(results.length)}
        ListEmptyComponent={
          results === null ? (
            <View style={{ padding: 32 }}>
              <Spinner />
            </View>
          ) : (
            <Text size={14} style={{ color: N.muted, textAlign: 'center', padding: 24 }}>
              Nothing found. Try another word, or make your own.
            </Text>
          )
        }
        renderItem={({ item: e }) => (
          <Pressable accessibilityLabel={`${e.name}. ${VISIBILITY_LABELS[e.visibility]?.name ?? ''}, ${e.memberCount} members, ${e.onlineCount} online. ${e.description ?? ''}`} style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2 }}>
            <ConstellationIcon c={e} size={48} radius={15} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text size={16} weight="bold" numberOfLines={1}>
                {e.name}
              </Text>
              <Text size={12} style={{ color: N.ink2 }}>
                {e.visibility === 'approval' ? 'Approval needed' : 'Public'} · {e.memberCount} {e.memberCount === 1 ? 'member' : 'members'}
                {e.onlineCount ? (
                  <Text size={12} style={{ color: N.greenText }}>
                    {' '}· {e.onlineCount} online
                  </Text>
                ) : null}
              </Text>
              {e.description ? (
                <Text size={13} numberOfLines={2} style={{ color: N.ink2, lineHeight: 18 }}>
                  {e.description}
                </Text>
              ) : null}
              {e.tags.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                  {e.tags.slice(0, 4).map((t) => (
                    <Pressable key={t} accessibilityRole="button" accessibilityLabel={`Tag ${t}`} onPress={() => setTag(t)} hitSlop={{ top: 6, bottom: 6 }} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: N.card2 }}>
                      <Text size={11} style={{ color: N.tag }}>
                        #{t}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
            <JoinButton entry={e} compact onPress={() => void join(e)} />
          </Pressable>
        )}
      />
      {asking ? (
        <AskToJoinSheet
          entry={asking}
          onClose={() => setAsking(null)}
          onSent={() => {
            replace({ ...asking, requested: true })
            setAsking(null)
            cxSay('Request sent. You’ll get in when a moderator lets you in.')
          }}
        />
      ) : null}
    </View>
  )
}

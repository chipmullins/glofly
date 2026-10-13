import { useEffect, useRef, useState } from 'react'
import { BackHandler, FlatList, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { clockTime, dayLabel, type Message, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { IconButton, Spinner, Text, webNoOutline } from '@/ui/kit'
import { font, useTheme } from '@/ui/theme'

// Search inside a chat (Oct 13), like the desktop app's search panel: type 2+ letters, results
// newest first with the matching words marked; tap one to jump to it in the chat.

/** The part of a long message around the match. */
function snippet(text: string, query: string): { before: string; match: string; after: string } {
  const flat = text.replace(/\s+/g, ' ')
  const q = query.trim()
  const at = flat.toLowerCase().indexOf(q.toLowerCase())
  if (at < 0) return { before: flat.slice(0, 120), match: '', after: '' }
  const start = Math.max(0, at - 36)
  const end = Math.min(flat.length, at + q.length + 70)
  return {
    before: (start > 0 ? '…' : '') + flat.slice(start, at),
    match: flat.slice(at, at + q.length),
    after: flat.slice(at + q.length, end) + (end < flat.length ? '…' : ''),
  }
}

export function SearchPanel({
  chatId,
  meId,
  people: known,
  onPick,
  onClose,
}: {
  chatId: string
  meId: string
  people: Record<string, PublicUser>
  onPick: (messageId: string) => void
  onClose: () => void
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[]>([])
  const [people, setPeople] = useState<Record<string, PublicUser>>({})
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const searchId = useRef(0)

  // Android's back gesture closes the search, not the chat.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [onClose])

  const remember = (list: PublicUser[]) => setPeople((map) => ({ ...map, ...Object.fromEntries(list.map((p) => [p.id, p])) }))

  // Search as you type (after a short pause).
  useEffect(() => {
    const q = query.trim()
    const id = ++searchId.current
    if (q.length < 2) {
      setResults([])
      setHasMore(false)
      setState('idle')
      return
    }
    const t = setTimeout(async () => {
      setState('searching')
      const r = await api.searchMessages(q, chatId)
      if (id !== searchId.current) return // a newer search started
      if (!r.ok) {
        setState('error')
        setError(r.message || "Couldn't search right now.")
        return
      }
      remember(r.data.people)
      setResults(r.data.results)
      setHasMore(r.data.hasMore)
      setState('done')
    }, 300)
    return () => clearTimeout(t)
  }, [query, chatId])

  async function more() {
    const last = results.at(-1)
    if (!last || loadingMore) return
    const id = searchId.current
    setLoadingMore(true)
    const r = await api.searchMessages(query.trim(), chatId, last.id)
    setLoadingMore(false)
    if (id !== searchId.current || !r.ok) return
    remember(r.data.people)
    setResults((list) => [...list, ...r.data.results.filter((m) => !list.some((x) => x.id === m.id))])
    setHasMore(r.data.hasMore)
  }

  const personOf = (uid: string): PublicUser | null => people[uid] ?? known[uid] ?? null
  const nameOf = (uid: string) => (uid === meId ? 'You' : (personOf(uid)?.displayName ?? 'Someone'))

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.bg }}>
      <View style={{ backgroundColor: c.barBg, borderBottomWidth: 0.5, borderBottomColor: c.line, paddingTop: insets.top }}>
        <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 }}>
          <IconButton name="back" label="Close search" onPress={onClose} color={c.ink} size={24} />
          <View style={{ flex: 1, height: 42, borderRadius: 21, backgroundColor: c.field, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8, marginRight: 8 }}>
            <Icon name="search" size={18} color={c.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              autoFocus
              autoCorrect={false}
              returnKeyType="search"
              placeholder="Search this chat"
              placeholderTextColor={c.faint}
              selectionColor={c.accent}
              accessibilityLabel="Search this chat"
              style={[{ flex: 1, color: c.ink, fontFamily: font.body, fontSize: 16, paddingVertical: 0 }, webNoOutline]}
            />
            {query ? <IconButton name="close" label="Clear" onPress={() => setQuery('')} size={18} box={32} color={c.muted} /> : null}
          </View>
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingVertical: 6, paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          state === 'searching' ? (
            <View style={{ padding: 20 }}>
              <Spinner />
            </View>
          ) : state === 'error' ? (
            <Text tone="danger" style={{ textAlign: 'center', padding: 20 }}>
              {error}
            </Text>
          ) : state === 'idle' ? (
            <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
              Type at least 2 letters to search the messages in this chat.
            </Text>
          ) : state === 'done' && results.length === 0 ? (
            <Text tone="muted" style={{ textAlign: 'center', padding: 24 }}>
              No messages with “{query.trim()}”.
            </Text>
          ) : null
        }
        renderItem={({ item: m }) => {
          const part = snippet(m.body ?? '', query)
          const who = personOf(m.senderId)
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${nameOf(m.senderId)}, ${dayLabel(m.createdAt)} ${clockTime(m.createdAt)}: ${m.body ?? ''}. Jump to message`}
              onPress={() => onPick(m.id)}
              style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: pressed ? c.surface : 'transparent' })}
            >
              {who ? <Avatar user={who} size={40} /> : <View style={{ width: 40 }} />}
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text size={15} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {nameOf(m.senderId)}
                  </Text>
                  <Text size={12} tone="faint">
                    {dayLabel(m.createdAt)} · {clockTime(m.createdAt)}
                  </Text>
                </View>
                <Text size={14} tone="muted" numberOfLines={3}>
                  {part.before}
                  <Text size={14} weight="bold" style={{ color: c.ink, backgroundColor: c.accentSoft }}>
                    {part.match}
                  </Text>
                  {part.after}
                </Text>
              </View>
            </Pressable>
          )
        }}
        ListFooterComponent={
          hasMore ? (
            <Pressable accessibilityRole="button" onPress={() => void more()} style={{ alignSelf: 'center', marginTop: 8, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: c.surface, justifyContent: 'center' }}>
              {loadingMore ? <Spinner /> : <Text size={14} weight="bold">Show more</Text>}
            </Pressable>
          ) : null
        }
      />
    </View>
  )
}

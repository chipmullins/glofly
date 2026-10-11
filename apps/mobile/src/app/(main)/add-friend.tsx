import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import type { SearchResult } from '@glofly/shared'
import * as api from '@/api/glofly'
import { refreshFriends } from '@/state/sync'
import { openDmWith } from '@/lib/chatActions'
import { Avatar } from '@/ui/Avatar'
import { Field, Notice, Spinner, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'

// Add friend: search by username or name, then send a request.

export default function AddFriend() {
  const { c } = useTheme()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim().replace(/^@/, '')
    if (q.length < 2) {
      setResults(null)
      return
    }
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await api.searchUsers(q)
      setLoading(false)
      setResults(r.ok ? r.data : [])
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  async function add(u: SearchResult) {
    setBusy(u.id)
    setNote(null)
    const r = await api.sendFriendRequest(u.username)
    setBusy(null)
    if (!r.ok) return setNote({ tone: 'danger', text: r.message })
    setNote({ tone: 'good', text: r.data.status === 'accepted' ? `You and ${u.displayName} are now friends.` : `Friend request sent to ${u.displayName}.` })
    setResults((list) => list?.map((x) => (x.id === u.id ? { ...x, relationship: r.data.status === 'accepted' ? 'friends' : 'outgoing' } : x)) ?? null)
    void refreshFriends()
  }

  return (
    <Screen title="Add friend" contentStyle={{ padding: 16, gap: 14 }}>
      <Field
        label="Username or name"
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        prefix="@"
        placeholder="their username"
        hint="Glofly usernames are unique, so that's the surest way to find someone."
      />
      {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
      {loading ? <Spinner /> : null}
      {results && !loading && results.length === 0 ? (
        <Text tone="muted" style={{ textAlign: 'center', padding: 16 }}>
          No one has that username.
        </Text>
      ) : null}
      {results?.map((u) => (
        <View key={u.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar user={u} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={16} weight="bold" numberOfLines={1}>
              {u.displayName}
            </Text>
            <Text size={13} tone="muted">
              @{u.username}
            </Text>
          </View>
          {u.relationship === 'friends' ? (
            <Pressable accessibilityRole="button" onPress={() => void openDmWith(u.id)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.surface, justifyContent: 'center' }}>
              <Text size={14} weight="bold">
                Message
              </Text>
            </Pressable>
          ) : u.relationship === 'outgoing' ? (
            <Text size={14} tone="muted">
              Request sent
            </Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={u.relationship === 'incoming' ? `Accept ${u.displayName}` : `Add ${u.displayName}`}
              onPress={() => void add(u)}
              disabled={busy === u.id}
              style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: c.accent, justifyContent: 'center' }}
            >
              <Text size={14} weight="bold" style={{ color: c.accentInk }}>
                {u.relationship === 'incoming' ? 'Accept' : 'Add'}
              </Text>
            </Pressable>
          )}
        </View>
      ))}
    </Screen>
  )
}

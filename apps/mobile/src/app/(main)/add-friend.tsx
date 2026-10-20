import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import type { SearchResult } from '@glofly/shared'
import * as api from '@/api/glofly'
import { refreshFriends } from '@/state/sync'
import { openDmWith } from '@/lib/chatActions'
import { Avatar } from '@/ui/Avatar'
import { Button, Field, Notice, Spinner, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'
import { useSession } from '@/state/session'

// Add friend: search by username or name, then send a request. Below: "Invite your friends"
// (0.3.0) emails someone a link to join Glofly; joining from it makes you friends right away.

export default function AddFriend() {
  const { c } = useTheme()
  // 0.7.5: "Find @name" from an empty search opens this with the name typed.
  const params = useLocalSearchParams<{ q?: string }>()
  const [query, setQuery] = useState(() => (typeof params.q === 'string' ? params.q : ''))
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const restricted = useSession((s) => s.user?.restricted === true)

  useEffect(() => {
    const q = query.trim().replace(/^@/, '')
    if (q.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    setLoading(true)
    // An older search answering after a newer one was typed is thrown away (it used to replace
    // the newer results and switch the spinner off while the newer one was still loading).
    let live = true
    const t = setTimeout(async () => {
      const r = await api.searchUsers(q)
      if (!live) return
      setLoading(false)
      setResults(r.ok ? r.data : [])
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
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

  // A restricted (family-managed) account: their family adds friends (Glofly Control).
  if (restricted) {
    return (
      <Screen title="Add friend" contentStyle={{ padding: 16, gap: 14 }}>
        <Notice tone="info">Your account is managed by your family, so they add your friends for you.</Notice>
      </Screen>
    )
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
      <InviteFriends />
    </Screen>
  )
}

/**
 * "Invite your friends": Glofly emails them an invite from you. An address that already has an
 * account gets a different email; this always just says "Invite sent" (nobody learns who's on Glofly).
 */
function InviteFriends() {
  const { c } = useTheme()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'good' | 'danger'; text: string } | null>(null)

  async function send() {
    const address = email.trim()
    if (!address || busy) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setNote({ tone: 'danger', text: 'Enter a valid email address.' })
    setBusy(true)
    setNote(null)
    const r = await api.inviteFriend(address)
    setBusy(false)
    if (!r.ok) return setNote({ tone: 'danger', text: r.message })
    setNote({ tone: 'good', text: `Invite sent to ${address}.` })
    setEmail('')
  }

  return (
    <View style={{ marginTop: 10, padding: 16, gap: 12, borderRadius: 20, backgroundColor: c.surface }}>
      <View style={{ gap: 2 }}>
        <Text display size={18}>
          Invite your friends
        </Text>
        <Text size={14} tone="muted" style={{ lineHeight: 19 }}>
          Not on Glofly yet? We'll email them an invite from you. When they join, you're friends.
        </Text>
      </View>
      <Field
        label="Their email"
        value={email}
        onChangeText={(t) => {
          setEmail(t)
          setNote(null)
        }}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        maxLength={320}
        placeholder="friend@example.com"
        returnKeyType="send"
        onSubmitEditing={() => void send()}
      />
      {note ? <Notice tone={note.tone}>{note.text}</Notice> : null}
      <Button label="Send invite" icon="send" busy={busy} disabled={!email.trim()} onPress={() => void send()} compact />
    </View>
  )
}

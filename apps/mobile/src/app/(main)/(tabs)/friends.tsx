import { useMemo, useState } from 'react'
import { Pressable, SectionList, TextInput, useWindowDimensions, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { onMobile, presenceLine, siteName, type FriendEntry } from '@glofly/shared'
import { useFriendsLive } from '@/state/friendsLive'
import { LivePill } from '@/ui/LivePill'
import * as api from '@/api/glofly'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { refreshFriends } from '@/state/sync'
import { openDmWith } from '@/lib/chatActions'
import { friendMenu } from '@/lib/friendActions'
import { startCallWith } from '@/calls/controller'
import { Avatar } from '@/ui/Avatar'
import { inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, IconButton, SectionLabel, Text, webNoOutline } from '@/ui/kit'
import { EmptyScene } from '@/ui/EmptyScene'
import { shareFriendLink } from '@/state/friendLink'
import { Skeleton } from '@/ui/Skeleton'
import { font, useTheme } from '@/ui/theme'
import { paneWidth, useWide } from '@/lib/layout'

type Filter = 'online' | 'all' | 'pending' | 'blocked'
type Row = { kind: 'friend' | 'incoming' | 'outgoing' | 'blocked'; entry: FriendEntry }

export default function Friends() {
  const { c } = useTheme()
  // 0.8.3: a narrow list (iPhone Duo's left pane, small iPhones) drops the Message button so names
  // have room; tapping a friend's row opens the chat anyway.
  const { width } = useWindowDimensions()
  const wide = useWide()
  const narrow = (wide ? paneWidth(width) : width) < 360
  const restricted = useSession((s) => s.user?.restricted === true)
  const insets = useSafeAreaInsets()
  const lists = useStore((s) => s.friends)
  const presence = useStore((s) => s.presence)
  const live = useFriendsLive((s) => s.live)
  const synced = useStore((s) => s.synced.friends)
  const [filter, setFilter] = useState<Filter>('online')
  const [query, setQuery] = useState('')

  const match = (f: FriendEntry) => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    return !q || f.displayName.toLowerCase().includes(q) || f.username.toLowerCase().includes(q)
  }

  const sections = useMemo(() => {
    const isOnline = (f: FriendEntry) => {
      const p = presence[f.id] ?? f.presence
      return !!p && p.status !== 'offline'
    }
    const byName = (a: FriendEntry, b: FriendEntry) => a.displayName.localeCompare(b.displayName)
    const friends = lists.friends.filter(match).sort(byName)
    const requests: Row[] = [...lists.incoming.filter(match).map((entry) => ({ kind: 'incoming' as const, entry })), ...lists.outgoing.filter(match).map((entry) => ({ kind: 'outgoing' as const, entry }))]
    const out: { title: string; data: Row[] }[] = []
    if (filter === 'pending') {
      if (requests.length) out.push({ title: `Friend requests · ${requests.length}`, data: requests })
      return out
    }
    if (filter === 'blocked') {
      const blocked = lists.blocked.filter(match).map((entry) => ({ kind: 'blocked' as const, entry }))
      if (blocked.length) out.push({ title: `Blocked · ${blocked.length}`, data: blocked })
      return out
    }
    if (lists.incoming.length && !query) out.push({ title: `Friend requests · ${lists.incoming.length}`, data: lists.incoming.map((entry) => ({ kind: 'incoming' as const, entry })) })
    const online = friends.filter(isOnline)
    const offline = friends.filter((f) => !isOnline(f))
    if (online.length) out.push({ title: `Online · ${online.length}`, data: online.map((entry) => ({ kind: 'friend' as const, entry })) })
    if (filter === 'all' && offline.length) out.push({ title: `Offline · ${offline.length}`, data: offline.map((entry) => ({ kind: 'friend' as const, entry })) })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, presence, filter, query])

  async function act(fn: () => Promise<{ ok: boolean; message?: string }>, failTitle: string) {
    const r = await fn()
    if (!r.ok) void inform(failTitle, r.message)
    void refreshFriends()
  }

  const chips: { key: Filter; label: string; badge?: number }[] = [
    { key: 'online', label: 'Online' },
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending', badge: lists.incoming.length },
    { key: 'blocked', label: 'Blocked' },
  ]

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text display size={28} style={{ flex: 1, marginLeft: 4 }} accessibilityRole="header">
            Friends
          </Text>
          {/* A restricted (family-managed) account: their family adds friends (Glofly Control). */}
          {restricted ? (
            <View style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: c.surface, justifyContent: 'center' }}>
              <Text size={12} tone="muted" weight="medium">
                Managed by your family
              </Text>
            </View>
          ) : (
            <IconButton name="addPerson" label="Add friend" onPress={() => router.push('/add-friend')} color={c.ink} />
          )}
        </View>
        <View accessibilityRole="tablist" accessibilityLabel="Friends filter" style={{ flexDirection: 'row', gap: 8 }}>
          {chips.map((chip) => {
            const on = filter === chip.key
            return (
              <Pressable
                key={chip.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setFilter(chip.key)}
                style={{ height: 36, paddingHorizontal: 14, borderRadius: 10, borderWidth: on ? 0 : 1, borderColor: c.fieldLine, backgroundColor: on ? c.accentSoft : 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6 }}
              >
                {on ? <Icon name="check" size={16} color={c.ink} strokeWidth={2.6} /> : null}
                <Text size={14} weight="medium">
                  {chip.label}
                </Text>
                {chip.badge ? (
                  <View style={{ minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, backgroundColor: c.dnd, alignItems: 'center', justifyContent: 'center' }}>
                    <Text size={11} weight="bold" style={{ color: '#FFFFFF' }}>
                      {chip.badge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            )
          })}
        </View>
        <View style={{ height: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, borderRadius: 24, backgroundColor: c.surface }}>
          <Icon name="search" size={20} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search friends"
            placeholderTextColor={c.muted}
            accessibilityLabel="Search friends"
            style={[{ flex: 1, height: 44, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
          />
        </View>
      </View>
      <SectionList
        sections={sections}
        keyExtractor={(r) => `${r.kind}-${r.entry.id}`}
        contentContainerStyle={{ paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <SectionLabel>{section.title}</SectionLabel>}
        ListEmptyComponent={
          !synced && !lists.friends.length && !query ? (
            <Skeleton kind="friends" />
          ) : (
          query.trim() ? (
            // 0.7.5: a search that finds no friend offers to look the name up on Glofly.
            <EmptyScene kind="search" small title={`No friend called “${query.trim()}”`} text={restricted ? 'Check the spelling. Your family adds new friends for you.' : 'Check the spelling, or look them up by their username to send a friend request.'}>
              {!restricted && /^@?[a-z0-9._-]{2,}$/i.test(query.trim()) ? (
                <Button compact label={`Find @${query.trim().replace(/^@/, '')}`} onPress={() => router.push({ pathname: '/add-friend', params: { q: query.trim().replace(/^@/, '') } })} />
              ) : null}
            </EmptyScene>
          ) : !lists.friends.length && filter !== 'blocked' && filter !== 'pending' ? (
            restricted ? (
              <EmptyScene kind="friends" title="No friends yet" text="Your family adds your friends for you. They’ll show up here." />
            ) : (
              <EmptyScene kind="friends" title="Every glow starts with one friend" text="Send your invite link. You’ll automatically be friends as soon as they join.">
                <Button compact label="Add a friend" icon="addPerson" onPress={() => router.push('/add-friend')} />
                <Button compact kind="secondary" label="Share your invite link" icon="share" onPress={() => void shareFriendLink().then((p) => void (p && inform("Couldn't share your link", p)))} />
              </EmptyScene>
            )
          ) : (
          <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
            <Icon name="friends" size={40} color={c.faint} />
            <Text display size={20}>
              {filter === 'pending' ? 'No requests' : filter === 'blocked' ? 'Nobody blocked' : 'Nobody online right now'}
            </Text>
          </View>
          )
          )
        }
        renderItem={({ item }) => {
          const f = item.entry
          const p = presence[f.id] ?? f.presence
          const first = f.displayName.split(/\s+/)[0]
          const stream = item.kind === 'friend' ? live[f.id] : undefined
          const sub =
            stream
              ? stream.title || `Live on ${siteName(stream.source)}`
              : item.kind === 'incoming'
              ? `@${f.username} · wants to be friends`
              : item.kind === 'outgoing'
                ? `@${f.username} · request sent`
                : item.kind === 'blocked'
                  ? `@${f.username}`
                  : presenceLine(p) || `@${f.username}`
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${f.displayName}, ${sub}`}
              onPress={() => (item.kind === 'friend' ? void openDmWith(f.id) : router.push({ pathname: '/profile/[id]', params: { id: f.id } }))}
              onLongPress={() => item.kind === 'friend' && void friendMenu(f)}
              android_ripple={{ color: c.line }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 16 }}
            >
              <Avatar user={f} size={48} status={item.kind === 'friend' ? (p?.status ?? 'offline') : null} mobile={onMobile(p ?? undefined)} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text size={16} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {f.displayName}
                  </Text>
                  {/* 0.9.3: live on Twitch or Kick */}
                  {stream ? <LivePill /> : null}
                </View>
                <Text size={13} tone="muted" numberOfLines={1}>
                  {sub}
                </Text>
              </View>
              {item.kind === 'friend' ? (
                <>
                  {narrow ? null : <IconButton name="chatsLine" label={`Message ${first}`} box={42} size={20} onPress={() => void openDmWith(f.id)} />}
                  <IconButton name="phone" label={`Call ${first}`} box={42} size={20} onPress={() => void startCallWith(f.id, false)} />
                  <IconButton name="more" label={`More options for ${first}`} box={36} size={20} onPress={() => void friendMenu(f)} />
                </>
              ) : item.kind === 'incoming' ? (
                <>
                  <IconButton name="close" label={`Decline ${first}'s request`} box={42} onPress={() => void act(() => api.removeFriendRequest(f.id), "Couldn't decline")} style={{ backgroundColor: c.surface, borderRadius: 21 }} />
                  <IconButton
                    name="check"
                    label={`Accept ${first}'s request`}
                    box={42}
                    color={c.accentInk}
                    onPress={() => void act(() => api.acceptFriendRequest(f.id), "Couldn't accept")}
                    style={{ backgroundColor: c.accent, borderRadius: 21 }}
                  />
                </>
              ) : item.kind === 'outgoing' ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`Cancel request to ${first}`} onPress={() => void act(() => api.removeFriendRequest(f.id), "Couldn't cancel")} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.surface, justifyContent: 'center' }}>
                  <Text size={14} weight="bold">
                    Cancel
                  </Text>
                </Pressable>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={`Unblock ${first}`} onPress={() => void act(() => api.unblockUser(f.id), "Couldn't unblock")} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.surface, justifyContent: 'center' }}>
                  <Text size={14} weight="bold">
                    Unblock
                  </Text>
                </Pressable>
              )}
            </Pressable>
          )
        }}
      />
    </View>
  )
}

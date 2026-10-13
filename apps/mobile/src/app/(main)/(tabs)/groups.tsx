import { useMemo, useState } from 'react'
import { FlatList, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { chatTitle, groupMatches, isMuted, memberCountLabel, mutedLabel, sortGroups, type GroupSummary } from '@glofly/shared'
import * as api from '@/api/glofly'
import { useStore, patchConversation } from '@/state/store'
import { useSession } from '@/state/session'
import { makeNameOf } from '@/lib/chats'
import { chooseMute, leaveGroup, openChat, setMute, setPinned } from '@/lib/chatActions'
import { useNow } from '@/lib/hooks'
import { joinCallIn } from '@/calls/controller'
import { ChatRow } from '@/ui/ChatRow'
import { chooseFrom, inform, type SheetItem } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text, webNoOutline } from '@/ui/kit'
import { Fab } from '@/ui/Fab'
import { font, useTheme } from '@/ui/theme'

export default function Groups() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const conversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.people)
  const presence = useStore((s) => s.presence)
  const typing = useStore((s) => s.typing)
  const calls = useStore((s) => s.calls)
  const [query, setQuery] = useState('')
  const now = useNow(4000)
  const nameOf = useMemo(() => makeNameOf(people), [people])
  const groups = useMemo(() => sortGroups(Object.values(conversations).filter((x): x is GroupSummary => x.kind === 'group')), [conversations])
  const shown = useMemo(() => groups.filter((g) => groupMatches(g, query)), [groups, query])

  const onlineCount = (g: GroupSummary) => g.members.filter((m) => presence[m.id] && presence[m.id].status !== 'offline').length + 1

  async function move(g: GroupSummary, by: -1 | 1) {
    const ids = groups.map((x) => x.id)
    const i = ids.indexOf(g.id)
    const j = i + by
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    ids.forEach((id, index) => patchConversation(id, { groupPosition: index }))
    const r = await api.orderGroups(ids)
    if (!r.ok) void inform("Couldn't move it", r.message)
  }

  async function menu(g: GroupSummary) {
    const muted = isMuted(g)
    const index = groups.findIndex((x) => x.id === g.id)
    const items: SheetItem[] = [
      g.pinnedAt ? { key: 'unpin', label: 'Unpin from Chats', icon: 'unpin' } : { key: 'pin', label: 'Pin to the top of Chats', icon: 'pin' },
      muted ? { key: 'unmute', label: 'Unmute', icon: 'bell', detail: g.mutedUntil ? mutedLabel(g.mutedUntil) : undefined } : { key: 'mute', label: 'Mute…', icon: 'bellOff' },
      ...(index > 0 ? [{ key: 'up', label: 'Move up', icon: 'arrowUp' as const }] : []),
      ...(index < groups.length - 1 ? [{ key: 'down', label: 'Move down', icon: 'arrowDown' as const }] : []),
      { key: 'settings', label: 'Group settings', icon: 'gear' },
      { key: 'leave', label: 'Leave group', icon: 'door', danger: true },
    ]
    const pick = await chooseFrom(items, chatTitle(g))
    if (pick === 'pin') void setPinned(g, true)
    else if (pick === 'unpin') void setPinned(g, false)
    else if (pick === 'mute') void chooseMute(g)
    else if (pick === 'unmute') void setMute(g, null)
    else if (pick === 'up') void move(g, -1)
    else if (pick === 'down') void move(g, 1)
    else if (pick === 'settings') router.push({ pathname: '/group/[id]', params: { id: g.id } })
    else if (pick === 'leave') void leaveGroup(g)
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 10 }}>
        <Text display size={28} style={{ marginHorizontal: 4, marginTop: 4 }} accessibilityRole="header">
          Groups
        </Text>
        <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, borderRadius: 28, backgroundColor: c.surface }}>
          <Icon name="search" size={22} color={c.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search groups or people in them"
            placeholderTextColor={c.muted}
            accessibilityLabel="Search groups"
            selectionColor={c.accent}
            style={[{ flex: 1, height: 48, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
          />
        </View>
      </View>
      <FlatList
        data={shown}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ padding: 32, alignItems: 'center', gap: 8 }}>
            <Icon name="groups" size={40} color={c.faint} />
            <Text display size={20}>
              {query ? 'No groups match' : 'No groups yet'}
            </Text>
            {!query ? (
              <Text tone="muted" style={{ textAlign: 'center' }}>
                Start one with two or more friends.
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item: g }) => (
          <ChatRow
            chat={g}
            meId={meId}
            nameOf={nameOf}
            typing={typing[g.id]}
            call={calls[g.id]}
            now={now}
            subtitle={`${memberCountLabel(g.memberCount)} · ${onlineCount(g)} online`}
            onPress={() => void openChat(g.id)}
            onLongPress={() => void menu(g)}
            onJoin={() => void joinCallIn(g.id, false)}
          />
        )}
      />
      <Fab label="Create group" icon="addPerson" onPress={() => router.push('/new-group')} />
    </View>
  )
}

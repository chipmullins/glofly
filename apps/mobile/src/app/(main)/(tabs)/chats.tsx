import { useMemo, useState } from 'react'
import { Animated, Pressable, RefreshControl, TextInput, View } from 'react-native'
// Gesture-handler's list: a row being dragged (pinned chats) stops the list scrolling under it.
import { FlatList } from 'react-native-gesture-handler'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { chatTitle, dotFor, findChats, onMobile, type ChatResult, type ConversationSummary } from '@glofly/shared'
import * as api from '@/api/glofly'
import { patchConversation, useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { refreshAll } from '@/state/sync'
import { chatSections, makeNameOf, pinTimesFor } from '@/lib/chats'
import { chatMenu, closeChat, openChat, openDmWith } from '@/lib/chatActions'
import { statusMenu } from '@/lib/status'
import { useListNow } from '@/lib/hooks'
import { joinCallIn } from '@/calls/controller'
import { Avatar, ChatAvatar } from '@/ui/Avatar'
import { ChatRow } from '@/ui/ChatRow'
import { Banners } from '@/ui/Banners'
import { SocialStrip } from '@/ui/Social'
import { Icon } from '@/ui/icons'
import { SectionLabel, Text, webNoOutline } from '@/ui/kit'
import { Skeleton } from '@/ui/Skeleton'
import { ReorderList, reorderActive } from '@/ui/Reorder'
import { inform } from '@/ui/dialogs'
import { Fab } from '@/ui/Fab'
import { font, useTheme } from '@/ui/theme'
import { ChatsNews } from '@/constellations/ChatsNews'

type Item = { type: 'label'; key: string; label: string } | { type: 'chat'; key: string; chat: ConversationSummary } | { type: 'result'; key: string; result: ChatResult }

export function SearchPill({ value, onChange, placeholder }: { value: string; onChange: (s: string) => void; placeholder: string }) {
  const { c } = useTheme()
  const user = useSession((s) => s.user)
  const myStatus = useStore((s) => s.myStatus)
  return (
    <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 4, paddingRight: 6, borderRadius: 28, backgroundColor: c.surface }}>
      <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        {value ? <Icon name="search" size={22} color={c.muted} /> : <Image source={require('../../../../assets/firefly.png')} style={{ width: 26, height: 19 }} contentFit="contain" />}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        accessibilityLabel={placeholder}
        selectionColor={c.accent}
        autoCorrect={false}
        style={[{ flex: 1, height: 48, color: c.ink, fontFamily: font.body, fontSize: 16 }, webNoOutline]}
        returnKeyType="search"
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChange('')} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={20} color={c.muted} />
        </Pressable>
      ) : user ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Your status: ${myStatus?.status ?? 'online'}`}
          onPress={() => void statusMenu()}
          style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
        >
          <Avatar user={user} size={34} status={dotFor(myStatus?.status ?? 'online')} ring={c.surface} />
        </Pressable>
      ) : null}
    </View>
  )
}

// The same functions for every row and render, so ChatRow (memo) only redraws rows that changed.
const pressChat = (chat: ConversationSummary) => void openChat(chat.id)
const holdChat = (chat: ConversationSummary) => !reorderActive() && void chatMenu(chat)
const joinChat = (chat: ConversationSummary) => void joinCallIn(chat.id, false)

export default function Chats() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const conversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.people)
  const presence = useStore((s) => s.presence)
  const typing = useStore((s) => s.typing)
  const calls = useStore((s) => s.calls)
  const friends = useStore((s) => s.friends.friends)
  const synced = useStore((s) => s.synced.conversations)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const now = useListNow(typing)
  const nameOf = useMemo(() => makeNameOf(people), [people])
  const all = useMemo(() => Object.values(conversations), [conversations])

  const items: Item[] = useMemo(() => {
    if (query.trim()) return findChats(query, all, friends).map((r) => ({ type: 'result', key: r.kind === 'group' ? r.conversation.id : r.user.id, result: r }))
    // Pinned chats are drawn above the list (ListHeaderComponent) so they can be dragged.
    const { pinned, chats } = chatSections(all)
    return [
      ...(pinned.length && chats.length ? [{ type: 'label' as const, key: 'l-chats', label: 'Chats' }] : []),
      ...chats.map((chat) => ({ type: 'chat' as const, key: chat.id, chat })),
    ]
  }, [all, friends, query])
  const pinned = useMemo(() => (query.trim() ? [] : chatSections(all).pinned), [all, query])

  async function reorderPins(ids: string[]) {
    const before = Object.fromEntries(pinned.map((p) => [p.id, p.pinnedAt]))
    for (const [id, at] of Object.entries(pinTimesFor(ids, all))) patchConversation(id, { pinnedAt: at })
    const r = await api.orderPins(ids)
    if (!r.ok) {
      for (const [id, at] of Object.entries(before)) patchConversation(id, { pinnedAt: at })
      void inform("Couldn't move it", r.message)
    }
  }

  const chatRow = (chat: ConversationSummary) => (
    <ChatRow
      chat={chat}
      meId={meId}
      nameOf={nameOf}
      presence={chat.kind === 'dm' ? presence[chat.partner.id] : undefined}
      typing={typing[chat.id]}
      call={calls[chat.id]}
      now={now}
      onPress={pressChat}
      onLongPress={holdChat}
      onJoin={joinChat}
    />
  )

  const loading = !synced && all.length === 0

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <SearchPill value={query} onChange={setQuery} placeholder="Find a friend or chat" />
      </View>
      {!query ? <Banners /> : null}
      {!query ? <SocialStrip /> : null}
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            colors={[c.accent]}
            progressBackgroundColor={c.surface}
            onRefresh={async () => {
              setRefreshing(true)
              try {
                await refreshAll()
              } finally {
                setRefreshing(false)
              }
            }}
          />
        }
        ListEmptyComponent={
          loading ? (
            <Skeleton kind="chats" />
          ) : pinned.length ? null : query ? (
            <Text tone="muted" style={{ textAlign: 'center', padding: 32 }}>
              No friends or chats match “{query.trim()}”.
            </Text>
          ) : (
            <View style={{ padding: 32, alignItems: 'center', gap: 10 }}>
              <Image source={require('../../../../assets/firefly.png')} style={{ width: 64, height: 47, opacity: 0.85 }} contentFit="contain" />
              <Text display size={20}>
                No chats yet
              </Text>
              <Text tone="muted" style={{ textAlign: 'center' }}>
                Start one with a friend, or add friends from the Friends tab.
              </Text>
            </View>
          )
        }
        ListHeaderComponent={
          query ? null : (
            <View>
              {/* 0.7.1: nebulas with news for you; a tap flies straight in */}
              <ChatsNews />
              {pinned.length ? (
                <View>
                  <SectionLabel>Pinned</SectionLabel>
                  {/* Hold a pinned chat and drag it to reorder; hold and let go for its menu. */}
                  <ReorderList
                    items={pinned}
                    keyOf={(x) => x.id}
                    renderItem={(chat) => <View style={{ backgroundColor: c.bg }}>{chatRow(chat)}</View>}
                    onReorder={(ids) => void reorderPins(ids)}
                    onHold={(chat) => void chatMenu(chat)}
                  />
                </View>
              ) : null}
            </View>
          )
        }
        renderItem={({ item }) => {
          if (item.type === 'label') return <SectionLabel>{item.label}</SectionLabel>
          if (item.type === 'chat') {
            const chat = item.chat
            // Swipe left to close a chat (pinned chats stay put: unpin first, like the menu).
            return chat.pinnedAt ? chatRow(chat) : <SwipeToClose onClose={() => void closeChat(chat)}>{chatRow(chat)}</SwipeToClose>
          }
          return <ResultRow result={item.result} onOpen={() => setQuery('')} />
        }}
      />
      <Fab label="New chat" icon="edit" onPress={() => router.push('/new-chat')} />
    </View>
  )
}

function ResultRow({ result, onOpen }: { result: ChatResult; onOpen: () => void }) {
  const { c } = useTheme()
  const presence = useStore((s) => (result.kind === 'person' ? s.presence[result.user.id] : undefined))
  const open = () => {
    onOpen()
    if (result.kind === 'group') void openChat(result.conversation.id)
    else if (result.conversation) void openChat(result.conversation.id)
    else void openDmWith(result.user.id)
  }
  return (
    <Pressable accessibilityRole="button" onPress={open} android_ripple={{ color: c.line }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 16 }}>
      {result.kind === 'group' ? <ChatAvatar chat={result.conversation} size={48} /> : <Avatar user={result.user} size={48} status={presence?.status ?? null} mobile={onMobile(presence ?? undefined)} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={16} weight="bold" numberOfLines={1}>
          {result.kind === 'group' ? chatTitle(result.conversation) : result.user.displayName}
        </Text>
        <Text size={13} tone="muted" numberOfLines={1}>
          {result.kind === 'group' ? `Group · ${result.conversation.memberCount} members` : `@${result.user.username}${result.conversation ? '' : ' · Start a chat'}`}
        </Text>
      </View>
    </Pressable>
  )
}

/** A chat row you can swipe left to close (hidden until a new message; nothing is deleted). */
function SwipeToClose({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const { c } = useTheme()
  return (
    <Swipeable
      friction={1.5}
      rightThreshold={72}
      overshootRight={false}
      onSwipeableOpen={(direction) => {
        if (direction === 'right') onClose()
      }}
      renderRightActions={(progress) => {
        const opacity = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.8, 1], extrapolate: 'clamp' })
        return (
          <Animated.View style={{ width: 96, opacity, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface2 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close chat" onPress={onClose} style={{ alignItems: 'center', justifyContent: 'center', gap: 4, width: 96, height: '100%' }}>
              <Icon name="close" size={22} color={c.ink2} />
              <Text size={12} weight="bold" tone="ink2">
                Close
              </Text>
            </Pressable>
          </Animated.View>
        )
      }}
      containerStyle={{ backgroundColor: c.surface2 }}
      childrenContainerStyle={{ backgroundColor: c.bg }}
    >
      {children}
    </Swipeable>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Pressable, RefreshControl, TextInput, View } from 'react-native'
// Gesture-handler's list: a row being dragged (pinned chats) stops the list scrolling under it.
import { FlatList } from 'react-native-gesture-handler'
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { router } from 'expo-router'
import { Image } from 'expo-image'
import Reanimated, { Easing, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { chatTitle, dotFor, findChats, matchScore, onMobile, type ChatResult, type ConstellationCard, type ConversationSummary, type Nebula } from '@glofly/shared'
import * as api from '@/api/glofly'
import { patchConversation, useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { refreshAll } from '@/state/sync'
import { bumpedToTop, chatSections, makeNameOf, pinTimesFor } from '@/lib/chats'
import { chatMenu, closeChat, openChat, openDmWith } from '@/lib/chatActions'
import { statusMenu } from '@/lib/status'
import { useListNow } from '@/lib/hooks'
import { joinCallIn } from '@/calls/controller'
import { Avatar, ChatAvatar } from '@/ui/Avatar'
import { ChatRow } from '@/ui/ChatRow'
import { Banners } from '@/ui/Banners'
import { SocialStrip } from '@/ui/Social'
import { Icon } from '@/ui/icons'
import { Button, SectionLabel, Text, webNoOutline } from '@/ui/kit'
import { EmptyScene } from '@/ui/EmptyScene'
import { Skeleton } from '@/ui/Skeleton'
import { ReorderList, reorderActive } from '@/ui/Reorder'
import { inform } from '@/ui/dialogs'
import { Fab } from '@/ui/Fab'
import { font, useTheme } from '@/ui/theme'
import { ChatsNews } from '@/constellations/ChatsNews'
import { useReduceMotionOn } from '@/ui/RowLife'
import { loadDetail, useCx, useCxAvailable } from '@/state/constellations'
import { flyIn } from '@/constellations/transition'
import { placePaths } from '@/constellations/nav'
import { ConstellationIcon, N } from '@/constellations/ui'
import { isWideNow } from '@/lib/layout'
import { PHONE_SETTINGS, type PhoneSettingsPlace } from '@/lib/quickPlaces'

type Item =
  | { type: 'label'; key: string; label: string }
  | { type: 'chat'; key: string; chat: ConversationSummary }
  | { type: 'result'; key: string; result: ChatResult }
  // 0.7.5: the search also finds constellations, their nebulas and settings (like Ctrl+K on desktop)
  | { type: 'cx'; key: string; card: ConstellationCard; nebula: Nebula | null }
  | { type: 'setting'; key: string; place: PhoneSettingsPlace }

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

// 0.7.5 "Life in the chat list": a chat bumped to the top glides there (320 ms, the approved
// spring with its tiny overshoot) and glows once. Nothing moves while the list is being scrolled,
// and nothing at all with Reduce Motion.
const GLIDE = LinearTransition.duration(320).easing(Easing.bezier(0.2, 0.9, 0.3, 1.15))
let glideOn = true
function GlideCell(props: React.ComponentProps<typeof View>) {
  return <Reanimated.View {...props} layout={glideOn ? GLIDE : undefined} />
}

// The same functions for every row and render, so ChatRow (memo) only redraws rows that changed.
const pressChat = (chat: ConversationSummary) => void openChat(chat.id)
const holdChat = (chat: ConversationSummary) => !reorderActive() && void chatMenu(chat)
const joinChat = (chat: ConversationSummary) => void joinCallIn(chat.id, false)

export default function Chats() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const restricted = useSession((s) => s.user?.restricted === true)
  const conversations = useStore((s) => s.conversations)
  const people = useStore((s) => s.people)
  const presence = useStore((s) => s.presence)
  const typing = useStore((s) => s.typing)
  const calls = useStore((s) => s.calls)
  const friends = useStore((s) => s.friends.friends)
  const synced = useStore((s) => s.synced.conversations)
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const cxOn = useCxAvailable()
  const cards = useCx((s) => s.cards)
  const details = useCx((s) => s.details)
  // Searching: each constellation's nebulas, so they can be found too (loaded once).
  const searching = query.trim().length > 0
  useEffect(() => {
    if (!searching || !cxOn) return
    for (const card of cards.slice(0, 20)) if (!useCx.getState().details[card.id]) void loadDetail(card.id)
  }, [searching, cxOn, cards])
  const now = useListNow(typing)
  const nameOf = useMemo(() => makeNameOf(people), [people])
  const all = useMemo(() => Object.values(conversations), [conversations])

  const items: Item[] = useMemo(() => {
    if (query.trim()) {
      const q = query.trim()
      const found: Item[] = findChats(query, all, friends).map((r) => ({ type: 'result', key: r.kind === 'group' ? r.conversation.id : r.user.id, result: r }))
      const cx: Item[] = []
      if (cxOn) {
        for (const card of cards) if (matchScore(q, card.name) > 0) cx.push({ type: 'cx', key: `cx:${card.id}`, card, nebula: null })
        for (const card of cards) {
          for (const n of details[card.id]?.nebulas ?? []) if (matchScore(q, n.name) > 0) cx.push({ type: 'cx', key: `nb:${n.id}`, card, nebula: n })
        }
      }
      const settings: Item[] = PHONE_SETTINGS.map((p) => ({ p, s: matchScore(q, p.name, p.keywords) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 4)
        .map(({ p }) => ({ type: 'setting', key: `set:${p.id}`, place: p }))
      return [
        ...found,
        ...(cx.length ? [{ type: 'label' as const, key: 'l-cx', label: 'Constellations' }, ...cx.slice(0, 6)] : []),
        ...(settings.length ? [{ type: 'label' as const, key: 'l-set', label: 'Settings' }, ...settings] : []),
      ]
    }
    // Pinned chats are drawn above the list (ListHeaderComponent) so they can be dragged.
    const { pinned, chats } = chatSections(all)
    return [
      ...(pinned.length && chats.length ? [{ type: 'label' as const, key: 'l-chats', label: 'Chats' }] : []),
      ...chats.map((chat) => ({ type: 'chat' as const, key: chat.id, chat })),
    ]
  }, [all, friends, query, cxOn, cards, details])
  const pinned = useMemo(() => (query.trim() ? [] : chatSections(all).pinned), [all, query])

  // 0.7.5: which chat just glows (one at a time), and whether the list is being scrolled.
  const reduceMotion = useReduceMotionOn()
  const scrolling = useRef(false)
  const scrollIdle = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [glow, setGlow] = useState<{ id: string; key: number } | null>(null)
  const order = useMemo(() => items.flatMap((i) => (i.type === 'chat' ? [i.key] : [])), [items])
  const lastOrder = useRef<string[] | null>(null)
  glideOn = !reduceMotion && !scrolling.current && !query
  useEffect(() => {
    const bumped = query ? null : bumpedToTop(lastOrder.current, order)
    lastOrder.current = order
    if (!bumped || scrolling.current || reduceMotion) return
    setGlow((g) => ({ id: bumped, key: (g?.key ?? 0) + 1 }))
  }, [order, query, reduceMotion])
  useEffect(() => {
    if (!glow) return
    const t = setTimeout(() => setGlow(null), 1700)
    return () => clearTimeout(t)
  }, [glow])
  useEffect(() => () => {
    if (scrollIdle.current) clearTimeout(scrollIdle.current)
  }, [])
  const scrollStart = () => {
    if (scrollIdle.current) clearTimeout(scrollIdle.current)
    scrolling.current = true
  }
  const scrollEnd = () => {
    if (scrollIdle.current) clearTimeout(scrollIdle.current)
    scrollIdle.current = setTimeout(() => {
      scrolling.current = false
    }, 600)
  }

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
      glowKey={glow?.id === chat.id ? glow.key : 0}
    />
  )

  const loading = !synced && all.length === 0

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <SearchPill value={query} onChange={setQuery} placeholder="Find a friend or chat" />
      </View>
      {!query ? <Banners /> : null}
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 }}
        CellRendererComponent={GlideCell}
        onScrollBeginDrag={scrollStart}
        onScrollEndDrag={scrollEnd}
        onMomentumScrollBegin={scrollStart}
        onMomentumScrollEnd={scrollEnd}
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
            <EmptyScene
              kind="search"
              small
              title={`No one called “${query.trim()}” here`}
              text="Check the spelling, or look them up by their username to send a friend request."
            >
              {!restricted && /^@?[a-z0-9._-]{2,}$/i.test(query.trim()) ? (
                <Button compact label={`Find @${query.trim().replace(/^@/, '')}`} onPress={() => router.push({ pathname: '/add-friend', params: { q: query.trim().replace(/^@/, '') } })} />
              ) : null}
            </EmptyScene>
          ) : (
            <EmptyScene kind="hello" title="No chats yet" text="Start one with a friend, or add friends from the Friends tab." />
          )
        }
        ListHeaderComponent={
          query ? null : (
            <View>
              {/* The faces row (Hang?, live, free to hang, birthdays) scrolls with the chats so rows never slide under it. */}
              <SocialStrip />
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
          if (item.type === 'cx') return <CxResultRow card={item.card} nebula={item.nebula} onOpen={() => setQuery('')} />
          if (item.type === 'setting') return <SettingResultRow place={item.place} onOpen={() => setQuery('')} />
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

/** 0.7.5 search: a constellation or one of its nebulas (a tap flies straight in). */
function CxResultRow({ card, nebula, onOpen }: { card: ConstellationCard; nebula: Nebula | null; onOpen: () => void }) {
  const { c } = useTheme()
  const open = () => {
    onOpen()
    flyIn(null, placePaths({ constellationId: card.id, nebulaId: nebula?.id ?? null }, isWideNow()))
  }
  const unread = nebula ? nebula.unreadCount : card.unreadCount
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={nebula ? `${nebula.kind === 'voice' ? 'Voice nebula' : 'Nebula'} ${nebula.name} in ${card.name}` : `Constellation ${card.name}`}
      onPress={open}
      android_ripple={{ color: c.line }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 16 }}
    >
      {nebula ? (
        <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: N.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={nebula.kind === 'voice' ? 'speaker' : 'sparkles'} size={20} color={N.amber} />
        </View>
      ) : (
        <ConstellationIcon c={card} size={48} radius={16} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={16} weight="bold" numberOfLines={1}>
          {nebula ? `${nebula.kind === 'text' ? '# ' : ''}${nebula.name}` : card.name}
        </Text>
        <Text size={13} tone="muted" numberOfLines={1}>
          {nebula ? `${nebula.kind === 'voice' ? 'Voice nebula' : 'Nebula'} in ${card.name}` : `Constellation · ${card.onlineCount} online`}
        </Text>
      </View>
      {unread > 0 ? (
        <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={12} weight="bold" style={{ color: '#FFFFFF' }}>
            {unread > 99 ? '99+' : unread} new
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

/** 0.7.5 search: a setting (opens the page it's on). */
function SettingResultRow({ place, onOpen }: { place: PhoneSettingsPlace; onOpen: () => void }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${place.where}`}
      onPress={() => {
        onOpen()
        router.push(place.href)
      }}
      android_ripple={{ color: c.line }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 16 }}
    >
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="gear" size={22} color={c.muted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={16} weight="bold" numberOfLines={1}>
          {place.name}
        </Text>
        <Text size={13} tone="muted" numberOfLines={1}>
          {place.where}
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

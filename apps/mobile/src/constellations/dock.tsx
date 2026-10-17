import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, Pressable, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { create } from 'zustand'
import {
  MESSAGE_MAX,
  chatTitle,
  continuesGroup,
  dayLabel,
  isMuted,
  isSameDay,
  mentionsMe,
  presenceHeader,
  type ConversationSummary,
  type FriendEntry,
  type Message,
} from '@glofly/shared'
import * as api from '@/api/glofly'
import { onLive, isAppActive } from '@/api/realtime'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { loadLatest, loadOlder, markChatRead } from '@/state/sync'
import { makeNameOf, previewOf } from '@/lib/chats'
import { listTime, firstName } from '@/lib/format'
import { openChat } from '@/lib/chatActions'
import { isWideNow } from '@/lib/layout'
import { sendText, setViewing } from '@/chat/send'
import { MessageRow, type RowInfo } from '@/chat/MessageRow'
import { chatOpened } from '@/push'
import { ChatAvatar } from '@/ui/Avatar'
import { FriendPicker } from '@/ui/FriendPicker'
import { Icon } from '@/ui/icons'
import { Text, webNoOutline } from '@/ui/kit'
import { ThemeOverride, font, useTheme } from '@/ui/theme'
import { useCx } from '@/state/constellations'
import { InlineSheet, NightModal, Handle } from './sheet'
import { flyHome, useNight } from './transition'
import { haptic } from './motion'
import { Glyph, OpenGloflyGlyph } from './ui'
import { NIGHT_TAB_HEIGHT } from './ui'

// The DM Dock on phones (board 8a): your Glofly chats without leaving the night. Swipe up on Home
// (or hold it, or tap the firefly in a nebula's header): chat heads peek up; keep pulling for All
// chats; a chat opens as a mini chat sheet. A DM that arrives while you're up there drops in as a
// peek banner with a quick reply. Drawn in Glofly's own dark colors, in every theme.

type DockState = {
  /** The dock: chat heads ('peek'), All chats ('full'), or iPad's All chats popover beside Home */
  dm: 'peek' | 'full' | 'popover' | null
  /** Opened from the tab bar (sits above it) */
  fromTab: boolean
  /** Mini chats open (up to 3), and the one showing */
  minis: string[]
  mini: string | null
  /** A message that just arrived (the peek banner) */
  peek: Message | null
  /** Picking a friend for a new message */
  picking: boolean
}

export const useDock = create<DockState>(() => ({ dm: null, fromTab: true, minis: [], mini: null, peek: null, picking: false }))

export function openDmDock(fromTab = true) {
  haptic.light()
  useDock.setState({ dm: isWideNow() ? 'popover' : 'peek', fromTab })
}
export const closeDock = () => useDock.setState({ dm: null })

export function openMini(id: string) {
  const minis = useDock.getState().minis.filter((m) => m !== id)
  useDock.setState({ minis: [id, ...minis].slice(0, 3), mini: id, dm: null, peek: null })
}

/** Back to Glofly with this chat open. */
function openFull(id: string) {
  useDock.setState({ dm: null, mini: null })
  flyHome(() => void openChat(id))
}

function useChats() {
  const conversations = useStore((s) => s.conversations)
  return useMemo(
    () =>
      Object.values(conversations)
        .filter((c) => !c.closedAt)
        .sort((a, b) => (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0) || b.activityAt.localeCompare(a.activityAt)),
    [conversations],
  )
}

// ───────────── The dock ─────────────

export function DmDock() {
  const dm = useDock((s) => s.dm)
  const fromTab = useDock((s) => s.fromTab)
  const mini = useDock((s) => s.mini)
  const picking = useDock((s) => s.picking)
  const insets = useSafeAreaInsets()
  return (
    <ThemeOverride mode="dark">
      <InlineSheet
        open={dm === 'peek'}
        onClose={closeDock}
        onPullUp={() => useDock.setState({ dm: 'full' })}
        bottom={fromTab ? NIGHT_TAB_HEIGHT + Math.max(insets.bottom, 10) + 10 : insets.bottom + 12}
        float
        backdrop="rgba(0,0,0,0.25)"
      >
        <ChatHeads />
      </InlineSheet>
      {dm === 'full' ? <AllChats onClose={closeDock} /> : null}
      {dm === 'popover' ? <DmPopover /> : null}
      {mini ? <MiniChat id={mini} /> : null}
      {picking ? <NewMessagePicker /> : null}
      <PeekBanner />
    </ThemeOverride>
  )
}

function ChatHeads() {
  const { c } = useTheme()
  const chats = useChats()
  const people = useStore((s) => s.people)
  const meId = useSession((s) => s.user?.id ?? '')
  const heads = chats.slice(0, 4)
  const nameOf = makeNameOf(people)
  return (
    <View style={{ borderRadius: 26, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, boxShadow: '0 -8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(247,137,58,0.12)', paddingTop: 8, paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
      <Handle width={36} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text display size={17} style={{ flex: 1 }} accessibilityRole="header">
          Your Glofly chats
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="New message" onPress={() => useDock.setState({ picking: true, dm: null })} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={18} color={c.accentText} strokeWidth={2.4} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {heads.map((chat) => {
          const unread = chat.unreadCount > 0 && !isMuted(chat)
          const title = chatTitle(chat)
          return (
            <Pressable key={chat.id} accessibilityRole="button" accessibilityLabel={`${title}${unread ? `, ${chat.unreadCount} unread` : ''}. ${previewOf(chat, meId, nameOf).text}`} onPress={() => openMini(chat.id)} style={{ width: 64, alignItems: 'center', gap: 6 }}>
              <View style={unread ? { borderRadius: 30, boxShadow: `0 0 0 2.5px ${c.accent}` } : undefined}>
                <ChatAvatar chat={chat} size={54} ring={c.bg} />
                {unread ? (
                  <View style={{ position: 'absolute', right: -3, top: -3, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, backgroundColor: c.accent, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Text size={10} weight="bold" style={{ color: c.accentInk }}>
                      {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text size={11} weight="medium" numberOfLines={1} style={{ color: unread ? c.ink : c.ink2 }}>
                {chat.kind === 'dm' ? firstName(chat.partner.displayName) : title}
              </Text>
            </Pressable>
          )
        })}
        <Pressable accessibilityRole="button" accessibilityLabel="All chats" onPress={() => useDock.setState({ dm: 'full' })} style={{ width: 64, alignItems: 'center', gap: 6 }}>
          <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="list" size={20} color={c.accentText} />
          </View>
          <Text size={11} weight="medium" style={{ color: c.ink2 }}>
            All chats
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

/** iPad: All chats in a popover beside Home in the strip (canvas "iPad voice stage"). */
function DmPopover() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}>
      <Pressable accessibilityLabel="Close" onPress={closeDock} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <Animated.View
        entering={FadeInUp.duration(160)}
        exiting={FadeOutUp.duration(120)}
        accessibilityViewIsModal
        style={{ position: 'absolute', left: 92, top: insets.top + 18, width: 340, height: Math.min(600, height - insets.top - 60), borderRadius: 22, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, boxShadow: '0 24px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(247,137,58,0.15)', padding: 14 }}
      >
        <View style={{ position: 'absolute', left: -7, top: 34, width: 12, height: 12, backgroundColor: c.bg, borderLeftWidth: 1, borderBottomWidth: 1, borderColor: c.line, transform: [{ rotate: '45deg' }] }} />
        <AllChats onClose={closeDock} popover />
      </Animated.View>
    </View>
  )
}

type Filter = 'all' | 'unread' | 'dms' | 'groups'

/** All chats (keep pulling): search, All / Unread / DMs / Groups, every chat. */
export function AllChats({ onClose, popover }: { onClose: () => void; popover?: boolean }) {
  const { c } = useTheme()
  const chats = useChats()
  const people = useStore((s) => s.people)
  const presence = useStore((s) => s.presence)
  const meId = useSession((s) => s.user?.id ?? '')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const nameOf = makeNameOf(people)
  const unreadCount = chats.filter((x) => x.unreadCount > 0 && !isMuted(x)).length
  const shown = chats.filter((x) => {
    if (filter === 'unread' && !(x.unreadCount > 0)) return false
    if (filter === 'dms' && x.kind !== 'dm') return false
    if (filter === 'groups' && x.kind !== 'group') return false
    const t = q.trim().toLowerCase()
    return !t || chatTitle(x).toLowerCase().includes(t)
  })
  const body = (
    <View style={{ flex: 1, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text display size={popover ? 18 : 22} style={{ flex: 1 }} accessibilityRole="header">
          All chats
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Glofly" onPress={() => { onClose(); flyHome() }} style={{ height: 44, paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <OpenGloflyGlyph />
          <Text size={13} weight="bold" style={{ color: c.accentText }}>
            Open Glofly
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="New message" onPress={() => useDock.setState({ picking: true, dm: null })} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={17} color={c.accentInk} strokeWidth={2.4} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: c.surface }}>
        <Icon name="search" size={16} color={c.muted} />
        <TextInput value={q} onChangeText={setQ} placeholder="Search chats" placeholderTextColor={c.muted} accessibilityLabel="Search chats" style={[{ flex: 1, color: c.ink, fontFamily: font.body, fontSize: 15, height: 42 }, webNoOutline]} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['all', 'All'],
            ['unread', unreadCount ? `Unread · ${unreadCount}` : 'Unread'],
            ['dms', 'DMs'],
            ['groups', 'Groups'],
          ] as const
        ).map(([id, label]) => {
          const on = filter === id
          return (
            <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFilter(id)} hitSlop={{ top: 6, bottom: 6 }} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: on ? c.accent : 'transparent', borderWidth: on ? 0 : 1, borderColor: c.line, justifyContent: 'center' }}>
              <Text size={13} weight={on ? 'bold' : 'medium'} style={{ color: on ? c.accentInk : c.ink }}>
                {label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <FlatList
        data={shown}
        keyExtractor={(x) => x.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text size={14} tone="muted" style={{ textAlign: 'center', padding: 24 }}>{q ? 'No chats match.' : 'No chats here.'}</Text>}
        renderItem={({ item }) => <ChatLine chat={item} meId={meId} nameOf={nameOf} status={item.kind === 'dm' ? (presence[item.partner.id]?.status ?? null) : null} onPress={() => openMini(item.id)} />}
      />
    </View>
  )
  if (popover) return body
  return (
    <NightModal onClose={onClose} top={64} bg={c.bg} edge={c.line} mode="dark" accessibilityLabel="All chats">
      {body}
    </NightModal>
  )
}

function ChatLine({ chat, meId, nameOf, status, onPress }: { chat: ConversationSummary; meId: string; nameOf: (id: string) => string; status: 'online' | 'away' | 'dnd' | 'offline' | null; onPress: () => void }) {
  const { c } = useTheme()
  const muted = isMuted(chat)
  const unread = chat.unreadCount > 0 && !muted
  const p = previewOf(chat, meId, nameOf)
  const title = chatTitle(chat)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}${unread ? `, ${chat.unreadCount} unread` : ''}${muted ? ', muted' : ''}. ${p.text}`} onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, opacity: muted ? 0.5 : 1, backgroundColor: pressed ? c.surface : 'transparent', borderRadius: 12 })}>
      <ChatAvatar chat={chat} size={48} status={status} ring={c.bg} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {chat.pinnedAt ? <Glyph name="pin" size={12} color={c.accentText} /> : null}
          <Text size={15} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {muted ? <Icon name="bellOff" size={13} color={c.muted} /> : null}
          <View style={{ flex: 1 }} />
          <Text size={12} weight={unread ? 'bold' : 'medium'} style={{ color: unread ? c.accentText : c.faint }}>
            {chat.lastMessage ? listTime(chat.lastMessage.createdAt) : ''}
          </Text>
        </View>
        <Text size={14} numberOfLines={1} style={{ marginTop: 2, color: unread ? c.ink : c.muted }}>
          {p.text}
        </Text>
      </View>
    </Pressable>
  )
}

// ───────────── New message ─────────────

function NewMessagePicker() {
  const { c } = useTheme()
  const close = () => useDock.setState({ picking: false })
  async function pick(f: FriendEntry) {
    const existing = Object.values(useStore.getState().conversations).find((x) => x.kind === 'dm' && x.partner.id === f.id)
    close()
    if (existing) return openMini(existing.id)
    const r = await api.openDm(f.id)
    if (!r.ok) return
    useStore.setState({ conversations: { ...useStore.getState().conversations, [r.data.id]: r.data } })
    openMini(r.data.id)
  }
  return (
    <NightModal onClose={close} top={120} bg={c.bg} edge={c.line} mode="dark" padded={false} accessibilityLabel="New message">
      <Text display size={20} style={{ paddingHorizontal: 18, paddingBottom: 10 }} accessibilityRole="header">
        New message
      </Text>
      <FriendPicker selected={[]} multi={false} onToggle={(f) => void pick(f)} />
    </NightModal>
  )
}

// ───────────── A mini chat ─────────────

function MiniChat({ id }: { id: string }) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const chat = useStore((s) => s.conversations[id])
  const messages = useStore((s) => s.messages[id])
  const people = useStore((s) => s.people)
  const presence = useStore((s) => (chat?.kind === 'dm' ? s.presence[chat.partner.id] : undefined))
  const minis = useDock((s) => s.minis)
  const meId = useSession((s) => s.user?.id ?? '')
  const me = useSession((s) => s.user)
  const [text, setText] = useState('')
  const close = () => useDock.setState({ mini: null })

  useEffect(() => {
    void loadLatest(id)
    setViewing(id)
    chatOpened(id)
    return () => setViewing(useCx.getState().viewing)
  }, [id])
  const unread = (chat?.unreadCount ?? 0) + (chat?.mentionCount ?? 0)
  useEffect(() => {
    if (unread > 0 && isAppActive()) void markChatRead(id)
  }, [id, unread])

  const isGroup = chat?.kind === 'group'
  const members = useMemo(() => (chat ? [...chat.members, ...(me ? [me] : [])] : []), [chat, me])
  const rows: RowInfo[] = useMemo(() => {
    const ms = (messages?.list ?? []).slice(-80)
    return ms
      .map((m, i) => {
        const prev = ms[i - 1]
        const next = ms[i + 1]
        return {
          message: m,
          joinedAbove: !!prev && !prev.event && !m.event && continuesGroup(prev, m),
          joinedBelow: !!next && !next.event && !m.event && continuesGroup(m, next),
          day: !prev || !isSameDay(prev.createdAt, m.createdAt) ? dayLabel(m.createdAt) : null,
          receipt: null,
          mentionsMe: isGroup && mentionsMe(m, meId) && m.senderId !== meId,
          outgoing: null,
        }
      })
      .reverse()
  }, [messages?.list, meId, isGroup])

  if (!chat) return null
  const title = chatTitle(chat)
  const send = () => {
    const body = text.trim()
    if (!body) return
    sendText(id, body, null)
    setText('')
  }
  const sheetTop = Math.min(296, Math.round(height * 0.35))
  return (
    <NightModal onClose={close} top={sheetTop} bg={c.bg} edge={c.line} mode="dark" padded={false} backdrop="rgba(5,3,2,0.4)" accessibilityLabel={`Chat with ${title}`}>
      {minis.length > 1 ? (
        <View style={{ position: 'absolute', top: -60, left: 16, flexDirection: 'row', gap: 8 }}>
          {minis.map((m) => {
            const mc = useStore.getState().conversations[m]
            if (!mc) return null
            return (
              <Pressable key={m} accessibilityRole="button" accessibilityLabel={chatTitle(mc)} onPress={() => useDock.setState({ mini: m })} style={{ borderRadius: 20, opacity: m === id ? 1 : 0.8, boxShadow: m === id ? `0 0 0 2.5px ${c.accent}` : undefined }}>
                <ChatAvatar chat={mc} size={36} ring={c.bg} />
              </Pressable>
            )
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.surface }}>
        <ChatAvatar chat={chat} size={38} status={presence?.status ?? null} ring={c.bg} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={16} weight="bold" numberOfLines={1}>
            {title}
          </Text>
          <Text size={12} numberOfLines={1} style={{ color: presence?.status === 'online' ? c.onlineText : c.muted }}>
            {isGroup ? `${chat.memberCount} members` : presenceHeader(presence)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open in Glofly" onPress={() => openFull(id)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Glyph name="external" size={17} color={c.ink2} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronDown" size={16} color={c.ink2} strokeWidth={2.2} />
        </Pressable>
      </View>
      <FlatList
        data={rows}
        inverted
        style={{ flex: 1 }}
        keyExtractor={(r) => r.message.id}
        contentContainerStyle={{ paddingVertical: 10 }}
        onEndReached={() => void loadOlder(id)}
        renderItem={({ item }) => (
          <MessageRow
            row={item}
            meId={meId}
            isGroup={isGroup}
            people={people}
            members={members}
            highlight={false}
            onLongPress={() => {}}
            onReact={() => {}}
            onQuotePress={() => {}}
            onRetry={() => {}}
            onAvatarPress={() => {}}
            onOpenPhoto={() => openFull(id)}
            canAct={chat.canMessage}
            memberIds={members.map((m) => m.id)}
          />
        )}
      />
      {chat.canMessage ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.surface }}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={`Message ${chat.kind === 'dm' ? firstName(chat.partner.displayName) : title}`}
            placeholderTextColor={c.muted}
            accessibilityLabel={`Message ${title}`}
            maxLength={MESSAGE_MAX}
            onSubmitEditing={send}
            returnKeyType="send"
            style={[{ flex: 1, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.surface, color: c.ink, fontFamily: font.body, fontSize: 15 }, webNoOutline]}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="send" size={18} color={c.accentInk} strokeWidth={2.2} />
          </Pressable>
        </View>
      ) : (
        <Text size={13} tone="muted" style={{ textAlign: 'center', padding: 12 }}>
          You can't send messages here.
        </Text>
      )}
      <View style={{ height: Math.max(0, insets.bottom - 8) }} />
    </NightModal>
  )
}

// ───────────── The peek banner ─────────────

/** Shows a DM or group message that arrives while you're in Constellations, with a quick reply. */
function PeekBanner() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const peek = useDock((s) => s.peek)
  const people = useStore((s) => s.people)
  const chat = useStore((s) => (peek ? s.conversations[peek.conversationId] : undefined))
  const [reply, setReply] = useState('')
  const [focused, setFocused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setReply('')
    if (timer.current) clearTimeout(timer.current)
    if (peek && !focused) timer.current = setTimeout(() => useDock.setState({ peek: null }), 7000)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [peek, focused])
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .onEnd((e) => {
      if (e.translationY < -30) useDock.setState({ peek: null })
      else if (e.translationY > 40 && peek) openMini(peek.conversationId)
    })
  if (!peek || !chat) return null
  const sender = people[peek.senderId]
  const title = chat.kind === 'group' ? `${sender?.displayName ?? 'Someone'} · ${chatTitle(chat)}` : (sender?.displayName ?? chatTitle(chat))
  const preview = previewOf({ ...chat, lastMessage: peek } as ConversationSummary, '', makeNameOf(people)).text.replace(/^[^:]+: /, '')
  const send = () => {
    const body = reply.trim()
    if (!body) return
    sendText(peek.conversationId, body, null)
    haptic.success()
    useDock.setState({ peek: null })
  }
  return (
    <Animated.View entering={FadeInUp.duration(220)} exiting={FadeOutUp.duration(180)} style={{ position: 'absolute', left: 8, right: 8, top: insets.top + 8, zIndex: 30 }}>
      <GestureDetector gesture={swipe}>
        <View accessibilityLiveRegion="polite" style={{ borderRadius: 24, backgroundColor: c.bg, borderWidth: 1, borderColor: c.line, boxShadow: '0 18px 44px rgba(0,0,0,0.65), 0 0 0 1px rgba(247,137,58,0.18)', padding: 12, gap: 10, maxWidth: 560, alignSelf: 'center', width: '100%' }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${preview}. Open the chat`} onPress={() => openMini(peek.conversationId)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <ChatAvatar chat={chat} size={40} ring={c.bg} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text size={15} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {title}
                </Text>
                <Text size={12} style={{ color: c.faint }}>
                  now · Glofly
                </Text>
              </View>
              <Text size={14} numberOfLines={2} style={{ color: '#E9D5C4', marginTop: 1 }}>
                {preview}
              </Text>
            </View>
          </Pressable>
          {chat.canMessage ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={reply}
                onChangeText={setReply}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder={`Reply to ${sender ? firstName(sender.displayName) : chatTitle(chat)}`}
                placeholderTextColor={c.muted}
                accessibilityLabel="Quick reply"
                onSubmitEditing={send}
                returnKeyType="send"
                maxLength={MESSAGE_MAX}
                style={[{ flex: 1, height: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: c.surface, borderWidth: 1, borderColor: focused ? c.accent : c.line, color: c.ink, fontFamily: font.body, fontSize: 15 }, webNoOutline]}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="send" size={18} color={c.accentInk} strokeWidth={2.2} />
              </Pressable>
            </View>
          ) : null}
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#574a41' }} />
        </View>
      </GestureDetector>
    </Animated.View>
  )
}

let peekStarted = false
/** Arriving chat messages become the peek banner while the night side is up (not muted ones). */
export function startPeeks() {
  if (peekStarted) return
  peekStarted = true
  onLive((event, payload) => {
    if (event !== 'message:new') return
    const { message, counts } = payload as { message: Message; counts: boolean }
    if (!counts || message.event || !isAppActive()) return
    if (useNight.getState().phase !== 'night') return
    const me = useSession.getState().user?.id ?? ''
    if (message.senderId === me) return
    const chat = useStore.getState().conversations[message.conversationId]
    if (!chat || (isMuted(chat) && !mentionsMe(message, me))) return
    if (useDock.getState().mini === message.conversationId) return
    useDock.setState({ peek: message })
  })
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') useDock.setState({ peek: null })
  })
}


import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { router, useFocusEffect, useIsFocused, useLocalSearchParams } from 'expo-router'
import { isWideNow, useWide } from '@/lib/layout'
import { placeOfChat } from '@/state/constellations'
import { flyIn } from '@/constellations/transition'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import {
  attachmentSummary,
  chatTitle,
  shortBody,
  clockTime,
  continuesGroup,
  dayLabel,
  isMuted,
  isSameDay,
  memberCountLabel,
  mentionsMe,
  onMobile,
  presenceHeader,
  type Message,
} from '@glofly/shared'
import * as api from '@/api/glofly'
import { isAppActive, sendTyping } from '@/api/realtime'
import { useStore, putMessage } from '@/state/store'
import { useSession } from '@/state/session'
import { loadLatest, loadOlder, loadUntil, markChatRead, refreshConversations, updateMessage } from '@/state/sync'
import { SearchPanel } from '@/chat/SearchPanel'
import { chatMenu } from '@/lib/chatActions'
import { firstName } from '@/lib/format'
import { useListNow } from '@/lib/hooks'
import { QUICK_REACTIONS } from '@/lib/emoji'
import { startCallIn, joinCallIn, moveCallHere, useCall } from '@/calls/controller'
import { RingSomeSheet } from '@/calls/RingSome'
import { JoinBar } from '@/calls/JoinBar'
import { useCallStripHeight } from '@/calls/CallOverlay'
import { Composer, type ComposerHandle } from '@/chat/Composer'
import { MessageRow, type RowInfo } from '@/chat/MessageRow'
import { TypingBubble } from '@/chat/TypingBubble'
import { discard, isLocal, retry, sendText, setViewing, useOutbox } from '@/chat/send'
import { tap } from '@/lib/haptics'
import { DayPill, useDayPill } from '@/chat/DayPill'
import { ReconnectingStrip } from '@/ui/Reconnecting'
import { chatOpened } from '@/push'
import { useKeyCommand } from '@/lib/keys'

import { attachMenu, UploadTray, useUploads } from '@/chat/uploads'
import { VoiceRecorderBar, RecordButton, useVoice } from '@/chat/voice'
import { PhotoViewer, type ViewerState } from '@/chat/PhotoViewer'
import { ChatFireflies, GAMES, GifSheet, LanternBar, PollSheet } from '@/chat/Extras'
import { BirthdayConfetti, GlowMark } from '@/ui/Social'
import { useSocial } from '@/state/social'
import { ChatAvatar } from '@/ui/Avatar'
import { BottomSheet, chooseFrom, confirm, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, IconButton, Spinner, Text } from '@/ui/kit'
import { EmptyScene } from '@/ui/EmptyScene'
import { Skeleton } from '@/ui/Skeleton'
import { JumpToLatestButton, useJumpToLatest } from '@/chat/JumpToLatest'
import { openReport, pickEmoji } from '@/ui/sheets'
import { useTheme } from '@/ui/theme'
import { markUnread, PinnedBar, PinsSheet, ScheduledSheet, ScheduledStrip, SendLaterSheet, usePins, useScheduled } from '@/chat/chatTools'

/** A GIF, poll or game: its text is only the plain version for older apps. */
const special = (m: Message) => !!(m.gif || m.poll || m.game)

// Row handlers that don't depend on the screen's state (the same functions every render).
const retryOrDiscard = async (m: Message) => {
  const pick = await chooseFrom([
    { key: 'retry', label: 'Try again', icon: 'refresh' },
    { key: 'discard', label: 'Delete it', icon: 'trash', danger: true },
  ])
  if (pick === 'retry') retry(m.id)
  if (pick === 'discard') discard(m.id)
}
const openProfile = (uid: string) => router.push({ pathname: '/profile/[id]', params: { id: uid } })

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const stripH = useCallStripHeight()
  const meId = useSession((s) => s.user?.id ?? '')
  const chat = useStore((s) => s.conversations[id])
  const messages = useStore((s) => s.messages[id])
  const people = useStore((s) => s.people)
  const presence = useStore((s) => (chat?.kind === 'dm' ? s.presence[chat.partner.id] : undefined))
  const allPresence = useStore((s) => s.presence)
  const typing = useStore((s) => s.typing[id])
  const call = useStore((s) => s.calls[id])
  // 0.7.3: a call is starting (e.g. the microphone prompt is up): Call can't be pressed again
  const startingCall = useCall((s) => s.connecting && !s.call)
  // 0.8.3: already in a call somewhere (the group's Join is then off)
  const inAnyCall = useCall((s) => !!s.call)
  // The call this phone is in (to tell "in it here" from "in it on another device")
  const callHereId = useCall((s) => s.call?.id ?? null)
  // 0.5.0: your glow with this friend, and their birthday.
  const partnerGlow = useSocial((s) => (chat?.kind === 'dm' ? s.glows[chat.partner.id] : undefined))
  const partnerBirthday = useSocial((s) => chat?.kind === 'dm' && s.birthdays.includes(chat.partner.id))
  const outbox = useOutbox((s) => s.items)
  const [reply, setReply] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [actionsFor, setActionsFor] = useState<Message | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  /** A message to scroll to once it's in the list (after loading older pages). */
  const [pendingJump, setPendingJump] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  // 0.5.0: GIFs, polls and lantern messages.
  const [gifOpen, setGifOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  /** Groups (0.5.2): picking who a new call rings */
  const [ringSome, setRingSome] = useState(false)
  const [lantern, setLantern] = useState(false)
  const [lanternFor, setLanternFor] = useState(id)
  if (lanternFor !== id) {
    setLanternFor(id)
    setLantern(false)
  }
  const composer = useRef<ComposerHandle>(null)
  const list = useRef<FlatList<RowInfo>>(null)
  const wide = useWide()
  // Ticks only while "typing…" can run out (it redrew the whole chat every 3 seconds).
  const now = useListNow(typing ? { [id]: typing } : {})
  const uploads = useUploads(id)
  // 0.7.3: pinned messages, send later
  const pinsApi = usePins(id)
  const scheduled = useScheduled(id)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [scheduledOpen, setScheduledOpen] = useState(false)
  const [laterText, setLaterText] = useState<string | null>(null)
  const voice = useVoice(id)

  // Load and keep it read while it's on screen.
  useEffect(() => {
    void loadLatest(id)
  }, [id])
  useFocusEffect(
    useCallback(() => {
      setViewing(id)
      chatOpened(id)
      return () => setViewing(null)
    }, [id]),
  )
  const unread = (chat?.unreadCount ?? 0) + (chat?.mentionCount ?? 0)
  useEffect(() => {
    if (unread > 0 && isAppActive()) void markChatRead(id)
  }, [id, unread])
  // Messages that came while Glofly was off screen count as unread; coming back to this chat
  // reads them (the unread count didn't change then, so the effect above didn't run).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || useStore.getState().viewing !== id) return
      const c = useStore.getState().conversations[id]
      if (c && (c.unreadCount > 0 || (c.mentionCount ?? 0) > 0)) void markChatRead(id)
    })
    return () => sub.remove()
  }, [id])
  // Not in the chats list (yet): opened from a notification before the list loaded, or it's
  // gone. Ask for the list once; if it's still not there, say so instead of spinning forever.
  const hasChat = !!chat
  const [missing, setMissing] = useState<string | null>(null)
  useEffect(() => {
    if (hasChat) return
    let live = true
    // 0.7.0: a nebula's notification opens glofly://chat/<its conversation>: fly into that nebula.
    void placeOfChat(id).then((place) => {
      if (!live || !place) return
      live = false
      if (router.canGoBack()) router.back()
      else router.replace('/chats')
      setTimeout(() => flyIn(null, isWideNow() ? [{ pathname: '/constellations/[cid]', params: { cid: place.constellationId, nebula: place.nebulaId } }] : ['/constellations', `/constellations/${place.constellationId}`, `/constellations/${place.constellationId}/nebula/${place.nebulaId}`]), 60)
    })
    void refreshConversations().then((ok) => {
      if (live && ok && !useStore.getState().conversations[id]) setMissing(id)
    })
    return () => {
      live = false
    }
  }, [id, hasChat])

  const isGroup = chat?.kind === 'group'
  const members = useMemo(() => (chat ? chat.members : []), [chat])
  const me = useSession((s) => s.user)
  // Mentions of you are shown too (the members list is everyone else).
  const mentionable = useMemo(() => (me ? [...members, me] : members), [members, me])
  const title = chat ? chatTitle(chat) : ''

  // Rows, newest first (the list is upside down so it starts at the bottom).
  const rows: RowInfo[] = useMemo(() => {
    const ms = messages?.list ?? []
    const out: RowInfo[] = []
    let lastMine = -1
    for (let i = ms.length - 1; i >= 0; i--) if (ms[i].senderId === meId && !ms[i].event && !isLocal(ms[i])) {
      lastMine = i
      break
    }
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]
      const prev = ms[i - 1]
      const next = ms[i + 1]
      const joinedAbove = !!prev && !prev.event && !m.event && continuesGroup(prev, m)
      const joinedBelow = !!next && !next.event && !m.event && continuesGroup(m, next)
      let receipt: string | null = null
      if (i === lastMine && chat?.kind === 'dm') {
        receipt = chat.partnerReadAt && chat.partnerReadAt >= m.createdAt ? `Seen ${clockTime(chat.partnerReadAt)}` : 'Sent'
      }
      const o = outbox[m.id]
      out.push({
        message: m,
        joinedAbove,
        joinedBelow,
        day: !prev || !isSameDay(prev.createdAt, m.createdAt) ? dayLabel(m.createdAt) : null,
        receipt,
        mentionsMe: isGroup && mentionsMe(m, meId) && m.senderId !== meId,
        outgoing: o ? o.status : null,
        slow: !!o?.slow,
      })
    }
    return out.reverse()
  }, [messages?.list, meId, chat, outbox, isGroup])
  // Scrolled up more than a screen: a "Jump to latest" button (with "N new").
  const newestFirst = useMemo(() => rows.map((r) => r.message), [rows])
  const jumper = useJumpToLatest(newestFirst, meId, id, list, () => void markChatRead(id))
  const dayPill = useDayPill<RowInfo>()

  const memberIds = useMemo(() => [meId, ...members.map((p) => p.id)], [meId, members])
  const canMessage = !!chat?.canMessage
  const nameOf = (uid: string) => (uid === meId ? 'You' : (people[uid]?.displayName ?? 'Someone'))

  // 0.8.0 keyboard shortcuts (iPad, tablets): ↑ in an empty message box edits your last message,
  // ⌘F searches this chat, Esc cancels a reply or edit.
  const focused = useIsFocused()
  const [boxKeys, setBoxKeys] = useState({ focused: false, empty: true })
  const lastEditable = useMemo(
    () => [...(messages?.list ?? [])].reverse().find((m) => m.senderId === meId && !m.deleted && !m.event && !!m.body && !special(m) && !isLocal(m)) ?? null,
    [messages?.list, meId],
  )
  useKeyCommand(
    'editLast',
    () => {
      if (!lastEditable || !composer.current?.emptyAndFocused()) return
      void messageAction(lastEditable, 'edit')
    },
    focused && canMessage && !editing && boxKeys.focused && boxKeys.empty && !!lastEditable,
  )
  useKeyCommand('find', () => setSearching(true), focused && !searching)
  useKeyCommand(
    'escape',
    () => {
      if (editing) composer.current?.clear()
      setReply(null)
      setEditing(null)
    },
    focused && !searching && !!(reply || editing),
  )
  useKeyCommand('escape', () => setSearching(false), focused && searching)

  function onSend(text: string) {
    if (editing) {
      const m = editing
      setEditing(null)
      if (text === m.body) return
      putMessage({ ...m, body: text, editedAt: new Date().toISOString() })
      void api.editMessage(id, m.id, text).then((r) => {
        if (r.ok) updateMessage(r.data)
        else {
          updateMessage(m)
          void inform("Couldn't edit it", r.message)
        }
      })
      return
    }
    const ready = uploads.readyAttachments()
    if (uploads.busy) return void inform('Still uploading', 'Wait for your photos and files to finish, then send.')
    if (!text && !ready.length) return
    sendText(id, text, reply, ready, lantern)
    uploads.clear()
    setReply(null)
    setLantern(false)
  }

  async function plusMenu() {
    // The keyboard would cover the bottom of the sheet (Lantern message is last); put it away first.
    Keyboard.dismiss()
    const pick = await attachMenu(uploads, [
      { key: 'gif', label: 'GIF or sticker', icon: 'gif' },
      ...(isGroup ? [{ key: 'poll', label: 'Poll', icon: 'poll' }] : []),
      { key: 'game', label: 'Play a game', icon: 'gamepad' },
      { key: 'lantern', label: lantern ? 'Lantern message (on)' : 'Lantern message', icon: 'lantern', detail: 'Fades away once it’s read', checked: lantern },
    ])
    if (pick === 'gif') setGifOpen(true)
    if (pick === 'poll') setPollOpen(true)
    if (pick === 'lantern') {
      setLantern((on) => !on)
      // Back to typing (or straight to Send, if the message is already written)
      if (!lantern) setTimeout(() => composer.current?.focus(), 350)
    }
    if (pick === 'game') {
      const kind = await chooseFrom(
        GAMES.map((g) => ({ key: g.kind, label: g.label, detail: g.detail, icon: 'gamepad' })),
        'Play a game',
      )
      if (!kind) return
      const r = await api.startGame(id, kind as api.ChatGameKind)
      if (r.ok) updateMessage(r.data)
      else void inform("Couldn't start the game", r.message)
    }
  }

  async function sendGif(gifId: string) {
    const r = await api.sendGif(id, gifId, reply?.id)
    setReply(null)
    if (r.ok) updateMessage(r.data)
    else void inform("Couldn't send the GIF", r.message)
  }

  /** Long-press ❤️ or 🔥: the reaction goes on (never off) and fireflies fly across the chat. */
  async function sendFireflies(m: Message, emoji: '❤️' | '🔥') {
    const already = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId)
    if (!already) void react(m, emoji)
    const r = await api.fireflies(id, emoji)
    if (!r.ok) void inform("Couldn't send fireflies", r.message)
  }

  async function react(m: Message, emoji: string) {
    const on = !m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId)
    if (on) tap.light()
    // Shows right away; the server's copy replaces it.
    const reactions = m.reactions.map((r) => ({ ...r, userIds: [...r.userIds] }))
    const found = reactions.find((r) => r.emoji === emoji)
    if (on) {
      if (found) found.userIds.push(meId)
      else reactions.push({ emoji, userIds: [meId] })
    } else if (found) found.userIds = found.userIds.filter((u) => u !== meId)
    putMessage({ ...m, reactions: reactions.filter((r) => r.userIds.length) })
    const r = await api.react(id, m.id, emoji, on)
    if (r.ok) updateMessage(r.data)
    else {
      updateMessage(m)
      void inform("Couldn't react", r.message)
    }
  }

  async function messageAction(m: Message, action: string) {
    setActionsFor(null)
    switch (action) {
      case 'reply':
        setEditing(null)
        setReply(m)
        composer.current?.focus()
        return
      case 'copy':
        await Clipboard.setStringAsync(m.body)
        return
      case 'edit':
        setReply(null)
        setEditing(m)
        composer.current?.setText(m.body)
        composer.current?.focus()
        return
      case 'delete': {
        const ok = await confirm({ title: 'Delete this message?', message: 'It’s removed for everyone in the chat.', confirmLabel: 'Delete', danger: true })
        if (!ok) return
        const r = await api.deleteMessage(id, m.id)
        if (r.ok) updateMessage(r.data)
        else void inform("Couldn't delete it", r.message)
        return
      }
      case 'unpreview': {
        const r = await api.removePreview(id, m.id)
        if (r.ok) updateMessage(r.data)
        else void inform("Couldn't remove it", r.message)
        return
      }
      case 'report':
        void openReport({ userId: m.senderId, name: people[m.senderId]?.displayName ?? 'them', messageId: m.id, conversationId: id })
        return
      case 'pin':
      case 'unpin':
        void pinsApi.setPinned(m, action === 'pin')
        return
      case 'forward':
        router.push({ pathname: '/forward', params: { mid: m.id, from: m.forwarded?.name ?? nameOf(m.senderId), text: (shortBody(m.body) || attachmentSummary(m.attachments)).slice(0, 300) } })
        return
      case 'unread':
        // Leaves the chat, so it isn't read again straight away.
        if (await markUnread(id, m)) {
          if (router.canGoBack()) router.back()
          else router.replace('/chats')
        }
        return
      case 'more': {
        const e = await pickEmoji()
        if (e) void react(m, e)
        return
      }
    }
  }

  function scrollTo(index: number, messageId: string) {
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
    setHighlight(messageId)
    setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 2000)
  }

  /** Scrolls to a message (a reply's original, a search result), loading older ones if needed. */
  async function jumpTo(messageId: string) {
    const index = rows.findIndex((r) => r.message.id === messageId)
    if (index >= 0) return scrollTo(index, messageId)
    const found = await loadUntil(id, messageId)
    if (!found) return void inform("Couldn't find that message", 'It may have been deleted.')
    setPendingJump(messageId) // scrolled once the list has re-rendered with it
  }
  useEffect(() => {
    if (!pendingJump) return
    const index = rows.findIndex((r) => r.message.id === pendingJump)
    if (index < 0) return
    setPendingJump(null)
    // Let the list lay out the newly loaded rows first.
    setTimeout(() => scrollTo(index, pendingJump), 120)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, pendingJump])

  // The message list's handlers and renderItem stay the same between renders, so MessageRow
  // (memo) only redraws rows that changed. The ref always reaches the latest react / jumpTo.
  const latest = useRef({ react, jumpTo })
  latest.current = { react, jumpTo }
  const onRowLongPress = useCallback((m: Message) => {
    if (isLocal(m)) return
    tap.light()
    setActionsFor(m)
  }, [])
  const onRowReact = useCallback((m: Message, e: string) => void latest.current.react(m, e), [])
  const onQuotePress = useCallback((mid: string) => void latest.current.jumpTo(mid), [])
  const onOpenPhoto = useCallback((m: Message, index: number) => setViewer({ message: m, index }), [])
  const renderRow = useCallback(
    ({ item }: { item: RowInfo }) => (
      <MessageRow
        row={item}
        meId={meId}
        isGroup={isGroup}
        people={people}
        members={mentionable}
        highlight={highlight === item.message.id}
        onLongPress={onRowLongPress}
        onReact={onRowReact}
        onQuotePress={onQuotePress}
        onRetry={retryOrDiscard}
        onAvatarPress={openProfile}
        onOpenPhoto={onOpenPhoto}
        canAct={canMessage}
        memberIds={memberIds}
      />
    ),
    [meId, isGroup, people, mentionable, highlight, onRowLongPress, onRowReact, onQuotePress, onOpenPhoto, canMessage, memberIds],
  )

  if (!chat) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: insets.top }}>
        {missing === id ? (
          <>
            <Text tone="muted">This chat isn't available.</Text>
            {wide ? null : <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))} color={c.ink} size={24} />}
          </>
        ) : (
          <>
            <Spinner />
            <Text tone="muted">Opening the chat…</Text>
          </>
        )}
      </View>
    )
  }

  const onlineCount = isGroup ? members.filter((m) => allPresence[m.id] && allPresence[m.id].status !== 'offline').length + 1 : 0
  const typingWho = typing ? Object.entries(typing).filter(([, until]) => until > now).map(([uid]) => uid) : []
  const subtitle = isGroup ? `${memberCountLabel(chat.memberCount)} · ${onlineCount} online` : presenceHeader(presence)
  const muted = isMuted(chat, now)
  const inCall = call && (call.status === 'ongoing' || call.status === 'ringing')
  const iAmIn = inCall && call.members.find((m) => m.userId === meId)?.state === 'joined'
  // You're in this chat's call, but on another device (the computer): offer to bring it here.
  const onOtherDevice = !!iAmIn && call?.status === 'ongoing' && callHereId !== call.id
  // Groups of 3+ (0.5.2): a new call can ring only some of the group.
  const canRingSome = isGroup && !inCall && chat.memberCount > 2
  const ringSomeHint = canRingSome ? 'Long-press to choose who to ring' : undefined

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? stripH : 0}>
      <View style={{ backgroundColor: c.barBg, borderBottomWidth: 0.5, borderBottomColor: c.line, paddingTop: insets.top }}>
        <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 2 }}>
          {/* iPad (two panes): the chat list is right there on the left, so no back arrow. */}
          {wide ? (
            <View style={{ width: 12 }} />
          ) : (
            <IconButton name="back" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/chats'))} color={c.ink} size={24} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isGroup ? `${title}, group settings` : `${title}, view profile`}
            onPress={() => (chat.kind === 'dm' ? router.push({ pathname: '/profile/[id]', params: { id: chat.partner.id } }) : router.push({ pathname: '/group/[id]', params: { id } }))}
            style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <ChatAvatar chat={chat} size={40} status={presence?.status ?? null} mobile={onMobile(presence ?? undefined)} ring={c.barBg} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text display size={18} numberOfLines={1} style={{ flexShrink: 1 }}>
                  {title}
                </Text>
                {muted ? <Icon name="bellOff" size={14} color={c.faint} /> : null}
                {partnerGlow ? <GlowMark glow={partnerGlow} /> : null}
              </View>
              {subtitle ? (
                <Text size={13} tone="muted" numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
          {canMessage || isGroup ? (
            onOtherDevice ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="You're in this call on another device. Move it to this phone"
                disabled={inAnyCall || startingCall}
                onPress={() => void moveCallHere(id)}
                style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.online, justifyContent: 'center', marginRight: 4, opacity: inAnyCall || startingCall ? 0.5 : 1 }}
              >
                <Text size={14} weight="bold" style={{ color: '#FFFFFF' }}>
                  Move here
                </Text>
              </Pressable>
            ) : inCall && !iAmIn && isGroup ? null : inCall && !iAmIn ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Join call" onPress={() => void joinCallIn(id, false)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.online, justifyContent: 'center', marginRight: 4 }}>
                <Text size={14} weight="bold" style={{ color: '#FFFFFF' }}>
                  Join call
                </Text>
              </Pressable>
            ) : (
              <>
                {/* Groups (0.5.2): long-press to choose who to ring. */}
                <IconButton name="phone" label="Voice call" accessibilityHint={ringSomeHint} box={44} onPress={() => void startCallIn(id, false)} onLongPress={canRingSome ? () => setRingSome(true) : undefined} disabled={!!inCall || startingCall} />
                <IconButton name="video" label="Video call" accessibilityHint={ringSomeHint} box={44} size={24} onPress={() => void startCallIn(id, true)} onLongPress={canRingSome ? () => setRingSome(true) : undefined} disabled={!!inCall || startingCall} />
              </>
            )
          ) : null}
          <IconButton name="search" label="Search this chat" box={40} size={22} onPress={() => setSearching(true)} />
          <IconButton name="more" label="More options" box={40} onPress={() => void chatMenu(chat, { inChat: true, onRingSome: canRingSome ? () => setRingSome(true) : undefined })} />
        </View>
      </View>

      {/* 0.8.3: a group call you're not in: who's in it, and Join */}
      {isGroup && inCall && !iAmIn && call ? <JoinBar call={call} people={me ? [...chat.members, me] : chat.members} onJoin={(video) => void joinCallIn(id, video)} busy={inAnyCall} /> : null}
      <ReconnectingStrip />
      <PinnedBar pins={pinsApi.pins} onOpen={() => setPinsOpen(true)} />
      <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        data={rows}
        inverted
        keyExtractor={(r) => r.message.id}
        contentContainerStyle={{ paddingVertical: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadOlder(id)}
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={typingWho.length ? <TypingBubble userIds={typingWho} people={people} isGroup={isGroup} /> : null}
        ListFooterComponent={
          messages?.loading && messages.list.length ? (
            <View style={{ padding: 16 }}>
              <Spinner />
            </View>
          ) : messages?.loaded && !messages.hasMore && !messages.list.length ? (
            // 0.7.5: a brand-new chat says hi with a wave instead of an empty page.
            <View>
              <EmptyScene
                kind={isGroup ? 'group' : 'hello'}
                title={isGroup ? `${title} is all set` : `Say hi to ${chat.kind === 'dm' ? firstName(chat.partner.displayName) : ''} 👋`}
                text={isGroup ? 'This is the beginning of the group. Say hello to everyone!' : `This is the start of your chat with ${chat.kind === 'dm' ? `@${chat.partner.username}` : ''}.`}
              >
                {canMessage ? <Button compact label="Wave 👋" onPress={() => sendText(id, '👋', null)} /> : null}
              </EmptyScene>
            </View>
          ) : messages?.loaded && !messages.hasMore ? (
            <View style={{ alignItems: 'center', paddingVertical: 24, gap: 8 }}>
              <ChatAvatar chat={chat} size={72} />
              <Text display size={20}>
                {title}
              </Text>
              <Text size={14} tone="muted" style={{ textAlign: 'center', paddingHorizontal: 32 }}>
                {isGroup ? 'This is the start of the group.' : `This is the start of your chat with ${chat.kind === 'dm' ? firstName(chat.partner.displayName) : ''}.`}
              </Text>
            </View>
          ) : null
        }
        ListEmptyComponent={!messages?.loaded ? <View style={{ transform: [{ scaleY: -1 }] }}><Skeleton kind="messages" /></View> : null}
        renderItem={renderRow}
        {...dayPill.listProps}
        {...jumper.listProps}
      />
      <DayPill label={dayPill.label} visible={dayPill.visible} />
      <JumpToLatestButton visible={jumper.away} count={jumper.count} onPress={jumper.jump} />
      <ChatFireflies conversationId={id} meId={meId} nameOf={nameOf} />
      {partnerBirthday && chat.kind === 'dm' ? <BirthdayConfetti userId={chat.partner.id} name={chat.partner.displayName} /> : null}
      </View>

      {canMessage ? (
        <Composer
          ref={composer}
          placeholder={isGroup ? `Message ${title}` : `Message ${chat.kind === 'dm' ? firstName(chat.partner.displayName) : ''}`}
          people={members}
          mentionable={isGroup}
          reply={reply}
          replyName={reply ? (reply.senderId === meId ? 'yourself' : firstName(nameOf(reply.senderId))) : ''}
          editing={editing}
          onCancel={() => {
            setReply(null)
            setEditing(null)
          }}
          onSend={onSend}
          onTyping={() => sendTyping(id)}
          onAttach={() => void plusMenu()}
          topSlot={
            <>
              <ScheduledStrip items={scheduled.items} onOpen={() => setScheduledOpen(true)} />
              {lantern ? <LanternBar onOff={() => setLantern(false)} /> : null}
              <UploadTray uploads={uploads} />
            </>
          }
          canSendEmpty={uploads.items.length > 0}
          voice={voice.recording ? <VoiceRecorderBar voice={voice} /> : undefined}
          recordButton={<RecordButton voice={voice} />}
          onSendLater={uploads.items.length || lantern ? undefined : (t) => setLaterText(t)}
          onKeyState={setBoxKeys}
        />
      ) : (
        <View style={{ padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: c.barBg, borderTopWidth: 0.5, borderTopColor: c.line }}>
          <Text size={14} tone="muted" style={{ textAlign: 'center' }}>
            {chat.kind === 'dm' ? `You can only message ${firstName(chat.partner.displayName)} while you're friends.` : "You can't send messages here."}
          </Text>
        </View>
      )}

      {actionsFor ? (
        <BottomSheet onClose={() => setActionsFor(null)}>
          <View style={{ paddingBottom: insets.bottom + 8 }}>
            <View accessibilityLabel="Quick reactions" style={{ flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 12, paddingBottom: 10 }}>
              {QUICK_REACTIONS.map((e) => {
                const on = actionsFor.reactions.find((r) => r.emoji === e)?.userIds.includes(meId)
                return (
                  <Pressable
                    key={e}
                    accessibilityRole="button"
                    accessibilityLabel={`React ${e}`}
                    onPress={() => {
                      const m = actionsFor
                      setActionsFor(null)
                      void react(m, e)
                    }}
                    // Hold ❤️ or 🔥 to send a swarm of fireflies.
                    onLongPress={
                      (e === '❤️' || e === '🔥') && canMessage
                        ? () => {
                            const m = actionsFor
                            setActionsFor(null)
                            void sendFireflies(m, e)
                          }
                        : undefined
                    }
                    delayLongPress={400}
                    style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.chipMine : c.surface }}
                  >
                    <Text size={24}>{e}</Text>
                  </Pressable>
                )
              })}
              <Pressable accessibilityRole="button" accessibilityLabel="More reactions" onPress={() => void messageAction(actionsFor, 'more')} style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface }}>
                <Icon name="emojiAdd" size={22} color={c.ink2} />
              </Pressable>
            </View>
            {canMessage ? (
              <Text size={12} tone="faint" style={{ textAlign: 'center', marginTop: -4, marginBottom: 6 }}>
                Hold ❤️ or 🔥 to send fireflies
              </Text>
            ) : null}
            <View accessibilityLabel="Message actions">
              {[
                { key: 'reply', label: 'Reply', icon: 'reply' as const, show: canMessage },
                { key: 'copy', label: 'Copy text', icon: 'copy' as const, show: !!actionsFor.body && !special(actionsFor) },
                { key: 'forward', label: 'Forward', icon: 'send' as const, show: !actionsFor.deleted && !actionsFor.event && !actionsFor.lantern && !actionsFor.poll && !actionsFor.game && !actionsFor.buttons?.length },
                { key: 'edit', label: 'Edit', icon: 'pencil' as const, show: actionsFor.senderId === meId && !!actionsFor.body && canMessage && !special(actionsFor) },
                { key: 'unpreview', label: 'Remove link preview', icon: 'link' as const, show: actionsFor.senderId === meId && !!actionsFor.linkPreview && canMessage },
                { key: 'delete', label: 'Delete', icon: 'trash' as const, show: actionsFor.senderId === meId, danger: true },
                { key: pinsApi.isPinned(actionsFor.id) ? 'unpin' : 'pin', label: pinsApi.isPinned(actionsFor.id) ? 'Unpin' : 'Pin', icon: (pinsApi.isPinned(actionsFor.id) ? 'unpin' : 'pin') as 'pin', show: pinsApi.canPin && !actionsFor.deleted && !actionsFor.event },
                { key: 'unread', label: 'Mark unread', icon: 'bell' as const, show: actionsFor.senderId !== meId && !actionsFor.event },
                { key: 'report', label: 'Report message', icon: 'flag' as const, show: actionsFor.senderId !== meId, danger: true },
              ]
                .filter((a) => a.show)
                .map((a) => (
                  <Pressable key={a.key} accessibilityRole="button" onPress={() => void messageAction(actionsFor, a.key)} android_ripple={{ color: c.line }} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 18, paddingHorizontal: 24 }}>
                    <Icon name={a.icon} size={22} color={a.danger ? c.danger : c.ink2} />
                    <Text size={16} tone={a.danger ? 'danger' : 'ink'}>
                      {a.label}
                    </Text>
                  </Pressable>
                ))}
            </View>
          </View>
        </BottomSheet>
      ) : null}
      {gifOpen ? (
        <GifSheet
          onPick={(g) => {
            setGifOpen(false)
            if (g) void sendGif(g.id)
          }}
          onPickSticker={(st) => {
            setGifOpen(false)
            void api.sendSticker(st.id, id, reply?.id).then((r) => {
              setReply(null)
              if (r.ok) updateMessage(r.data)
              else void inform("Couldn't send the sticker", r.message)
            })
          }}
        />
      ) : null}
      {pollOpen ? <PollSheet conversationId={id} onDone={() => setPollOpen(false)} /> : null}
      {pinsOpen ? (
        <PinsSheet
          pins={pinsApi.pins}
          canPin={pinsApi.canPin}
          nameOf={nameOf}
          onClose={() => setPinsOpen(false)}
          onUnpin={(m) => void pinsApi.setPinned(m, false)}
          onJump={(mid) => {
            setPinsOpen(false)
            void jumpTo(mid)
          }}
        />
      ) : null}
      {scheduledOpen ? <ScheduledSheet conversationId={id} items={scheduled.items} onChanged={scheduled.load} onClose={() => setScheduledOpen(false)} /> : null}
      {laterText !== null ? (
        <SendLaterSheet
          preview={laterText}
          onClose={() => setLaterText(null)}
          onPick={(at) => {
            const text = laterText
            setLaterText(null)
            void scheduled.schedule(text, at, reply?.id).then((ok) => {
              if (!ok) return
              composer.current?.clear()
              setReply(null)
            })
          }}
        />
      ) : null}
      {ringSome && canRingSome ? <RingSomeSheet chat={chat} onClose={() => setRingSome(false)} /> : null}
      {viewer ? <PhotoViewer state={viewer} messages={messages?.list} chatName={isGroup ? title : null} onShowInChat={(mid) => void jumpTo(mid)} onClose={() => setViewer(null)} /> : null}
      {searching ? (
        <SearchPanel
          chatId={id}
          meId={meId}
          people={people}
          onClose={() => setSearching(false)}
          onPick={(mid) => {
            setSearching(false)
            void jumpTo(mid)
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  )
}

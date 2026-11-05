import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View, type View as RNView } from 'react-native'
import { router, useIsFocused } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Clipboard from 'expo-clipboard'
import { type ConstellationDetail, type Message, type Nebula, type PublicUser } from '@glofly/shared'
import * as api from '@/api/glofly'
import { sendTyping } from '@/api/realtime'
import { putMessage, useStore } from '@/state/store'
import { loadOlder, loadUntil, updateMessage } from '@/state/sync'
import { unreadTotal } from '@/lib/chats'
import { firstName } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { QUICK_REACTIONS } from '@/lib/emoji'
import { joinVoiceNebula, useCall } from '@/calls/controller'
import { Composer, type ComposerHandle } from '@/chat/Composer'
import { markUnread, PinsSheet, ScheduledSheet, ScheduledStrip, SendLaterSheet, usePins, useScheduled } from '@/chat/chatTools'
import { TypingBubble } from '@/chat/TypingBubble'
import { discard, isLocal, retry, sendText } from '@/chat/send'
import { attachMenu, UploadTray, useUploads } from '@/chat/uploads'
import { RecordButton, VoiceRecorderBar, useVoice } from '@/chat/voice'
import { PhotoViewer, type ViewerState } from '@/chat/PhotoViewer'
import { ChatFireflies, GAMES, GifSheet, PollSheet } from '@/chat/Extras'
import { SearchPanel } from '@/chat/SearchPanel'
import { useKeyCommand } from '@/lib/keys'
import { cxSay, loadDetail, refreshCardsSoon, refreshNews } from '@/state/constellations'
import { chooseFrom, confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { Skeleton } from '@/ui/Skeleton'
import { JumpToLatestButton, useJumpToLatest } from '@/chat/JumpToLatest'
import { ReconnectingStrip } from '@/ui/Reconnecting'
import { openReport, pickEmoji } from '@/ui/sheets'
import { measure, openContextMenu, type MenuItem } from './ContextMenu'
import { openDmDock } from './dock'
import { haptic } from './motion'
import { openMemberSheet } from './Members'
import { pickTimeout } from './moderation'
import { NebulaRow, type NebulaRowInfo } from './NebulaRow'
import { firstNewId, NewSinceLine, NewSincePill, PinsChip, type NewSince } from './feel'
import { can, cantPost, isQuiet, outranks, roleLook } from './roles'
import { markNebulaRead, useNebulaChat } from './useNebula'
import { openNebulaSheet } from './nebulaActions'
import { CountBadge, FireflyMark, Glyph, N, SpeakerGlyph, StarGlyph } from './ui'
// 0.8.0 community tools: event cards, search across the constellation
import { EventCard, takeJump, useEventMessages } from './communityTools'
import { useCallStripHeight } from '@/calls/CallOverlay'

// A text nebula (canvas boards 4 and 4b): the chat with role colors and badges, @you rows,
// polls, the voice Join card, and the read-only / timed-out states. Messages go through the same
// routes as any chat (the server checks who can post).

const special = (m: Message) => !!(m.gif || m.poll || m.game)

const retryOrDiscard = async (m: Message) => {
  const pick = await chooseFrom([
    { key: 'retry', label: 'Try again', icon: 'refresh' },
    { key: 'discard', label: 'Delete it', icon: 'trash', danger: true },
  ])
  if (pick === 'retry') retry(m.id)
  if (pick === 'discard') discard(m.id)
}

/** "14:52" (or "2 h 10 m" for long ones) */
function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s >= 3600 * 24) return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function NebulaChat({
  c,
  n,
  wide,
}: {
  c: ConstellationDetail
  n: Nebula
  /** iPad: no back arrow; the members column can be hidden from the header */
  wide?: { membersShown: boolean; toggleMembers: () => void }
}) {
  const insets = useSafeAreaInsets()
  const stripH = useCallStripHeight()
  const { rows, messages, people, members, meId } = useNebulaChat(c, n)
  // 0.7.5 "New since you left": what was new when you opened it (kept until Mark as read)
  const [newSince, setNewSince] = useState<NewSince | null>(() =>
    n.lastReadAt && n.unreadCount > 0 ? { since: n.lastReadAt, count: n.unreadCount } : null,
  )
  const firstNew = useMemo(() => (newSince ? firstNewId(messages?.list ?? [], newSince.since, meId) : null), [newSince, messages?.list, meId])
  const typing = useStore((s) => s.typing[n.conversationId])
  const dmUnread = useStore((s) => unreadTotal(Object.values(s.conversations)))
  const myVoice = useCall((s) => s.voice?.nebulaId ?? null)
  const [reply, setReply] = useState<Message | null>(null)
  const [editing, setEditing] = useState<Message | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [viewer, setViewer] = useState<ViewerState | null>(null)
  const [gifOpen, setGifOpen] = useState(false)
  const [pollOpen, setPollOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const list = useRef<FlatList<NebulaRowInfo>>(null)
  const uploads = useUploads(n.conversationId)
  // 0.7.3: pinned messages (pinning: people who can manage messages here), send later
  const pinsApi = usePins(n.conversationId)
  const scheduled = useScheduled(n.conversationId)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [scheduledOpen, setScheduledOpen] = useState(false)
  const [laterText, setLaterText] = useState<string | null>(null)
  const voice = useVoice(n.conversationId)
  const blocked = cantPost(c, n)
  const timedOut = blocked?.kind === 'timeout'
  const now = useNow(timedOut ? 1000 : 60_000)
  const canAct = !blocked
  const others = useMemo(() => members.filter((p) => p.id !== meId), [members, meId])
  const online = c.members.filter((m) => m.status !== 'offline').length
  const memberIds = useMemo(() => members.map((p) => p.id), [members])
  // 0.8.0 events: a card under each event's "made an event 📅" message
  const eventCards = useEventMessages(c.id)

  // A voice nebula with people in it, that you could drop into (the Join card).
  const dropIn = useMemo(() => {
    const busy = c.voice.filter((v) => v.userIds.length && v.nebulaId !== myVoice).sort((a, b) => b.userIds.length - a.userIds.length)[0]
    const vn = busy ? c.nebulas.find((x) => x.id === busy.nebulaId) : null
    return busy && vn ? { nebula: vn, count: busy.userIds.length, live: busy.live } : null
  }, [c, myVoice])

  const nameOf = (uid: string) => (uid === meId ? 'You' : (people[uid]?.displayName ?? 'Someone'))
  const typingWho = typing ? Object.entries(typing).filter(([, until]) => until > Date.now()).map(([uid]) => uid) : []

  // 0.8.0 keyboard shortcuts: ↑ in an empty box edits your last message, ⌘F searches the nebula,
  // Esc cancels a reply or edit (⌥↑ / ⌥↓ between nebulas: lib/nebulaKeys.ts).
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
      setReply(null)
      setEditing(lastEditable)
      composer.current?.setText(lastEditable.body)
      composer.current?.focus()
    },
    focused && canAct && !editing && boxKeys.focused && boxKeys.empty && !!lastEditable,
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
      void api.editMessage(n.conversationId, m.id, text).then((r) => {
        if (r.ok) updateMessage(r.data)
        else {
          updateMessage(m)
          cxSay(r.message)
        }
      })
      return
    }
    const ready = uploads.readyAttachments()
    if (uploads.busy) return cxSay('Wait for your photos and files to finish uploading, then send.')
    if (!text && !ready.length) return
    sendText(n.conversationId, text, reply, ready, false)
    uploads.clear()
    setReply(null)
  }

  async function plusMenu() {
    const pick = await attachMenu(uploads, [
      { key: 'gif', label: 'GIF or sticker', icon: 'gif' },
      { key: 'poll', label: 'Poll', icon: 'poll' },
      { key: 'game', label: 'Play a game', icon: 'gamepad' },
    ])
    if (pick === 'gif') setGifOpen(true)
    if (pick === 'poll') setPollOpen(true)
    if (pick === 'game') {
      const kind = await chooseFrom(
        GAMES.map((g) => ({ key: g.kind, label: g.label, detail: g.detail, icon: 'gamepad' })),
        'Play a game',
      )
      if (!kind) return
      const r = await api.startGame(n.conversationId, kind as api.ChatGameKind)
      if (r.ok) updateMessage(r.data)
      else cxSay(r.message)
    }
  }

  async function react(m: Message, emoji: string) {
    const on = !m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(meId)
    if (on) haptic.light()
    const reactions = m.reactions.map((r) => ({ ...r, userIds: [...r.userIds] }))
    const found = reactions.find((r) => r.emoji === emoji)
    if (on) {
      if (found) found.userIds.push(meId)
      else reactions.push({ emoji, userIds: [meId] })
    } else if (found) found.userIds = found.userIds.filter((u) => u !== meId)
    putMessage({ ...m, reactions: reactions.filter((r) => r.userIds.length) })
    const r = await api.react(n.conversationId, m.id, emoji, on)
    if (r.ok) updateMessage(r.data)
    else {
      updateMessage(m)
      cxSay(r.message)
    }
  }

  async function remove(m: Message, asModerator: boolean) {
    const sender = people[m.senderId]
    const ok = await confirm({
      title: 'Delete this message?',
      message: asModerator ? `It's removed for everyone in #${n.name}. This is saved to the moderation log.` : `It's removed for everyone in #${n.name}.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    const r = await api.deleteMessage(n.conversationId, m.id)
    if (r.ok) {
      updateMessage(r.data)
      if (asModerator && sender) cxSay(`Deleted ${firstName(sender.displayName, sender.username)}'s message.`)
    } else cxSay(r.message)
  }

  /** Press and hold a message: reactions, Reply, Copy, Report; moderators get Time out and Delete. */
  async function messageMenu(m: Message, anchorRef: RNView | null) {
    if (isLocal(m)) return
    haptic.medium()
    const at = (await measure(anchorRef)) ?? { x: 14, y: 240, w: 360, h: 80 }
    const mine = m.senderId === meId
    const sender = people[m.senderId] ?? c.members.find((x) => x.user.id === m.senderId)?.user
    const stillMember = c.members.some((x) => x.user.id === m.senderId)
    const above = !mine && outranks(c, meId, m.senderId)
    const modTimeout = above && stillMember && can(c, 'timeoutKick') && !!sender
    const modDelete = !mine && can(c, 'deleteMessages') && (above || !stillMember)
    const items: MenuItem[] = [
      ...(canAct ? [{ key: 'reply', label: 'Reply', icon: <Icon name="reply" size={18} color={N.ink} /> }] : []),
      ...(m.body && !special(m) ? [{ key: 'copy', label: 'Copy text', icon: <Icon name="copy" size={18} color={N.ink} /> }] : []),
      ...(mine && m.body && canAct && !special(m) ? [{ key: 'edit', label: 'Edit', icon: <Icon name="pencil" size={18} color={N.ink} /> }] : []),
      ...(mine && m.linkPreview && canAct ? [{ key: 'unpreview', label: 'Remove link preview', icon: <Icon name="link" size={18} color={N.ink} /> }] : []),
      ...(mine ? [{ key: 'delete', label: 'Delete', icon: <Icon name="trash" size={18} color={N.redText} />, danger: true }] : []),
      ...(pinsApi.canPin && !m.deleted && !m.event ? [{ key: pinsApi.isPinned(m.id) ? 'unpin' : 'pin', label: pinsApi.isPinned(m.id) ? 'Unpin' : 'Pin', icon: <Icon name={pinsApi.isPinned(m.id) ? 'unpin' : 'pin'} size={18} color={N.ink} /> }] : []),
      ...(!mine && !m.event ? [{ key: 'unread', label: 'Mark unread', icon: <Icon name="bell" size={18} color={N.ink} /> }] : []),
      ...(!mine ? [{ key: 'report', label: 'Report', icon: <Icon name="flag" size={18} color={N.ink} /> }] : []),
    ]
    const mod: MenuItem[] = [
      ...(modTimeout ? [{ key: 'timeout', label: `Time out ${firstName(sender!.displayName, sender!.username)}`, icon: <Glyph name="timer" size={18} color={N.amber} /> }] : []),
      ...(modDelete ? [{ key: 'moddelete', label: 'Delete message', icon: <Icon name="trash" size={18} color={N.redText} />, danger: true }] : []),
    ]
    if (mod.length) mod[0] = { ...mod[0], section: 'Moderator' }
    const preview = (
      <View style={{ padding: 12, borderRadius: 18, backgroundColor: N.card, borderWidth: 1, borderColor: N.edge, boxShadow: '0 20px 50px rgba(0,0,0,0.6)', maxHeight: 220, overflow: 'hidden' }}>
        <NebulaRow row={{ message: m, joined: false, day: null, mentionsMe: false, outgoing: null }} meId={meId} sender={sender} role={roleLook(c, m.senderId)} members={members} people={people} highlight={false} canAct={false} />
      </View>
    )
    const pick = await openContextMenu({ ...at, h: Math.min(at.h + 24, 220) }, preview, [...items, ...mod], canAct && !m.deleted ? { emojis: QUICK_REACTIONS, picked: m.reactions.filter((r) => r.userIds.includes(meId)).map((r) => r.emoji), more: true } : undefined)
    if (!pick) return
    if (pick === 'react:more') {
      const e = await pickEmoji()
      if (e) void react(m, e)
      return
    }
    if (pick.startsWith('react:')) return void react(m, pick.slice(6))
    switch (pick) {
      case 'reply':
        setEditing(null)
        setReply(m)
        composer.current?.focus()
        return
      case 'copy':
        await Clipboard.setStringAsync(m.body)
        cxSay('Copied.')
        return
      case 'edit':
        setReply(null)
        setEditing(m)
        composer.current?.setText(m.body)
        composer.current?.focus()
        return
      case 'unpreview': {
        const r = await api.removePreview(n.conversationId, m.id)
        if (r.ok) updateMessage(r.data)
        else cxSay(r.message)
        return
      }
      case 'delete':
        return void remove(m, false)
      case 'moddelete':
        return void remove(m, true)
      case 'timeout':
        if (sender) void pickTimeout(c, sender)
        return
      case 'report':
        void openReport({ userId: m.senderId, name: sender?.displayName ?? 'them', messageId: m.id, conversationId: n.conversationId })
        return
      case 'pin':
      case 'unpin':
        void pinsApi.setPinned(m, pick === 'pin')
        return
      case 'unread':
        if (await markUnread(n.conversationId, m)) {
          cxSay('Marked unread.')
          // Its unread count comes with the constellation (and the dashboard's cards).
          setTimeout(() => {
            void loadDetail(c.id)
            refreshCardsSoon()
            refreshNews(true)
          }, 300)
          if (!wide) {
            if (router.canGoBack()) router.back()
            else router.replace({ pathname: '/constellations/[cid]', params: { cid: c.id } })
          }
        }
        return
    }
  }

  function scrollTo(index: number, messageId: string) {
    list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true })
    setHighlight(messageId)
    setTimeout(() => setHighlight((h) => (h === messageId ? null : h)), 2000)
  }
  async function jumpTo(messageId: string) {
    const index = rows.findIndex((r) => r.message.id === messageId)
    if (index >= 0) return scrollTo(index, messageId)
    const found = await loadUntil(n.conversationId, messageId)
    if (!found) return cxSay("Couldn't find that message. It may have been deleted.")
    setTimeout(() => {
      const i = rowsRef.current.findIndex((r) => r.message.id === messageId)
      if (i >= 0) scrollTo(i, messageId)
    }, 200)
  }
  const rowsRef = useRef(rows)
  // Scrolled up more than a screen: a "Jump to latest" button (with "N new").
  const newestFirst = useMemo(() => rows.map((r) => r.message), [rows])
  const jumper = useJumpToLatest(newestFirst, meId, n.conversationId, list, () => void markNebulaRead(c.id, n))
  rowsRef.current = rows

  const latest = useRef({ react, jumpTo, messageMenu })
  latest.current = { react, jumpTo, messageMenu }
  // 0.8.0: opened from the Inbox or search at a message
  const loadedOnce = !!messages?.loaded
  useEffect(() => {
    if (!loadedOnce) return
    const id = takeJump(n.id)
    if (id) setTimeout(() => void latest.current.jumpTo(id), 150)
  }, [loadedOnce, n.id])
  const onReact = useCallback((m: Message, e: string) => void latest.current.react(m, e), [])
  const onQuote = useCallback((mid: string) => void latest.current.jumpTo(mid), [])
  const onPhoto = useCallback((m: Message, index: number) => setViewer({ message: m, index }), [])
  const onFace = useCallback((uid: string) => openMemberSheet(c.id, uid), [c.id])
  const renderRow = useCallback(
    ({ item: raw }: { item: NebulaRowInfo }) => {
      const ev = eventCards.get(raw.message.id)
      const item = ev && !raw.message.deleted ? { ...raw, message: { ...raw.message, body: 'made an event 📅' } } : raw
      const row = item.message.id === firstNew && newSince ? (
      <View>
        <NewSinceLine since={newSince.since} />
        <HeldRow item={item} c={c} meId={meId} people={people} members={members} highlight={highlight === item.message.id} canAct={canAct} onMenu={(m, ref) => void latest.current.messageMenu(m, ref)} onReact={onReact} onQuote={onQuote} onFace={onFace} onPhoto={onPhoto} memberIds={memberIds} />
      </View>
    ) : <HeldRow item={item} c={c} meId={meId} people={people} members={members} highlight={highlight === item.message.id} canAct={canAct} onMenu={(m, ref) => void latest.current.messageMenu(m, ref)} onReact={onReact} onQuote={onQuote} onFace={onFace} onPhoto={onPhoto} memberIds={memberIds} />
      if (!ev || raw.message.deleted) return row
      return (
        <View>
          {row}
          <EventCard
            event={ev}
            c={c}
            onJoinVoice={(vid) => {
              const vn = c.nebulas.find((x) => x.id === vid)
              if (vn) void joinVoiceNebula({ constellationId: c.id, nebulaId: vn.id, nebulaName: vn.name, constellationName: c.name })
            }}
          />
        </View>
      )
    },
    [c, meId, people, members, highlight, canAct, onReact, onQuote, onFace, onPhoto, memberIds, firstNew, newSince, eventCards],
  )

  // Phones: swipe left on the chat for the members (the canvas's other way in, besides the button).
  const membersSwipe = Gesture.Fling()
    .runOnJS(true)
    .enabled(!wide)
    .direction(Directions.LEFT)
    .onEnd(() => router.push({ pathname: '/constellations/[cid]/members', params: { cid: c.id } }))

  const header = wide ? (
    <View style={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: N.line, backgroundColor: 'rgba(18,12,10,0.94)' }}>
      <StarGlyph size={16} color={N.amber} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={17} weight="bold" numberOfLines={1} accessibilityRole="header">
          {n.name}
        </Text>
        {n.topic ? (
          <Text size={12} numberOfLines={1} style={{ color: N.muted }}>
            {n.topic}
          </Text>
        ) : null}
      </View>
      <PinsChip count={pinsApi.pins.length} onPress={() => setPinsOpen(true)} />
      {isQuiet(n) ? <Icon name="bellOff" size={16} color={N.faint} /> : null}
      <HeaderButton label={`${n.name} notifications`} onPress={() => openNebulaSheet(c.id, n.id)}>
        <Icon name="bell" size={19} color={N.ink2} />
      </HeaderButton>
      <HeaderButton label={`Search ${c.name}`} onPress={() => router.push({ pathname: '/constellations/[cid]/search', params: { cid: c.id } })}>
        <Icon name="search" size={19} color={N.ink2} />
      </HeaderButton>
      <HeaderButton label={wide.membersShown ? 'Hide members' : 'Show members'} onPress={wide.toggleMembers} on={wide.membersShown}>
        <Icon name="friends" size={19} color={wide.membersShown ? N.amber : N.ink2} />
      </HeaderButton>
    </View>
  ) : (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(18,12,10,0.94)', borderBottomWidth: 1, borderBottomColor: N.line }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${c.name}`} onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/constellations/[cid]', params: { cid: c.id } }))} hitSlop={4} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevronLeft" size={24} color={N.ink} strokeWidth={2.2} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${n.name}, ${c.name}. Notifications`} onPress={() => openNebulaSheet(c.id, n.id)} style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <StarGlyph size={14} color={N.amber} />
          <Text size={17} weight="bold" numberOfLines={1} style={{ flexShrink: 1 }} accessibilityRole="header">
            {n.name}
          </Text>
          {isQuiet(n) ? <Icon name="bellOff" size={14} color={N.faint} /> : null}
          <PinsChip count={pinsApi.pins.length} onPress={() => setPinsOpen(true)} />
        </View>
        <Text size={12} numberOfLines={1} style={{ color: N.muted }}>
          {c.name} · {online} online
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={dmUnread ? `Your Glofly chats, ${dmUnread} unread` : 'Your Glofly chats'}
        onPress={() => openDmDock(false)}
        style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: N.edge, backgroundColor: N.raised, alignItems: 'center', justifyContent: 'center' }}
      >
        <FireflyMark size={22} />
        <CountBadge count={dmUnread} style={{ position: 'absolute', right: -3, top: -3 }} />
      </Pressable>
      <HeaderButton label={`Search ${c.name}`} onPress={() => router.push({ pathname: '/constellations/[cid]/search', params: { cid: c.id } })}>
        <Icon name="search" size={20} color={N.ink2} />
      </HeaderButton>
      <HeaderButton label="Members" onPress={() => router.push({ pathname: '/constellations/[cid]/members', params: { cid: c.id } })}>
        <Icon name="friends" size={20} color={N.ink2} />
      </HeaderButton>
    </View>
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: N.bg }} behavior={Platform.OS === 'ios' && !wide ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' && !wide ? stripH : 0}>
      {header}
      <ReconnectingStrip night />
      <GestureDetector gesture={membersSwipe}>
      <View style={{ flex: 1 }}>
        <FlatList
          ref={list}
          data={rows}
          inverted
          keyExtractor={(r) => r.message.id}
          contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10 }}
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadOlder(n.conversationId)}
          onScrollToIndexFailed={() => {}}
          ListHeaderComponent={
            <>
              {typingWho.length ? <TypingBubble userIds={typingWho} people={people} isGroup /> : null}
              {dropIn ? (
                <View style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: N.card, borderWidth: 1, borderColor: N.greenEdge }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(111,211,154,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                    <SpeakerGlyph size={20} color={N.greenText} waves={2} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text size={14} weight="bold" numberOfLines={1}>
                      {dropIn.nebula.name}
                    </Text>
                    <Text size={12} style={{ color: N.muted }} numberOfLines={1}>
                      {dropIn.count} in voice · drop in any time
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Join ${dropIn.nebula.name}`}
                    onPress={() => {
                      haptic.light()
                      void joinVoiceNebula({ constellationId: c.id, nebulaId: dropIn.nebula.id, nebulaName: dropIn.nebula.name, constellationName: c.name })
                    }}
                    style={{ height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: N.green, justifyContent: 'center' }}
                  >
                    <Text size={13} weight="bold" style={{ color: '#fff' }}>
                      Join
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          }
          ListFooterComponent={
            messages?.loading && messages.list.length ? (
              <View style={{ padding: 16 }}>
                <Spinner />
              </View>
            ) : messages?.loaded && !messages.hasMore ? (
              <View style={{ paddingTop: 28, paddingBottom: 12, gap: 6 }}>
                <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center' }}>
                  <StarGlyph size={24} color={N.amber} />
                </View>
                <Text display size={22}>
                  Welcome to #{n.name}
                </Text>
                <Text size={14} style={{ color: N.muted }}>
                  {n.topic || `This is the start of #${n.name} in ${c.name}.`}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={!messages?.loaded ? <View style={{ transform: [{ scaleY: -1 }] }}><Skeleton kind="messages" night /></View> : null}
          renderItem={renderRow}
          {...jumper.listProps}
        />
        <JumpToLatestButton visible={jumper.away} count={jumper.count} onPress={jumper.jump} night />
        {newSince && firstNew ? <NewSincePill info={newSince} onJump={() => void jumpTo(firstNew)} onMarkRead={() => setNewSince(null)} /> : null}
        <ChatFireflies conversationId={n.conversationId} meId={meId} nameOf={nameOf} />
      </View>
      </GestureDetector>

      {timedOut && c.me.timedOutUntil ? (
        <View accessibilityLiveRegion="polite" style={{ marginHorizontal: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: N.raised, borderWidth: 1, borderColor: N.edge2 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,179,71,0.14)', alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="timer" size={18} color={N.amber} />
          </View>
          <View style={{ flex: 1 }}>
            <Text size={14} weight="bold">
              You're timed out for {countdown(new Date(c.me.timedOutUntil).getTime() - now)}
            </Text>
            <Text size={12} style={{ color: N.ink2 }}>
              You can still read along. A moderator set this.
            </Text>
          </View>
        </View>
      ) : null}

      {blocked?.kind === 'readonly' ? (
        <View style={{ paddingTop: 14, paddingHorizontal: 16, paddingBottom: (wide ? 14 : insets.bottom) + 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: N.side, borderTopWidth: 1, borderTopColor: N.line }}>
          <Glyph name="lock" size={16} color={N.muted} />
          <Text size={14} style={{ color: N.muted }}>
            {blocked.text}
          </Text>
        </View>
      ) : timedOut ? (
        <View accessibilityLabel="Can't send messages right now" style={{ paddingTop: 10, paddingHorizontal: 12, paddingBottom: (wide ? 10 : insets.bottom) + 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderTopColor: N.line, opacity: 0.45 }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: N.card2 }} />
          <View style={{ flex: 1, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2, justifyContent: 'center' }}>
            <Text size={15} style={{ color: N.faint }}>
              Can't send messages right now
            </Text>
          </View>
        </View>
      ) : (
        <Composer
          ref={composer}
          placeholder={`Message #${n.name}`}
          people={others}
          mentionable
          reply={reply}
          replyName={reply ? (reply.senderId === meId ? 'yourself' : firstName(nameOf(reply.senderId))) : ''}
          editing={editing}
          onCancel={() => {
            setReply(null)
            setEditing(null)
          }}
          onSend={onSend}
          onTyping={() => sendTyping(n.conversationId)}
          onAttach={() => void plusMenu()}
          topSlot={
            <>
              <ScheduledStrip items={scheduled.items} onOpen={() => setScheduledOpen(true)} />
              <UploadTray uploads={uploads} />
            </>
          }
          onSendLater={uploads.items.length ? undefined : (t) => setLaterText(t)}
          onKeyState={setBoxKeys}
          canSendEmpty={uploads.items.length > 0}
          voice={voice.recording ? <VoiceRecorderBar voice={voice} /> : undefined}
          recordButton={<RecordButton voice={voice} />}
        />
      )}

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
      {scheduledOpen ? <ScheduledSheet conversationId={n.conversationId} items={scheduled.items} onChanged={scheduled.load} onClose={() => setScheduledOpen(false)} /> : null}
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
      {gifOpen ? (
        <GifSheet
          onPick={(g) => {
            setGifOpen(false)
            if (!g) return
            void api.sendGif(n.conversationId, g.id, reply?.id).then((r) => {
              setReply(null)
              if (r.ok) updateMessage(r.data)
              else cxSay(r.message)
            })
          }}
          onPickSticker={(st) => {
            setGifOpen(false)
            void api.sendSticker(st.id, n.conversationId, reply?.id).then((r) => {
              setReply(null)
              if (r.ok) updateMessage(r.data)
              else cxSay(r.message)
            })
          }}
        />
      ) : null}
      {pollOpen ? <PollSheet conversationId={n.conversationId} onDone={() => setPollOpen(false)} /> : null}
      {viewer ? <PhotoViewer state={viewer} messages={messages?.list} chatName={n.name} onShowInChat={(mid) => void jumpTo(mid)} onClose={() => setViewer(null)} /> : null}
      {searching ? (
        <SearchPanel
          chatId={n.conversationId}
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

function HeaderButton({ label, onPress, children, on }: { label: string; onPress: () => void; children: React.ReactNode; on?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={on === undefined ? undefined : { selected: on }} onPress={onPress} hitSlop={2} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? N.card2 : 'transparent' })}>
      {children}
    </Pressable>
  )
}

/** A row that knows where it is (its menu opens beside it). */
function HeldRow({
  item,
  c,
  meId,
  people,
  members,
  highlight,
  canAct,
  onMenu,
  onReact,
  onQuote,
  onFace,
  onPhoto,
}: {
  item: NebulaRowInfo
  c: ConstellationDetail
  meId: string
  people: Record<string, PublicUser>
  members: PublicUser[]
  highlight: boolean
  canAct: boolean
  onMenu: (m: Message, ref: RNView | null) => void
  onReact: (m: Message, e: string) => void
  onQuote: (id: string) => void
  onFace: (uid: string) => void
  onPhoto: (m: Message, i: number) => void
  memberIds: string[]
}) {
  const ref = useRef<RNView>(null)
  const m = item.message
  return (
    <View ref={ref} collapsable={false}>
      <NebulaRow
        row={item}
        meId={meId}
        sender={people[m.senderId] ?? c.members.find((x) => x.user.id === m.senderId)?.user}
        role={roleLook(c, m.senderId)}
        members={members}
        people={people}
        highlight={highlight}
        canAct={canAct}
        onLongPress={(msg) => onMenu(msg, ref.current)}
        onReact={onReact}
        onQuotePress={onQuote}
        onRetry={retryOrDiscard}
        onFacePress={onFace}
        onOpenPhoto={onPhoto}
      />
    </View>
  )
}

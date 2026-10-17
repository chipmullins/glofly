import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useWide } from '@/lib/layout'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Clipboard from 'expo-clipboard'
import {
  chatTitle,
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
import { loadLatest, loadOlder, loadUntil, markChatRead, updateMessage } from '@/state/sync'
import { SearchPanel } from '@/chat/SearchPanel'
import { chatMenu } from '@/lib/chatActions'
import { firstName } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { QUICK_REACTIONS } from '@/lib/emoji'
import { startCallIn, joinCallIn } from '@/calls/controller'
import { RingSomeSheet } from '@/calls/RingSome'
import { Composer, type ComposerHandle } from '@/chat/Composer'
import { MessageRow, type RowInfo } from '@/chat/MessageRow'
import { TypingBubble } from '@/chat/TypingBubble'
import { discard, isLocal, retry, sendText, setViewing, useOutbox } from '@/chat/send'
import { chatOpened } from '@/push'
import { attachMenu, UploadTray, useUploads } from '@/chat/uploads'
import { VoiceRecorderBar, RecordButton, useVoice } from '@/chat/voice'
import { PhotoViewer, type ViewerState } from '@/chat/PhotoViewer'
import { ChatFireflies, GAMES, GifSheet, LanternBar, PollSheet } from '@/chat/Extras'
import { BirthdayConfetti, GlowMark } from '@/ui/Social'
import { useSocial } from '@/state/social'
import { ChatAvatar } from '@/ui/Avatar'
import { BottomSheet, chooseFrom, confirm, inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { IconButton, Spinner, Text } from '@/ui/kit'
import { openReport, pickEmoji } from '@/ui/sheets'
import { useTheme } from '@/ui/theme'

/** A GIF, poll or game: its text is only the plain version for older apps. */
const special = (m: Message) => !!(m.gif || m.poll || m.game)

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const meId = useSession((s) => s.user?.id ?? '')
  const chat = useStore((s) => s.conversations[id])
  const messages = useStore((s) => s.messages[id])
  const people = useStore((s) => s.people)
  const presence = useStore((s) => (chat?.kind === 'dm' ? s.presence[chat.partner.id] : undefined))
  const allPresence = useStore((s) => s.presence)
  const typing = useStore((s) => s.typing[id])
  const call = useStore((s) => s.calls[id])
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
  const now = useNow(3000)
  const uploads = useUploads(id)
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
      })
    }
    return out.reverse()
  }, [messages?.list, meId, chat, outbox, isGroup])

  const memberIds = useMemo(() => [meId, ...members.map((p) => p.id)], [meId, members])
  const nameOf = (uid: string) => (uid === meId ? 'You' : (people[uid]?.displayName ?? 'Someone'))

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
    const pick = await attachMenu(uploads, [
      { key: 'gif', label: 'GIF or sticker', icon: 'gif' },
      ...(isGroup ? [{ key: 'poll', label: 'Poll', icon: 'poll' }] : []),
      { key: 'game', label: 'Play a game', icon: 'gamepad' },
      { key: 'lantern', label: lantern ? 'Lantern message (on)' : 'Lantern message', icon: 'lantern', detail: 'Fades away once it’s read', checked: lantern },
    ])
    if (pick === 'gif') setGifOpen(true)
    if (pick === 'poll') setPollOpen(true)
    if (pick === 'lantern') setLantern((on) => !on)
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

  if (!chat) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: insets.top }}>
        <Spinner />
        <Text tone="muted">Opening the chat…</Text>
      </View>
    )
  }

  const onlineCount = isGroup ? members.filter((m) => allPresence[m.id] && allPresence[m.id].status !== 'offline').length + 1 : 0
  const typingWho = typing ? Object.entries(typing).filter(([, until]) => until > now).map(([uid]) => uid) : []
  const subtitle = isGroup ? `${memberCountLabel(chat.memberCount)} · ${onlineCount} online` : presenceHeader(presence)
  const muted = isMuted(chat, now)
  const canMessage = chat.canMessage
  const inCall = call && (call.status === 'ongoing' || call.status === 'ringing')
  const iAmIn = inCall && call.members.find((m) => m.userId === meId)?.state === 'joined'
  // Groups of 3+ (0.5.2): a new call can ring only some of the group.
  const canRingSome = isGroup && !inCall && chat.memberCount > 2
  const ringSomeHint = canRingSome ? 'Long-press to choose who to ring' : undefined

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
            inCall && !iAmIn ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Join call" onPress={() => void joinCallIn(id, false)} style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, backgroundColor: c.online, justifyContent: 'center', marginRight: 4 }}>
                <Text size={14} weight="bold" style={{ color: '#FFFFFF' }}>
                  Join call
                </Text>
              </Pressable>
            ) : (
              <>
                {/* Groups (0.5.2): long-press to choose who to ring. */}
                <IconButton name="phone" label="Voice call" accessibilityHint={ringSomeHint} box={44} onPress={() => void startCallIn(id, false)} onLongPress={canRingSome ? () => setRingSome(true) : undefined} disabled={!!inCall} />
                <IconButton name="video" label="Video call" accessibilityHint={ringSomeHint} box={44} size={24} onPress={() => void startCallIn(id, true)} onLongPress={canRingSome ? () => setRingSome(true) : undefined} disabled={!!inCall} />
              </>
            )
          ) : null}
          <IconButton name="search" label="Search this chat" box={40} size={22} onPress={() => setSearching(true)} />
          <IconButton name="more" label="More options" box={40} onPress={() => void chatMenu(chat, { inChat: true, onRingSome: canRingSome ? () => setRingSome(true) : undefined })} />
        </View>
      </View>

      <View style={{ flex: 1 }}>
      <FlatList
        ref={list}
        data={rows}
        inverted
        keyExtractor={(r) => r.message.id}
        contentContainerStyle={{ paddingVertical: 10 }}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadOlder(id)}
        onScrollToIndexFailed={() => {}}
        ListHeaderComponent={typingWho.length ? <TypingBubble userIds={typingWho} people={people} isGroup={isGroup} /> : null}
        ListFooterComponent={
          messages?.loading && messages.list.length ? (
            <View style={{ padding: 16 }}>
              <Spinner />
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
        ListEmptyComponent={!messages?.loaded ? <View style={{ padding: 32, transform: [{ scaleY: -1 }] }}><Spinner /></View> : null}
        renderItem={({ item }) => (
          <MessageRow
            row={item}
            meId={meId}
            isGroup={isGroup}
            people={people}
            members={mentionable}
            highlight={highlight === item.message.id}
            onLongPress={(m) => !isLocal(m) && setActionsFor(m)}
            onReact={(m, e) => void react(m, e)}
            onQuotePress={(mid) => void jumpTo(mid)}
            onRetry={async (m) => {
              const pick = await chooseFrom([
                { key: 'retry', label: 'Try again', icon: 'refresh' },
                { key: 'discard', label: 'Delete it', icon: 'trash', danger: true },
              ])
              if (pick === 'retry') retry(m.id)
              if (pick === 'discard') discard(m.id)
            }}
            onAvatarPress={(uid) => router.push({ pathname: '/profile/[id]', params: { id: uid } })}
            onOpenPhoto={(m, index) => setViewer({ message: m, index })}
            canAct={canMessage}
            memberIds={memberIds}
          />
        )}
      />
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
              {lantern ? <LanternBar onOff={() => setLantern(false)} /> : null}
              <UploadTray uploads={uploads} />
            </>
          }
          canSendEmpty={uploads.items.length > 0}
          voice={voice.recording ? <VoiceRecorderBar voice={voice} /> : undefined}
          recordButton={<RecordButton voice={voice} />}
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
                { key: 'edit', label: 'Edit', icon: 'pencil' as const, show: actionsFor.senderId === meId && !!actionsFor.body && canMessage && !special(actionsFor) },
                { key: 'unpreview', label: 'Remove link preview', icon: 'link' as const, show: actionsFor.senderId === meId && !!actionsFor.linkPreview && canMessage },
                { key: 'delete', label: 'Delete', icon: 'trash' as const, show: actionsFor.senderId === meId, danger: true },
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
      {ringSome && canRingSome ? <RingSomeSheet chat={chat} onClose={() => setRingSome(false)} /> : null}
      {viewer ? <PhotoViewer state={viewer} onClose={() => setViewer(null)} /> : null}
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

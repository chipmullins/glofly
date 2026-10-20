import { shortBody } from '@glofly/shared/gifs'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  Attachment,
  ChatGameKind,
  ConversationSummary,
  FireflyEmoji,
  GifInfo,
  Message,
  MuteDuration,
  Presence,
  PublicUser,
  ReplyPreview,
  SignedInUser,
  Sticker
} from '../../../preload/api-types'
import { chatTitle, eventText, memberCountLabel, typingText } from '../lib/groups'
import GroupAvatar from './GroupAvatar'
import { onMobile, presenceHeader } from '../lib/presence'
import { clockTime, continuesGroup, dayLabel, isSameDay } from '../lib/time'
import Avatar, { AvatarFace } from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import { MessageAttachments, PhotoViewer, UploadTray, type Upload } from './Attachments'
import { attachmentSummary, looksLikeVideo } from '../lib/attachments'
import {
  CallLineIcon,
  FileIcon,
  BellIcon,
  BellOffIcon,
  GroupIcon,
  MoreIcon,
  PhoneIcon,
  ProfileIcon,
  SearchIcon,
  VideoIcon
} from './icons'
import CallPanel, { JoinCallBar, RingSomeDialog } from './CallPanel'
import { useCalls } from '../calls/callState'
import MessageItem, { type ShownMessage } from './MessageItem'
import {
  ClockIcon,
  PinnedMessagesIcon,
  PinsPanel,
  ScheduledPanel,
  ScheduledStrip,
  SendLaterMenu
} from './ChatTools'
import {
  markUnread as markUnreadApi,
  pins as pinsApi,
  scheduled as scheduledApi
} from '../lib/tools'
import type { PinnedMessage, ScheduledMessage } from '../../../preload/api-types'
import { PinIcon } from './ChatList'
import EmojiPicker from './EmojiPicker'
import EmojiText from './EmojiText'
import './ChatView.css'
import { BirthdayConfetti, BirthdayMark, GlowMark } from './Social'
import { useSocial } from '../lib/social'
import { glowLabel } from '@glofly/shared/social'
import {
  ChatFireflies,
  GameIcon,
  GameMenu,
  GifIcon,
  GifPicker,
  LanternIcon,
  NewPollDialog,
  PollIcon
} from './ChatExtras'
import { isShortcutKey, shortcutLabel } from '../lib/platform'
import { useVoiceRecorder, voiceTime, VOICE_MAX_MS, type Recorded } from '../lib/voice'
import { ChevronIcon, MicIcon, WatchIcon } from './icons'
import {
  isMuted,
  mentionQuery,
  mentionSuggestions,
  MUTE_CHOICES,
  mutedLabel
} from '../lib/mentions'

type ChatViewProps = {
  me: SignedInUser
  conversation: ConversationSummary
  /** Friends' statuses (DMs show the other person's in the header) */
  presence: Record<string, Presence>
  now: number
  /** Called after this chat is marked read, so the sidebar can clear its badge. */
  onRead: (conversationId: string) => void
  /** DMs: the other person's profile. Groups: anyone's (from their avatar). */
  onViewProfile: (user: PublicUser) => void
  /** Groups: rename, members, add people, leave */
  onGroupSettings: () => void
  /** Pins or unpins this chat in the sidebar */
  onTogglePin: () => void
  onSessionExpired: () => void
  /** Opens message search for this chat (header button, Ctrl+F) */
  onSearch: () => void
  /** A message to scroll to and highlight (from search); nonce makes the same one jump again */
  jumpRequest: { messageId: string; nonce: number } | null
  /** Mutes this chat for a while (null unmutes) */
  onMute: (duration: MuteDuration | null) => void
  /** Report someone else's message */
  onReport?: (message: Message) => void
  /** 2.0: this chat is a constellation's nebula (its own header, role badges, moderators) */
  nebula?: NebulaMode
  /** 0.7.3: after "Mark unread", leave the chat (so it isn't read again straight away) */
  onLeave?: () => void
}

/** How a nebula's chat differs from a group chat (2.0, Constellation.dc.html). */
export type NebulaMode = {
  name: string
  topic: string | null
  /** Why you can't post here (timed out, read-only), or null when you can */
  cantPost: string | null
  /** Someone's role badge and name color (null for plain members) */
  roleOf: (
    userId: string
  ) => { name: string; light: string; badgeBg: string; badgeText: string } | null
  /** Can I delete this person's messages (moderators, people ranked lower) */
  canDelete: (senderId: string) => boolean
  membersOpen: boolean
  onToggleMembers: () => void
  /** More header buttons (notifications) */
  headerExtra?: React.ReactNode
  /** Voice nebulas with people in them: a message naming one gets its Join card */
  voiceCards: { name: string; line: string; onJoin: (() => void) | null }[]
}

/** A message still on its way, or one that didn't send. */
type Pending = {
  tempId: string
  body: string
  createdAt: string
  failed: boolean
  replyTo: ReplyPreview | null
  attachments: Attachment[]
  /** 0.5.0: fades once everyone else has read it */
  lantern: boolean
}

const TYPING_SEND_EVERY_MS = 3000 // how often we tell the other person we're typing
const TYPING_SHOW_FOR_MS = 4500 // how long "is typing…" stays after their last keystroke
const MESSAGE_MAX = 4000
/** 0.7.3 long chats: messages drawn at first, and how many more each time you reach the top */
const WINDOW = 150
const WINDOW_STEP = 100
const FILES_PER_MESSAGE = 10
const FILE_MAX_BYTES = 25 * 1024 * 1024
const VIDEO_MAX_BYTES = 64 * 1024 * 1024

function SendIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  )
}

/** A message naming a busy voice nebula ("…in Campfire right now") gets its Join card. */
function voiceCardFor(nebula: NebulaMode, body: string): React.ReactNode {
  const lower = body.toLowerCase()
  const card = nebula.voiceCards.find((v) =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(v.name.toLowerCase())}($|[^\\p{L}\\p{N}])`,
      'u'
    ).test(lower)
  )
  if (!card) return null
  return (
    <div className="cx-voice-card">
      <span className="cx-voice-card-mark" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#ffb347"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 10v4h4l5 4V6L8 10H4z" />
          <path d="M16.5 9a4 4 0 0 1 0 6" />
        </svg>
      </span>
      <span className="cx-voice-card-text">
        <strong>
          <EmojiText text={card.name} />
        </strong>
        <span>{card.line}</span>
      </span>
      {card.onJoin && (
        <button type="button" className="cx-voice-card-join" onClick={card.onJoin}>
          Join
        </button>
      )}
    </div>
  )
}

const escapeRegExp = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Applies a changed message to the list: the message itself, and any replies quoting it
 * (so deleting or editing a message updates its quotes right away too).
 */
function applyUpdate(list: Message[], m: Message): Message[] {
  return list.map((x) => {
    if (x.id === m.id) return m
    if (x.replyTo?.id === m.id) {
      return { ...x, replyTo: { ...x.replyTo, body: m.body.slice(0, 200), deleted: m.deleted } }
    }
    return x
  })
}

const preview = (m: Message): ReplyPreview => ({
  id: m.id,
  senderId: m.senderId,
  body: m.body.slice(0, 200),
  deleted: m.deleted,
  attachment: m.attachments[0]
    ? {
        kind: m.attachments[0].kind,
        name: m.attachments[0].name,
        count: m.attachments.length,
        voice: !!m.attachments[0].voice
      }
    : null
})

/** Short text for a message: its words, or "Photo" / the file name if it has none. */
const textOf = (m: Pick<Message, 'body' | 'attachments'>): string =>
  shortBody(m.body) || attachmentSummary(m.attachments)

function TrashIcon(): React.JSX.Element {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  )
}

function EmojiIcon(): React.JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" />
      <path d="M9 9.5h.01M15 9.5h.01" />
    </svg>
  )
}

function AttachIcon(): React.JSX.Element {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** The + menu opens above its button, lined up with its left edge. */
function plusMenuPlace(anchor: HTMLElement): React.CSSProperties {
  const rect = anchor.getBoundingClientRect()
  return {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 258)),
    bottom: window.innerHeight - rect.top + 8
  }
}

export default function ChatView({
  me,
  conversation,
  presence,
  now,
  onRead,
  onViewProfile,
  onGroupSettings,
  onTogglePin,
  onSessionExpired,
  onSearch,
  jumpRequest,
  onMute,
  onReport,
  nebula,
  onLeave
}: ChatViewProps): React.JSX.Element {
  const partner = conversation.partner
  const isGroup = conversation.kind === 'group'
  const social = useSocial()
  const calls = useCalls()
  const inThisCall = calls.current?.conversationId === conversation.id
  // One call at a time. 1-on-1: friends only. Groups: anyone in it (joins a call going on).
  const canCall = conversation.canMessage && conversation.memberCount > 1 && !calls.current
  const groupCallOn = isGroup && !!calls.callIn(conversation.id)
  const callTitle = (kind: 'Voice' | 'Video'): string =>
    calls.current && !inThisCall
      ? "You're already in a call"
      : groupCallOn
        ? `Join the ${kind.toLowerCase()} call`
        : `${kind} call`
  /** Groups (0.5.2): picking who a new call rings */
  const [ringSome, setRingSome] = useState(false)
  const partnerPresence = partner ? presence[partner.id] : undefined
  const title = chatTitle(conversation)
  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  /** Who's typing right now (several people at once in a group) */
  const [typingIds, setTypingIds] = useState<string[]>([])
  /** Everyone messages here mention, including people who've left a group */
  const [formerPeople, setFormerPeople] = useState<Record<string, PublicUser>>({})
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [viewing, setViewing] = useState<{ photos: Attachment[]; index: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  /** Typing "@ma" in a group: who to suggest, and which one the arrow keys are on */
  const [mention, setMention] = useState<{ query: string; start: number; index: number } | null>(
    null
  )
  /** The header's mute menu */
  const [muteOpen, setMuteOpen] = useState(false)
  /** 0.7.4: the ⋯ More menu in the header */
  const [moreOpen, setMoreOpen] = useState(false)
  const muteRef = useRef<HTMLDivElement>(null)
  /** The 😊 button, while the emoji picker it opened is showing */
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)
  /** Where the cursor goes after an emoji is added (applied once the text updates). */
  const cursorAfterInsert = useRef<number | null>(null)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 0.5.0: the + menu, GIFs, polls, games and lantern messages.
  const [plusAnchor, setPlusAnchor] = useState<HTMLElement | null>(null)
  const [gameAnchor, setGameAnchor] = useState<HTMLElement | null>(null)
  const [gifAnchor, setGifAnchor] = useState<HTMLElement | null>(null)
  const [pollOpen, setPollOpen] = useState(false)
  const [lantern, setLantern] = useState(false)
  const plusRef = useRef<HTMLButtonElement>(null)
  const plusMenuRef = useRef<HTMLDivElement>(null)
  const closeGifs = useCallback(() => setGifAnchor(null), [])
  const closeGames = useCallback(() => setGameAnchor(null), [])
  const uploadsRef = useRef<Upload[]>([])
  const chatOpen = useRef(true)
  // ---- 0.7.3: pins, mark unread, send later ----
  const [pinList, setPinList] = useState<PinnedMessage[]>([])
  const [canPin, setCanPin] = useState(false)
  const [pinsOpen, setPinsOpen] = useState(false)
  const [laterList, setLaterList] = useState<ScheduledMessage[]>([])
  const [laterOpen, setLaterOpen] = useState(false)
  const [laterMenu, setLaterMenu] = useState<{ x: number; y: number } | null>(null)
  /** A jump from the pins panel (same as one from search) */
  const [localJump, setLocalJump] = useState<{ messageId: string; nonce: number } | null>(null)
  /** "Mark unread": this chat isn't marked read again until it's opened again */
  const holdRead = useRef(false)
  /** Long chats: how many of the newest messages are drawn (grows as you scroll up) */
  const [windowSize, setWindowSize] = useState(WINDOW)
  const windowStartRef = useRef(0)
  const windowSizeRef = useRef(WINDOW)
  /** A jump is drawing a long way back: don't shrink the window meanwhile */
  const drawingBackUntil = useRef(0)
  windowSizeRef.current = windowSize
  const shownCount = useRef(0)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const keepScrollFrom = useRef<number | null>(null)
  const lastTypingSent = useRef(0)
  const typingTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const tempCounter = useRef(0)

  /** A person in this chat (or who used to be), for names and avatars. */
  const personOf = useCallback(
    (userId: string): PublicUser | null =>
      userId === me.id
        ? me
        : (conversation.members.find((m) => m.id === userId) ?? formerPeople[userId] ?? null),
    [me, conversation.members, formerPeople]
  )
  // Groups: everyone who can be @mentioned (you too, so your own name shows as a mention).
  const mentionPeople = isGroup ? [me, ...conversation.members] : []
  const memberIds = [me.id, ...conversation.members.map((p) => p.id)]
  const suggestions =
    mention && isGroup ? mentionSuggestions(mention.query, conversation.members) : []
  const nameOf = useCallback(
    (userId: string) => personOf(userId)?.displayName ?? 'Former member',
    [personOf]
  )
  const rememberPeople = useCallback((people: PublicUser[] | undefined) => {
    if (!people?.length) return
    setFormerPeople((map) => {
      const next = { ...map }
      for (const p of people) next[p.id] = p
      return next
    })
  }, [])
  const stopTyping = useCallback((userId: string) => {
    const timer = typingTimers.current.get(userId)
    if (timer) clearTimeout(timer)
    typingTimers.current.delete(userId)
    setTypingIds((ids) => (ids.includes(userId) ? ids.filter((id) => id !== userId) : ids))
  }, [])

  // The latest callbacks from the parent, so a parent passing new functions on every render (a
  // nebula's chat in Constellations) doesn't reload the messages each time.
  const parentCallbacks = useRef({ onRead, onSessionExpired })
  useEffect(() => {
    parentCallbacks.current = { onRead, onSessionExpired }
  })

  const handleFailure = useCallback((error: string, message: string) => {
    if (error === 'unauthorized') parentCallbacks.current.onSessionExpired()
    else setNotice(message)
  }, [])

  /** Puts the newest version of a message in the list. */
  const upsert = useCallback((m: Message) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? applyUpdate(list, m) : [...list, m]))
  }, [])

  // Mark read when the window is in front and this chat is open.
  const markRead = useCallback(async () => {
    if (!document.hasFocus() || holdRead.current) return
    const result = await window.glofly.conversations.markRead(conversation.id)
    if (result.ok) parentCallbacks.current.onRead(conversation.id)
  }, [conversation.id])

  // Load the newest messages.
  useEffect(() => {
    let cancelled = false
    window.glofly.conversations.messages(conversation.id).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) return handleFailure(result.error, result.message)
      stickToBottom.current = true
      // Messages that arrived live while this was loading stay (the answer may predate them).
      const loaded = result.data.messages
      setMessages((live) => {
        const ids = new Set(loaded.map((m) => m.id))
        return [...loaded, ...live.filter((m) => !ids.has(m.id))]
      })
      setHasMore(result.data.hasMore)
      rememberPeople(result.data.people)
      void markRead()
    })
    inputRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [conversation.id, handleFailure, markRead, rememberPeople])

  // Live updates: new messages, edits/deletes/reactions, and typing.
  useEffect(() => {
    return window.glofly.onEvent((event) => {
      if (event.type === 'message:new' && event.message.conversationId === conversation.id) {
        const m = event.message
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
        rememberPeople(event.people)
        if (m.senderId !== me.id) {
          stopTyping(m.senderId)
          void markRead()
        }
      }
      if (event.type === 'message:updated' && event.message.conversationId === conversation.id) {
        const m = event.message
        setMessages((list) => applyUpdate(list, m))
        // A deleted message can't stay quoted in the reply bar or keep an edit box open.
        if (m.deleted) {
          setReplyingTo((r) => (r?.id === m.id ? null : r))
          setEditingId((id) => (id === m.id ? null : id))
        }
      }
      if (
        event.type === 'typing' &&
        event.conversationId === conversation.id &&
        event.userId !== me.id
      ) {
        // Show "is typing…", and hide it a few seconds after their last keystroke.
        const userId = event.userId
        setTypingIds((ids) => (ids.includes(userId) ? ids : [...ids, userId]))
        const old = typingTimers.current.get(userId)
        if (old) clearTimeout(old)
        typingTimers.current.set(
          userId,
          setTimeout(() => stopTyping(userId), TYPING_SHOW_FOR_MS)
        )
      }
    })
  }, [conversation.id, me.id, markRead, rememberPeople, stopTyping])

  useEffect(() => {
    const timers = typingTimers.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
    }
  }, [])

  // Someone typing who's no longer in the group (or a removed name) stops showing.
  const typingNames = typingIds
    .filter((id) => conversation.members.some((m) => m.id === id))
    .map((id) => nameOf(id))
  const someoneTyping = typingNames.length > 0

  // Coming back to the window counts as reading.
  useEffect(() => {
    const onFocus = (): void => void markRead()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [markRead])

  // Keep the view pinned to the newest message, or steady while older ones load above.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    if (keepScrollFrom.current !== null) {
      list.scrollTop += list.scrollHeight - keepScrollFrom.current
      keepScrollFrom.current = null
    } else if (stickToBottom.current) {
      list.scrollTop = list.scrollHeight
    }
  }, [messages, pending, someoneTyping, replyingTo, conversation.partnerReadAt, windowSize])

  async function loadOlder(): Promise<void> {
    if (loadingOlder || !hasMore || messages.length === 0) return
    setLoadingOlder(true)
    const result = await window.glofly.conversations.messages(conversation.id, messages[0].id)
    setLoadingOlder(false)
    if (!result.ok) return handleFailure(result.error, result.message)
    keepScrollFrom.current = listRef.current?.scrollHeight ?? null
    setMessages((list) => [
      ...result.data.messages.filter((m) => !list.some((x) => x.id === m.id)),
      ...list
    ])
    // The older ones show too (the window counts from the newest).
    setWindowSize((w) => w + result.data.messages.length)
    setHasMore(result.data.hasMore)
    rememberPeople(result.data.people)
  }

  function onScroll(): void {
    const list = listRef.current
    if (!list) return
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120
    // Back at the newest: what's far above stops being drawn (it's still loaded).
    if (
      stickToBottom.current &&
      windowSizeRef.current > WINDOW * 2 &&
      Date.now() > drawingBackUntil.current
    )
      setWindowSize(WINDOW)
    if (list.scrollTop < 80) {
      // Loaded but not drawn yet: draw more first; only then ask the server for older ones.
      if (windowStartRef.current > 0) {
        if (keepScrollFrom.current === null) {
          keepScrollFrom.current = list.scrollHeight
          setWindowSize((w) => w + WINDOW_STEP)
        }
      } else void loadOlder()
    }
  }

  async function deliver(item: Pending): Promise<void> {
    const result = await window.glofly.conversations.send(
      conversation.id,
      item.body,
      item.replyTo?.id,
      item.attachments.map((a) => a.id),
      item.lantern ? { lantern: true } : undefined
    )
    if (result.ok) {
      const sent = result.data
      setPending((p) => p.filter((x) => x.tempId !== item.tempId))
      setMessages((list) => (list.some((x) => x.id === sent.id) ? list : [...list, sent]))
      setNotice(null)
    } else {
      setPending((p) => p.map((x) => (x.tempId === item.tempId ? { ...x, failed: true } : x)))
      handleFailure(result.error, result.message)
    }
  }

  // Leaving the chat with files still in the box: tidy them away on the server.
  useEffect(() => {
    uploadsRef.current = uploads
  })
  useEffect(() => {
    chatOpen.current = true
    return () => {
      chatOpen.current = false
      for (const u of uploadsRef.current) {
        if (u.attachment)
          void window.glofly.conversations.removeUpload(conversation.id, u.attachment.id)
      }
    }
  }, [conversation.id])

  const uploading = uploads.some((u) => u.status === 'uploading')
  const readyFiles = uploads.flatMap((u) =>
    u.status === 'ready' && u.attachment ? [u.attachment] : []
  )
  const canSend = !uploading && (draft.trim().length > 0 || readyFiles.length > 0)

  // Voice messages: click the mic to record (then send or cancel), or hold it and let go to
  // send. While holding, sliding left or Escape cancels.
  const recorder = useVoiceRecorder(
    (r) => void sendVoice(r),
    (message) => setNotice(message)
  )
  const recording = recorder.state !== 'idle'
  const hold = useRef<{ x: number; at: number } | null>(null)
  /** A press on the mic while recording in click mode: letting go sends it. */
  const sendPress = useRef(false)
  const [holding, setHolding] = useState(false)
  const [slid, setSlid] = useState(0)
  const SLIDE_TO_CANCEL = 90

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      hold.current = null
      setHolding(false)
      setSlid(0)
      recorder.cancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, recorder])

  function micDown(e: React.PointerEvent<HTMLButtonElement>): void {
    if (e.button !== 0 || !conversation.canMessage) return
    if (recording && !holding) {
      sendPress.current = true // clicked to record earlier: this click sends it
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    hold.current = { x: e.clientX, at: Date.now() }
    setHolding(true)
    setSlid(0)
    recorder.start()
  }

  function micMove(e: React.PointerEvent<HTMLButtonElement>): void {
    const h = hold.current
    if (!h) return
    const dx = Math.max(0, h.x - e.clientX)
    setSlid(dx)
    if (dx >= SLIDE_TO_CANCEL) {
      hold.current = null
      setHolding(false)
      setSlid(0)
      recorder.cancel()
    }
  }

  function micUp(): void {
    if (sendPress.current) {
      sendPress.current = false
      recorder.finish()
      return
    }
    const h = hold.current
    if (!h) return
    hold.current = null
    setHolding(false)
    setSlid(0)
    // A quick click keeps recording until Send (or cancel); holding sends when let go.
    if (Date.now() - h.at >= 400) recorder.finish()
  }

  async function sendVoice(r: Recorded): Promise<void> {
    if (!chatOpen.current || !conversation.canMessage) return
    const replyTo = replyingTo ? preview(replyingTo) : null
    setReplyingTo(null)
    const up = await window.glofly.conversations.upload(
      conversation.id,
      r.data,
      r.type === 'audio/mp4' ? 'Voice message.m4a' : 'Voice message.webm',
      r.voice
    )
    if (!up.ok) return handleFailure(up.error, up.message)
    tempCounter.current += 1
    const item: Pending = {
      tempId: `pending-${tempCounter.current}`,
      body: '',
      createdAt: new Date().toISOString(),
      failed: false,
      replyTo,
      attachments: [up.data],
      lantern: false
    }
    stickToBottom.current = true
    setPending((p) => [...p, item])
    void deliver(item)
  }

  function send(): void {
    const body = draft.trim()
    if (!canSend || !conversation.canMessage) return
    if (body.length > MESSAGE_MAX) {
      setNotice(`Messages can be up to ${MESSAGE_MAX.toLocaleString()} characters.`)
      return
    }
    tempCounter.current += 1
    const item: Pending = {
      tempId: `pending-${tempCounter.current}`,
      body,
      createdAt: new Date().toISOString(),
      failed: false,
      replyTo: replyingTo ? preview(replyingTo) : null,
      attachments: readyFiles,
      lantern
    }
    stickToBottom.current = true
    setPending((p) => [...p, item])
    setDraft('')
    setMention(null)
    setReplyingTo(null)
    setUploads([]) // sent ones go with the message; failed ones are dropped
    setLantern(false) // one lantern at a time
    void deliver(item)
  }

  // ---- 0.5.0 extras ----

  async function sendGif(gif: GifInfo): Promise<void> {
    setGifAnchor(null)
    const replyTo = replyingTo
    setReplyingTo(null)
    stickToBottom.current = true
    const result = await window.glofly.chat.sendGif(conversation.id, gif.id, replyTo?.id)
    if (result.ok) {
      upsert(result.data)
      setNotice(null)
    } else handleFailure(result.error, result.message)
    inputRef.current?.focus()
  }

  async function sendSticker(sticker: Sticker): Promise<void> {
    setGifAnchor(null)
    const replyTo = replyingTo
    setReplyingTo(null)
    stickToBottom.current = true
    const result = await window.glofly.stickers.send(sticker.id, conversation.id, replyTo?.id)
    if (result.ok) upsert(result.data)
    else handleFailure(result.error, result.message)
    inputRef.current?.focus()
  }

  async function createPoll(question: string, options: string[], multi: boolean): Promise<boolean> {
    stickToBottom.current = true
    const result = await window.glofly.chat.createPoll(conversation.id, question, options, multi)
    if (result.ok) upsert(result.data)
    else handleFailure(result.error, result.message)
    return result.ok
  }

  async function startGame(kind: ChatGameKind): Promise<void> {
    setGameAnchor(null)
    stickToBottom.current = true
    const result = await window.glofly.chat.startGame(conversation.id, kind)
    if (result.ok) upsert(result.data)
    else handleFailure(result.error, result.message)
  }

  /** Long-press ❤️ or 🔥: the reaction stays on (never toggled off), and fireflies fly. */
  async function sendFireflies(m: Message, emoji: FireflyEmoji): Promise<void> {
    if (!conversation.canMessage) return
    const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(me.id) ?? false
    const [reacted, flew] = await Promise.all([
      mine ? null : window.glofly.conversations.react(conversation.id, m.id, emoji, true),
      window.glofly.chat.fireflies(conversation.id, emoji)
    ])
    if (reacted?.ok) upsert(reacted.data)
    else if (reacted) handleFailure(reacted.error, reacted.message)
    if (!flew.ok) handleFailure(flew.error, flew.message)
  }

  async function removePreview(m: Message): Promise<void> {
    const result = await window.glofly.chat.removePreview(conversation.id, m.id)
    if (result.ok) upsert(result.data)
    else handleFailure(result.error, result.message)
  }

  // The + menu closes when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!plusAnchor) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (!plusMenuRef.current?.contains(t) && !plusAnchor.contains(t)) setPlusAnchor(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPlusAnchor(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [plusAnchor])

  // A new chat starts without a lantern lit.
  const [lanternFor, setLanternFor] = useState(conversation.id)
  if (lanternFor !== conversation.id) {
    setLanternFor(conversation.id)
    setLantern(false)
  }

  /** Adds files to the message box and starts uploading them right away. */
  function addFiles(files: File[]): void {
    if (!conversation.canMessage || files.length === 0) return
    const room = FILES_PER_MESSAGE - uploads.length
    if (files.length > room) {
      setNotice(`You can send up to ${FILES_PER_MESSAGE} files at a time.`)
      files = files.slice(0, Math.max(0, room))
    }
    for (const file of files) {
      tempCounter.current += 1
      const upload: Upload = {
        localId: `upload-${tempCounter.current}`,
        name: file.name || 'Pasted image',
        size: file.size,
        looksLikePhoto: file.type.startsWith('image/') && file.type !== 'image/svg+xml',
        status: 'uploading',
        attachment: null,
        error: null
      }
      const fail = (error: string): Upload => ({ ...upload, status: 'failed', error })
      if (file.size === 0) {
        setUploads((list) => [...list, fail('This file is empty.')])
        continue
      }
      // Videos (0.5.0) can be bigger and play right in the chat.
      const video = file.type.startsWith('video/') || looksLikeVideo(upload.name)
      if (file.size > (video ? VIDEO_MAX_BYTES : FILE_MAX_BYTES)) {
        setUploads((list) => [
          ...list,
          fail(video ? 'Too big. Videos can be up to 64 MB.' : 'Too big. Files can be up to 25 MB.')
        ])
        continue
      }
      setUploads((list) => [...list, upload])
      void (async () => {
        let result: Awaited<ReturnType<typeof window.glofly.conversations.upload>>
        try {
          result = await window.glofly.conversations.upload(
            conversation.id,
            await file.arrayBuffer(),
            upload.name
          )
        } catch {
          result = { ok: false, error: 'invalid', message: "Couldn't read this file." }
        }
        if (!result.ok && result.error === 'unauthorized') return onSessionExpired()
        const done: Upload = result.ok
          ? { ...upload, status: 'ready', attachment: result.data }
          : fail(result.message)
        // Removed (or the chat closed) while it was uploading: remove it from the server too.
        const stillWanted =
          chatOpen.current && uploadsRef.current.some((u) => u.localId === upload.localId)
        if (!stillWanted) {
          if (result.ok)
            void window.glofly.conversations.removeUpload(conversation.id, result.data.id)
          return
        }
        setUploads((list) => list.map((u) => (u.localId === upload.localId ? done : u)))
      })()
    }
    inputRef.current?.focus()
  }

  function removeUpload(localId: string): void {
    const upload = uploads.find((u) => u.localId === localId)
    setUploads((list) => list.filter((u) => u.localId !== localId))
    if (upload?.attachment)
      void window.glofly.conversations.removeUpload(conversation.id, upload.attachment.id)
    inputRef.current?.focus()
  }

  // Dragging files onto the chat.
  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')
  function onDragEnter(e: React.DragEvent): void {
    if (!hasFiles(e) || !conversation.canMessage) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  function onDragOver(e: React.DragEvent): void {
    if (!hasFiles(e) || !conversation.canMessage) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  function onDragLeave(e: React.DragEvent): void {
    if (!hasFiles(e)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files))
  }

  // Pasting a screenshot or copied file.
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>): void {
    const files = Array.from(e.clipboardData.files)
    if (files.length === 0) return
    e.preventDefault()
    addFiles(files)
  }

  function retry(tempId: string): void {
    const item = pending.find((x) => x.tempId === tempId)
    if (!item) return
    setPending((p) => p.map((x) => (x.tempId === tempId ? { ...x, failed: false } : x)))
    void deliver({ ...item, failed: false })
  }

  async function saveEdit(m: Message, body: string): Promise<void> {
    const trimmed = body.trim()
    setEditingId(null)
    inputRef.current?.focus()
    // Text can only be cleared from a message that has photos or files.
    if ((!trimmed && m.attachments.length === 0) || trimmed === m.body) return
    upsert({ ...m, body: trimmed, editedAt: new Date().toISOString() }) // show it right away
    const result = await window.glofly.conversations.edit(conversation.id, m.id, trimmed)
    if (result.ok) upsert(result.data)
    else {
      upsert(m) // put the original back
      handleFailure(result.error, result.message)
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleting) return
    const m = deleting
    setDeleting(null)
    const result = await window.glofly.conversations.remove(conversation.id, m.id)
    if (result.ok) upsert(result.data)
    else handleFailure(result.error, result.message)
  }

  async function toggleReaction(m: Message, emoji: string): Promise<void> {
    if (!conversation.canMessage) return
    const mine = m.reactions.find((r) => r.emoji === emoji)?.userIds.includes(me.id) ?? false
    const result = await window.glofly.conversations.react(conversation.id, m.id, emoji, !mine)
    if (result.ok) upsert(result.data)
    else handleFailure(result.error, result.message)
  }

  function startReply(m: Message): void {
    setReplyingTo(m)
    setEditingId(null)
    inputRef.current?.focus()
  }

  /** Scrolls to the original message of a reply and briefly highlights it. */
  function jumpTo(messageId: string): void {
    const el = listRef.current?.querySelector(`[data-message-id="${messageId}"]`)
    if (!el) {
      setNotice('That message is further back. Scroll up to load it.')
      return
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(messageId)
    setTimeout(() => setHighlightId((id) => (id === messageId ? null : id)), 1600)
  }

  // Jumping to a search result: load older messages until it's here (up to ~2,000 back),
  // then scroll to it and highlight it.
  const messagesRef = useRef(messages)
  const hasMoreRef = useRef(hasMore)
  useEffect(() => {
    messagesRef.current = messages
    hasMoreRef.current = hasMore
  }, [messages, hasMore])
  const revealing = useRef(0)
  // The newest jump asked for: from search (the parent) or from the pins panel.
  // (A new search jump replaces a pins jump, worked out while drawing rather than in an effect.)
  const [seenJumpRequest, setSeenJumpRequest] = useState(jumpRequest)
  if (jumpRequest !== seenJumpRequest) {
    setSeenJumpRequest(jumpRequest)
    setLocalJump(null)
  }
  const activeJump = localJump ?? jumpRequest
  useEffect(() => {
    if (!activeJump || loading) return
    const attempt = ++revealing.current
    const id = activeJump.messageId
    const nextFrame = (): Promise<void> =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    void (async () => {
      // 0.7.3: up to ~3,000 back (pins can be old). Pages only load here; drawing waits.
      for (let page = 0; page < 120; page++) {
        if (attempt !== revealing.current) return // another jump started
        // Loaded but outside the drawn window: draw back to it first.
        const at = messagesRef.current.findIndex((m) => m.id === id)
        if (at >= 0 && at < windowStartRef.current) {
          // Not "at the newest" any more, so the window isn't shrunk back while drawing.
          stickToBottom.current = false
          drawingBackUntil.current = Date.now() + 8000
          const need = shownCount.current - at + 20
          setWindowSize((w) => Math.max(w, need))
          // Drawing a long way back can take a moment: wait for it (up to ~5 seconds).
          for (let f = 0; f < 150; f++) {
            await nextFrame()
            if (attempt !== revealing.current) return
            if (listRef.current?.querySelector(`[data-message-id="${id}"]`)) break
          }
        }
        const el = listRef.current?.querySelector(`[data-message-id="${id}"]`)
        if (el) {
          stickToBottom.current = false
          el.scrollIntoView({ behavior: page === 0 ? 'smooth' : 'auto', block: 'center' })
          setHighlightId(id)
          setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 2400)
          return
        }
        const oldest = messagesRef.current[0]
        if (!hasMoreRef.current || !oldest) break
        const result = await window.glofly.conversations.messages(conversation.id, oldest.id)
        if (!result.ok) break
        setMessages((list) => [
          ...result.data.messages.filter((m) => !list.some((x) => x.id === m.id)),
          ...list
        ])
        // (Not drawn yet: only once it's found, everything from it down is drawn.)
        setHasMore(result.data.hasMore)
        rememberPeople(result.data.people)
        await nextFrame()
      }
      if (attempt === revealing.current)
        setNotice("Couldn't find that message. It may have been deleted.")
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per jump request
  }, [activeJump, loading])

  // Long chats: a new chat starts with the newest WINDOW drawn. New messages arriving while
  // you're reading further up don't push what you're reading out of the drawn window.
  const [windowChat, setWindowChat] = useState(conversation.id)
  if (windowChat !== conversation.id) {
    setWindowChat(conversation.id)
    setWindowSize(WINDOW)
  }
  const lastCount = useRef(0)
  useEffect(() => {
    const n = messages.length + pending.length
    const added = n - lastCount.current
    lastCount.current = n
    if (added > 0 && added < 25 && !stickToBottom.current) setWindowSize((w) => w + added)
  }, [messages.length, pending.length])

  // 0.7.3: this chat's pins and my messages waiting to be sent, kept up to date live.
  const loadPins = useCallback(() => {
    void pinsApi.list(conversation.id).then((r) => {
      if (!r.ok) return
      setPinList(r.data.pins)
      setCanPin(r.data.canPin)
    })
  }, [conversation.id])
  const loadLater = useCallback(() => {
    void scheduledApi.list(conversation.id).then((r) => r.ok && setLaterList(r.data.scheduled))
  }, [conversation.id])
  useEffect(() => {
    holdRead.current = false
    loadPins()
    loadLater()
    return window.glofly.onEvent((event) => {
      if (event.type === 'pins:changed' && event.conversationId === conversation.id) loadPins()
      if (event.type === 'scheduled:changed' && event.conversationId === conversation.id)
        loadLater()
      if (event.type === 'connection' && event.connected) {
        loadPins()
        loadLater()
      }
    })
  }, [conversation.id, loadPins, loadLater])
  const pinnedIds = new Set(pinList.map((p) => p.message.id))

  async function setPinned(m: Message, pin: boolean): Promise<void> {
    const r = await pinsApi.set(conversation.id, m.id, pin)
    if (!r.ok) return handleFailure(r.error, r.message)
    setPinList(r.data.pins)
  }

  async function markUnreadFrom(m: Message): Promise<void> {
    holdRead.current = true
    const r = await markUnreadApi(conversation.id, m.id)
    if (!r.ok) {
      holdRead.current = false
      return handleFailure(r.error, r.message)
    }
    onLeave?.()
  }

  /** Send later: the text in the box (and the reply), at that time. */
  async function sendLater(at: Date): Promise<void> {
    setLaterMenu(null)
    const body = draft.trim()
    if (!body) {
      setNotice('Type a message first, then pick when to send it.')
      return
    }
    const r = await scheduledApi.add(conversation.id, body, at, replyingTo?.id ?? null)
    if (!r.ok) return handleFailure(r.error, r.message)
    setDraft('')
    setReplyingTo(null)
    setMention(null)
    setLaterList((list) =>
      [...list.filter((x) => x.id !== r.data.scheduled.id), r.data.scheduled].sort((a, b) =>
        a.sendAt.localeCompare(b.sendAt)
      )
    )
  }
  const laterBlocked =
    uploads.length > 0
      ? 'Send later works for text only. Send or remove the files first.'
      : lantern
        ? "Lantern messages can't be scheduled."
        : null

  // Ctrl+F (⌘F on a Mac) searches this chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isShortcutKey(e) && !e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        onSearch()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSearch])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // "@" suggestions: arrows move, Enter or Tab picks, Escape closes.
    if (mention && suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const step = e.key === 'ArrowDown' ? 1 : -1
        setMention({
          ...mention,
          index: (mention.index + step + suggestions.length) % suggestions.length
        })
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) {
        e.preventDefault()
        pickMention(suggestions[Math.min(mention.index, suggestions.length - 1)])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMention(null)
        return
      }
    }
    // Enter sends; Shift+Enter adds a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
    // Escape cancels a reply.
    if (e.key === 'Escape' && replyingTo) {
      e.preventDefault()
      setReplyingTo(null)
    }
    // Up arrow in an empty box edits your last message.
    if (e.key === 'ArrowUp' && !draft) {
      const last = [...messages]
        .reverse()
        .find((m) => m.senderId === me.id && !m.deleted && !m.event && !m.gif && !m.poll && !m.game)
      if (last && conversation.canMessage) {
        e.preventDefault()
        setEditingId(last.id)
      }
    }
  }

  /** Tells the other person we're typing (at most every few seconds). */
  function noteTyping(text: string): void {
    const nowMs = Date.now()
    if (text.trim() && nowMs - lastTypingSent.current > TYPING_SEND_EVERY_MS) {
      lastTypingSent.current = nowMs
      window.glofly.conversations.typing(conversation.id)
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(e.target.value)
    noteTyping(e.target.value)
    checkMention(e.target.value, e.target.selectionStart)
  }

  /** Groups: is the cursor right after "@something"? Then suggest people. */
  function checkMention(text: string, cursor: number | null): void {
    if (!isGroup || cursor === null) return setMention(null)
    const found = mentionQuery(text, cursor)
    setMention((old) =>
      found ? { ...found, index: old && old.start === found.start ? old.index : 0 } : null
    )
  }

  /** Puts "@username " in place of what was typed after the @. */
  function pickMention(person: PublicUser): void {
    if (!mention) return
    const input = inputRef.current
    const cursor = input?.selectionStart ?? draft.length
    const insert = `@${person.username} `
    const next = draft.slice(0, mention.start) + insert + draft.slice(cursor)
    if (next.length > MESSAGE_MAX + 200) return
    cursorAfterInsert.current = mention.start + insert.length
    setDraft(next)
    setMention(null)
    input?.focus()
  }

  // The mute menu closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!muteOpen && !moreOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!muteRef.current?.contains(e.target as Node)) {
        setMuteOpen(false)
        setMoreOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMuteOpen(false)
        setMoreOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [muteOpen, moreOpen])
  const muted = isMuted(conversation, now)

  /** Puts an emoji where the cursor was (replacing any selected text). */
  function insertEmoji(emoji: string, keepOpen: boolean): void {
    const input = inputRef.current
    const start = input?.selectionStart ?? draft.length
    const end = input?.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + emoji + draft.slice(end)
    if (next.length > MESSAGE_MAX + 200) return
    cursorAfterInsert.current = start + emoji.length
    setDraft(next)
    noteTyping(next)
    if (!keepOpen) {
      setEmojiAnchor(null)
      input?.focus()
    }
  }

  const closeEmoji = useCallback(() => {
    setEmojiAnchor(null)
    inputRef.current?.focus()
  }, [])

  // Grow the message box with its text, up to a limit.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
    if (cursorAfterInsert.current !== null) {
      input.setSelectionRange(cursorAfterInsert.current, cursorAfterInsert.current)
      cursorAfterInsert.current = null
    }
  }, [draft])

  // Everything to show, oldest first: delivered messages, then ones still sending.
  const shown: ShownMessage[] = [
    ...messages.map((m) => ({ key: m.id, message: m, pending: null })),
    ...pending.map((p) => ({
      key: p.tempId,
      message: {
        id: p.tempId,
        conversationId: conversation.id,
        senderId: me.id,
        body: p.body,
        createdAt: p.createdAt,
        editedAt: null,
        deleted: false,
        replyTo: p.replyTo,
        reactions: [],
        attachments: p.attachments,
        event: null,
        lantern: p.lantern
      },
      pending: { failed: p.failed }
    }))
  ]

  // "✓✓ Seen 10:03 PM" (from the design) under your latest message, once they've read it.
  // Only when your message is the last one (a reply from them already says they saw it),
  // and only when both of you allow read receipts.
  const lastItem = shown.at(-1)
  const lastIsMine =
    !!partner &&
    lastItem &&
    !lastItem.message.event &&
    !lastItem.pending &&
    lastItem.message.senderId === me.id &&
    !lastItem.message.deleted
  const readAt = conversation.partnerReadAt
  const seen =
    lastIsMine &&
    readAt &&
    new Date(readAt).getTime() >= new Date(lastItem.message.createdAt).getTime()
  const seenLine =
    lastIsMine && readAt !== null ? (
      <div className={seen ? 'receipt receipt--seen' : 'receipt'} aria-live="polite">
        {seen ? (
          <>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12l5 5L17 7" />
              <path d="M9 17l1 0L22 7" />
            </svg>
            Seen {clockTime(readAt)}
            {partner && (
              <Avatar
                id={partner.id}
                name={partner.displayName}
                avatarVersion={partner.avatarVersion}
                size={18}
              />
            )}
          </>
        ) : (
          <>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12l5 5L20 7" />
            </svg>
            Sent
          </>
        )}
      </div>
    ) : null

  // 0.7.3 long chats: only a window of the newest messages is drawn (it grows as you scroll up,
  // and to reach a message you jump to), and the list isn't redrawn on every keystroke.
  const windowStart = Math.max(0, shown.length - windowSize)
  windowStartRef.current = windowStart
  shownCount.current = shown.length
  const messageRows = useMemo(
    () =>
      shown.slice(windowStart).map((item, j) => {
        const i = windowStart + j
        const m = item.message
        const previous = shown[i - 1]?.message
        const newDay = !previous || !isSameDay(previous.createdAt, m.createdAt)
        const divider = newDay && (
          <div className="day-divider">
            <span>{dayLabel(m.createdAt)}</span>
          </div>
        )
        // Calls get a line with an arrow, like the design ("Chip started a video call").
        if (m.event?.type === 'call') {
          const missed =
            m.senderId !== me.id && (m.event.status === 'missed' || m.event.status === 'declined')
          return (
            <div key={item.key}>
              {divider}
              <div
                className={
                  missed
                    ? 'chat-event chat-event--call chat-event--missed'
                    : 'chat-event chat-event--call'
                }
                data-message-id={m.id}
              >
                <span className="chat-event-icon">
                  <CallLineIcon missed={missed} />
                </span>
                <span>{eventText(m.event, m.senderId, me.id, nameOf)}</span>
                <time dateTime={m.createdAt}>{clockTime(m.createdAt)}</time>
              </div>
            </div>
          )
        }
        // Watch Together started in the call (0.5.0): a line with the Watch icon.
        if (m.event?.type === 'watch') {
          return (
            <div key={item.key}>
              {divider}
              <div className="chat-event chat-event--call chat-event--watch" data-message-id={m.id}>
                <span className="chat-event-icon">
                  <WatchIcon size={16} />
                </span>
                <span>
                  <EmojiText text={eventText(m.event, m.senderId, me.id, nameOf)} />
                </span>
                <time dateTime={m.createdAt}>{clockTime(m.createdAt)}</time>
              </div>
            </div>
          )
        }
        // Group events ("Chip added Maya") are a quiet line, not a message.
        if (m.event) {
          return (
            <div key={item.key}>
              {divider}
              <div className="chat-event" data-message-id={m.id}>
                <span>
                  <EmojiText text={eventText(m.event, m.senderId, me.id, nameOf)} />
                </span>
                <time dateTime={m.createdAt}>{clockTime(m.createdAt)}</time>
              </div>
            </div>
          )
        }
        const sender = personOf(m.senderId)
        // A reply always shows its name, so the quote is clearly attached to it.
        const grouped = !newDay && !m.replyTo && !previous?.event && continuesGroup(previous, m)
        return (
          <div key={item.key}>
            {divider}
            <MessageItem
              item={item}
              grouped={grouped}
              meId={me.id}
              authorName={nameOf(m.senderId)}
              authorRole={nebula ? nebula.roleOf(m.senderId) : null}
              canDeleteOthers={!!nebula && m.senderId !== me.id && nebula.canDelete(m.senderId)}
              extra={nebula && !m.deleted && !m.event ? voiceCardFor(nebula, m.body) : null}
              avatar={
                m.senderId === me.id ? (
                  <span className="avatar avatar--mine" aria-hidden="true">
                    <AvatarFace id={me.id} name={me.displayName} avatarVersion={me.avatarVersion} />
                  </span>
                ) : sender ? (
                  // Anyone else's photo opens their profile card (DMs too since Oct 13, like the phone app).
                  <button
                    type="button"
                    className="message-face"
                    aria-label={`View ${sender.displayName}'s profile`}
                    onClick={() => onViewProfile(sender)}
                  >
                    <Avatar
                      id={sender.id}
                      name={sender.displayName}
                      avatarVersion={sender.avatarVersion}
                      size={40}
                    />
                  </button>
                ) : (
                  <Avatar id={m.senderId} name="?" avatarVersion={null} size={40} />
                )
              }
              time={clockTime(m.createdAt)}
              nameOf={nameOf}
              canAct={conversation.canMessage}
              editing={editingId === m.id}
              highlighted={highlightId === m.id}
              onReact={(emoji) => void toggleReaction(m, emoji)}
              onReply={() => startReply(m)}
              onEdit={() => setEditingId(m.id)}
              onSaveEdit={(body) => void saveEdit(m, body)}
              onCancelEdit={() => {
                setEditingId(null)
                inputRef.current?.focus()
              }}
              onDelete={() => setDeleting(m)}
              onJumpTo={jumpTo}
              onRetry={() => retry(item.key)}
              onDiscard={() => {
                const discarded = pending.find((x) => x.tempId === item.key)
                setPending((p) => p.filter((x) => x.tempId !== item.key))
                for (const a of discarded?.attachments ?? []) {
                  void window.glofly.conversations.removeUpload(conversation.id, a.id)
                }
              }}
              people={mentionPeople}
              onMentionClick={(u) => onViewProfile(u)}
              onReport={onReport && !item.pending ? () => onReport(m) : undefined}
              memberIds={memberIds}
              onUpdated={upsert}
              onFailure={handleFailure}
              onFireflies={
                conversation.canMessage ? (emoji) => void sendFireflies(m, emoji) : undefined
              }
              onRemovePreview={() => void removePreview(m)}
              pinned={canPin && !item.pending ? pinnedIds.has(m.id) : null}
              onPin={canPin ? (pin) => void setPinned(m, pin) : undefined}
              onMarkUnread={!item.pending ? () => void markUnreadFrom(m) : undefined}
              attachments={
                m.attachments.length > 0 ? (
                  <MessageAttachments
                    conversationId={conversation.id}
                    attachments={m.attachments}
                    onOpenPhoto={(photos, index) => setViewing({ photos, index })}
                    onFailure={handleFailure}
                  />
                ) : null
              }
            />
          </div>
        )
      }),
    // Everything the rows show; the composer's draft isn't one of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      messages,
      pending,
      windowStart,
      editingId,
      highlightId,
      pinList,
      canPin,
      conversation,
      me,
      nebula,
      formerPeople,
      onLeave
    ]
  )

  // 0.7.4: the pinned messages panel opens under the pins button, or under ⋯ More when the chat
  // has no pins yet.
  const pinsPanel = (
    <PinsPanel
      pins={pinList}
      canPin={canPin}
      nameOf={nameOf}
      onJump={(id) => {
        setPinsOpen(false)
        setLocalJump({ messageId: id, nonce: Date.now() })
      }}
      onUnpin={(id) => {
        const m = pinList.find((p) => p.message.id === id)?.message
        if (m) void setPinned(m, false)
      }}
      onClose={() => setPinsOpen(false)}
    />
  )

  return (
    <div
      className="chat"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {nebula ? (
        <header className="chat-header cx-nebula-header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#f47a1f" aria-hidden="true">
            <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
          </svg>
          <div className="cx-nebula-name">
            <EmojiText text={nebula.name} />
          </div>
          {nebula.topic && (
            <div className="cx-nebula-topic">
              <EmojiText text={nebula.topic} />
            </div>
          )}
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="chat-header-button"
            aria-label="Search this nebula"
            title={`Search messages (${shortcutLabel('F')})`}
            onClick={onSearch}
          >
            <SearchIcon size={19} />
          </button>

          {/* 0.7.3: pinned messages */}
          <span className="pins-wrap">
            <button
              type="button"
              className={
                pinsOpen ? 'chat-header-button chat-header-button--on' : 'chat-header-button'
              }
              aria-label={
                pinList.length ? `Pinned messages (${pinList.length})` : 'Pinned messages'
              }
              aria-expanded={pinsOpen}
              title="Pinned messages"
              onClick={() => setPinsOpen((v) => !v)}
            >
              <PinnedMessagesIcon size={20} />
              {pinList.length > 0 && <span className="pins-count">{pinList.length}</span>}
            </button>
            {pinsOpen && (
              <PinsPanel
                pins={pinList}
                canPin={canPin}
                nameOf={nameOf}
                onJump={(id) => {
                  setPinsOpen(false)
                  setLocalJump({ messageId: id, nonce: Date.now() })
                }}
                onUnpin={(id) => {
                  const m = pinList.find((p) => p.message.id === id)?.message
                  if (m) void setPinned(m, false)
                }}
                onClose={() => setPinsOpen(false)}
              />
            )}
          </span>
          {nebula.headerExtra}
          <button
            type="button"
            className={
              nebula.membersOpen ? 'chat-header-button cx-members-toggle--on' : 'chat-header-button'
            }
            aria-label={nebula.membersOpen ? 'Hide member list' : 'Show member list'}
            aria-pressed={nebula.membersOpen}
            title="Members"
            onClick={nebula.onToggleMembers}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
              <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
            </svg>
          </button>
        </header>
      ) : (
        <header className="chat-header">
          {partner ? (
            <button
              type="button"
              className="chat-header-face"
              aria-label={`View ${partner.displayName}'s profile`}
              title="View profile"
              onClick={() => onViewProfile(partner)}
            >
              <Avatar
                id={partner.id}
                name={partner.displayName}
                avatarVersion={partner.avatarVersion}
                status={partnerPresence?.status}
                mobile={onMobile(partnerPresence ?? undefined)}
                ring="var(--glo-bg)"
              />
            </button>
          ) : (
            <button
              type="button"
              className="chat-header-face"
              aria-label="Group settings"
              onClick={onGroupSettings}
            >
              <GroupAvatar
                members={conversation.members}
                me={me}
                size={44}
                ring="var(--glo-bg)"
                group={conversation}
              />
            </button>
          )}
          <div className="chat-title">
            <div className="chat-names">
              <span className="chat-name">
                <EmojiText text={title} />
              </span>
              {partner && <span className="chat-user">@{partner.username}</span>}
              {partner && social.glows[partner.id] && (
                <span className="chat-glow">
                  <GlowMark glow={social.glows[partner.id]} name={partner.displayName} />
                  {glowLabel(social.glows[partner.id])}
                </span>
              )}
              {partner && social.birthdays.includes(partner.id) && (
                <BirthdayMark name={partner.displayName} />
              )}
            </div>
            {partner ? (
              partnerPresence && (
                <span className="chat-status">
                  <EmojiText text={presenceHeader(partnerPresence, now)} />
                </span>
              )
            ) : (
              <button type="button" className="chat-status chat-members" onClick={onGroupSettings}>
                {memberCountLabel(conversation.memberCount)}
                {(() => {
                  const online = conversation.members.filter(
                    (m) => (presence[m.id]?.status ?? 'offline') !== 'offline'
                  ).length
                  return online > 0 ? ` · ${online} online` : ''
                })()}
              </button>
            )}
          </div>
          <div className="chat-header-actions">
            {/* 0.7.4 (Chip, Oct 20): Call, Video and Search stay as buttons; Profile, Pinned
                messages, Pin chat and Mute moved into ⋯ More. Pins and Muted still show as their
                own button while they apply, so they stay one click away. */}
            <button
              type="button"
              className="chat-header-button"
              aria-label={groupCallOn ? 'Join call' : 'Start voice call'}
              title={callTitle('Voice')}
              disabled={!canCall}
              onClick={() => calls.start(conversation, false)}
            >
              <PhoneIcon size={20} />
            </button>
            <button
              type="button"
              className="chat-header-button"
              aria-label={groupCallOn ? 'Join call with video' : 'Start video call'}
              title={callTitle('Video')}
              disabled={!canCall}
              onClick={() => calls.start(conversation, true)}
            >
              <VideoIcon size={21} />
            </button>
            {/* Groups (0.5.2): ring only some of the group. */}
            {isGroup && !groupCallOn && conversation.memberCount > 2 && (
              <button
                type="button"
                className="chat-header-button chat-header-button--narrow"
                aria-label="Choose who to ring"
                title="Choose who to ring"
                disabled={!canCall}
                onClick={() => setRingSome(true)}
              >
                <ChevronIcon direction="down" size={16} strokeWidth={2.4} />
              </button>
            )}
            <button
              type="button"
              className="chat-header-button"
              aria-label="Search this chat"
              title={`Search messages (${shortcutLabel('F')})`}
              onClick={onSearch}
            >
              <SearchIcon size={19} />
            </button>
            {pinList.length > 0 && (
              <span className="pins-wrap">
                <button
                  type="button"
                  className={
                    pinsOpen ? 'chat-header-button chat-header-button--on' : 'chat-header-button'
                  }
                  aria-label={`Pinned messages (${pinList.length})`}
                  aria-expanded={pinsOpen}
                  title="Pinned messages"
                  onClick={() => setPinsOpen((v) => !v)}
                >
                  <PinnedMessagesIcon size={20} />
                  <span className="pins-count">{pinList.length}</span>
                </button>
                {pinsOpen && pinsPanel}
              </span>
            )}
            {muted && (
              <button
                type="button"
                className="chat-header-button chat-header-button--on"
                aria-label={isGroup ? 'Unmute this group' : 'Unmute this chat'}
                title={
                  conversation.mutedUntil
                    ? `${mutedLabel(conversation.mutedUntil)} · Unmute`
                    : 'Unmute'
                }
                onClick={() => onMute(null)}
              >
                <BellOffIcon size={19} />
              </button>
            )}
            <div className="chat-header-wrap" ref={muteRef}>
              <button
                type="button"
                className={
                  moreOpen || muteOpen
                    ? 'chat-header-button chat-header-button--on'
                    : 'chat-header-button'
                }
                aria-label="More"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
                title="More"
                onClick={() => {
                  setMuteOpen(false)
                  setMoreOpen((v) => !v)
                }}
              >
                <MoreIcon size={20} />
              </button>
              {moreOpen && (
                <div
                  role="menu"
                  className="menu chat-more-menu"
                  aria-label="More"
                  onKeyDown={(e) => {
                    // Up / Down move between the items, like the other menus' keyboard use.
                    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
                    e.preventDefault()
                    const items = [
                      ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
                    ]
                    const at = items.indexOf(document.activeElement as HTMLButtonElement)
                    const next =
                      e.key === 'ArrowDown'
                        ? (at + 1) % items.length
                        : (at - 1 + items.length) % items.length
                    items[next]?.focus()
                  }}
                >
                  {partner ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      autoFocus
                      onClick={() => {
                        setMoreOpen(false)
                        onViewProfile(partner)
                      }}
                    >
                      <ProfileIcon size={18} strokeWidth={1.9} />
                      View profile
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      autoFocus
                      onClick={() => {
                        setMoreOpen(false)
                        onGroupSettings()
                      }}
                    >
                      <GroupIcon size={18} />
                      Group settings
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setMoreOpen(false)
                      setPinsOpen(true)
                    }}
                  >
                    <PinnedMessagesIcon size={18} />
                    Pinned messages
                    {pinList.length > 0 && (
                      <span className="menu-item-count">{pinList.length}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => {
                      setMoreOpen(false)
                      onTogglePin()
                    }}
                  >
                    <PinIcon size={18} />
                    {conversation.pinnedAt
                      ? `Unpin ${isGroup ? 'group' : 'chat'}`
                      : `Pin ${isGroup ? 'group' : 'chat'} to the top`}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    aria-haspopup={muted ? undefined : 'menu'}
                    onClick={() => {
                      setMoreOpen(false)
                      if (muted) onMute(null)
                      else setMuteOpen(true)
                    }}
                  >
                    {muted ? <BellIcon size={18} /> : <BellOffIcon size={18} />}
                    {muted ? 'Unmute' : `Mute ${isGroup ? 'group' : 'chat'}…`}
                  </button>
                </div>
              )}
              {muteOpen && (
                <div role="menu" className="menu chat-mute-menu">
                  {muted && conversation.mutedUntil ? (
                    <>
                      <span className="menu-subhead">{mutedLabel(conversation.mutedUntil)}</span>
                      <button
                        type="button"
                        role="menuitem"
                        className="menu-item"
                        onClick={() => {
                          setMuteOpen(false)
                          onMute(null)
                        }}
                      >
                        <BellIcon size={18} />
                        Unmute
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="menu-subhead">Mute {isGroup ? 'group' : 'chat'}</span>
                      {MUTE_CHOICES.map((c) => (
                        <button
                          key={c.duration}
                          type="button"
                          role="menuitem"
                          className="menu-item menu-item--indent"
                          onClick={() => {
                            setMuteOpen(false)
                            onMute(c.duration)
                          }}
                        >
                          {c.label}
                        </button>
                      ))}
                      <span className="menu-note">
                        {isGroup
                          ? 'No sounds or notifications. You’ll still hear about @mentions.'
                          : 'No sounds or notifications from this chat.'}
                      </span>
                    </>
                  )}
                </div>
              )}
              {pinsOpen && pinList.length === 0 && pinsPanel}
            </div>
          </div>
        </header>
      )}

      {nebula ? null : inThisCall ? (
        <CallPanel me={me} />
      ) : (
        <JoinCallBar conversation={conversation} me={me} />
      )}
      {ringSome && (
        <RingSomeDialog
          conversation={conversation}
          onClose={() => setRingSome(false)}
          onStart={(video, ring) => {
            setRingSome(false)
            calls.start(conversation, video, ring)
          }}
        />
      )}

      <div className="chat-messages" ref={listRef} onScroll={onScroll}>
        {loadingOlder && <p className="chat-loading">Loading earlier messages…</p>}
        {!loading && !hasMore && nebula && (
          <div className="chat-start cx-nebula-start">
            <span className="cx-nebula-start-mark" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="#ffb347">
                <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
              </svg>
            </span>
            <h2>
              Welcome to <EmojiText text={nebula.name} />
            </h2>
            <p>
              {nebula.topic ? (
                <EmojiText text={nebula.topic} />
              ) : (
                'This is the start of this nebula.'
              )}
            </p>
          </div>
        )}
        {!loading && !hasMore && !nebula && (
          <div className="chat-start">
            {partner ? (
              <Avatar
                id={partner.id}
                name={partner.displayName}
                avatarVersion={partner.avatarVersion}
                size={72}
              />
            ) : (
              <GroupAvatar
                members={conversation.members}
                me={me}
                size={72}
                ring="var(--glo-bg)"
                group={conversation}
              />
            )}
            <h2>
              <EmojiText text={title} />
            </h2>
            {partner ? (
              <p>
                This is the beginning of your messages with <strong>@{partner.username}</strong>.
                Say hello!
              </p>
            ) : (
              <p>This is the beginning of the group. Say hello to everyone!</p>
            )}
          </div>
        )}

        {messageRows}
        {seenLine}
      </div>

      <div className="composer-area">
        <div className="typing-line" aria-live="polite">
          {someoneTyping && (
            <>
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              {typingNames.length === 1 ? (
                <span>
                  <strong>{typingNames[0]}</strong> is typing…
                </span>
              ) : (
                <span>{typingText(typingNames)}</span>
              )}
            </>
          )}
        </div>

        {notice && (
          <p className="chat-notice" role="alert">
            {notice}
            <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
              ×
            </button>
          </p>
        )}

        <ScheduledStrip list={laterList} onOpen={() => setLaterOpen(true)} />

        {conversation.canMessage ? (
          <div
            className={[
              'composer',
              replyingTo && 'composer--replying',
              lantern && 'composer--lantern'
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {lantern && (
              <div className="lantern-bar">
                <LanternIcon size={18} />
                <span>
                  <strong>Lantern message</strong> · fades away once everyone has read it
                </span>
                <button
                  type="button"
                  aria-label="Turn off lantern"
                  title="Turn off lantern"
                  onClick={() => setLantern(false)}
                >
                  ×
                </button>
              </div>
            )}
            {uploads.length > 0 && (
              <UploadTray
                conversationId={conversation.id}
                uploads={uploads}
                onRemove={removeUpload}
              />
            )}
            {replyingTo && (
              <div className="reply-bar">
                <span>
                  Replying to <strong>{nameOf(replyingTo.senderId)}</strong>
                  <span className="reply-bar-text">
                    <EmojiText text={textOf(replyingTo)} />
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Cancel reply"
                  title="Cancel reply (Esc)"
                  onClick={() => setReplyingTo(null)}
                >
                  ×
                </button>
              </div>
            )}
            {suggestions.length > 0 && mention && (
              <div
                className="mention-picker"
                role="listbox"
                id="mention-picker"
                aria-label="People to mention"
              >
                <span className="mention-picker-head">Mention someone</span>
                {suggestions.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    id={`mention-option-${i}`}
                    aria-selected={i === mention.index}
                    className="mention-option"
                    // Keep the cursor in the message box.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setMention({ ...mention, index: i })}
                    onClick={() => pickMention(p)}
                  >
                    <Avatar
                      id={p.id}
                      name={p.displayName}
                      avatarVersion={p.avatarVersion}
                      size={28}
                    />
                    <span className="mention-option-name">{p.displayName}</span>
                    <span className="mention-option-user">@{p.username}</span>
                  </button>
                ))}
              </div>
            )}
            <div className={recording ? 'composer-row composer-row--recording' : 'composer-row'}>
              {recording ? (
                <div className="voice-recording" role="status" aria-live="polite">
                  <button
                    type="button"
                    className="voice-cancel"
                    aria-label="Cancel voice message"
                    title="Cancel (Esc)"
                    onClick={recorder.cancel}
                  >
                    <TrashIcon />
                  </button>
                  <span className="voice-rec-dot" aria-hidden="true" />
                  <span className="voice-rec-time">
                    {voiceTime(recorder.elapsedMs)}
                    <span className="voice-rec-max"> / {voiceTime(VOICE_MAX_MS)}</span>
                  </span>
                  <span className="voice-rec-bars" aria-hidden="true">
                    {recorder.live.map((l, i) => (
                      <span key={i} style={{ height: `${Math.max(10, Math.round(l * 100))}%` }} />
                    ))}
                  </span>
                  <span
                    className="voice-rec-hint"
                    style={holding ? { opacity: 1 - slid / SLIDE_TO_CANCEL } : undefined}
                  >
                    {recorder.state === 'starting'
                      ? 'Starting your mic…'
                      : holding
                        ? '‹ Slide left to cancel · let go to send'
                        : 'Recording · Esc to cancel'}
                  </span>
                </div>
              ) : (
                <>
                  <button
                    ref={plusRef}
                    type="button"
                    className={plusAnchor ? 'attach-button attach-button--open' : 'attach-button'}
                    aria-label="Add photos, files, a poll or a game"
                    aria-haspopup="menu"
                    aria-expanded={!!plusAnchor}
                    title="Photos, videos, files and more"
                    onClick={(e) => {
                      const button = e.currentTarget
                      setPlusAnchor((a) => (a ? null : button))
                    }}
                  >
                    <AttachIcon />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => {
                      addFiles(Array.from(e.target.files ?? []))
                      e.target.value = '' // so the same file can be picked again
                    }}
                  />
                  <textarea
                    ref={inputRef}
                    rows={1}
                    aria-label={`Message ${title}`}
                    placeholder={partner ? `Message @${partner.username}` : `Message ${title}`}
                    value={draft}
                    maxLength={MESSAGE_MAX + 200}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    onPaste={onPaste}
                    onSelect={(e) => {
                      if (mention)
                        checkMention(e.currentTarget.value, e.currentTarget.selectionStart)
                    }}
                    onBlur={() => setMention(null)}
                    aria-autocomplete={isGroup ? 'list' : undefined}
                    aria-controls={suggestions.length > 0 ? 'mention-picker' : undefined}
                    aria-activedescendant={
                      suggestions.length > 0 && mention
                        ? `mention-option-${mention.index}`
                        : undefined
                    }
                  />
                  <button
                    type="button"
                    className={gifAnchor ? 'gif-button gif-button--open' : 'gif-button'}
                    aria-label="GIF"
                    aria-expanded={!!gifAnchor}
                    aria-haspopup="dialog"
                    title="Send a GIF"
                    onClick={(e) => (gifAnchor ? closeGifs() : setGifAnchor(e.currentTarget))}
                  >
                    <GifIcon />
                  </button>
                  <button
                    type="button"
                    className={emojiAnchor ? 'emoji-button emoji-button--open' : 'emoji-button'}
                    aria-label="Emoji"
                    aria-expanded={!!emojiAnchor}
                    aria-haspopup="dialog"
                    title="Emoji"
                    onClick={(e) => (emojiAnchor ? closeEmoji() : setEmojiAnchor(e.currentTarget))}
                  >
                    <EmojiIcon />
                  </button>
                </>
              )}
              <button
                type="button"
                className={[
                  'mic-button',
                  recording && 'mic-button--recording',
                  holding && 'mic-button--holding'
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={recording && !holding ? 'Send voice message' : 'Record a voice message'}
                title={
                  recording ? undefined : 'Voice message (click to record, or hold and let go)'
                }
                style={
                  holding && slid
                    ? { transform: `translateX(-${Math.min(slid, 60)}px)` }
                    : undefined
                }
                onPointerDown={micDown}
                onPointerMove={micMove}
                onPointerUp={micUp}
                onPointerCancel={() => {
                  sendPress.current = false
                  micUp()
                }}
                onClick={(e) => {
                  // From the keyboard (Enter / Space): start recording, then send.
                  if (e.detail !== 0) return
                  if (recording) recorder.finish()
                  else recorder.start()
                }}
              >
                {recording && !holding ? <SendIcon /> : <MicIcon size={20} />}
              </button>
              {!recording && draft.trim().length > 0 && (
                <button
                  type="button"
                  className="composer-later"
                  aria-label="Send later"
                  aria-haspopup="menu"
                  title="Send later"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setLaterMenu({ x: r.right, y: r.top })
                  }}
                >
                  <ClockIcon size={19} />
                </button>
              )}
              {!recording && (
                <button
                  type="button"
                  className="send-button"
                  aria-label="Send message"
                  title={
                    uploading ? 'Waiting for files to upload…' : 'Send (right-click: send later)'
                  }
                  disabled={!canSend}
                  onClick={send}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    if (!draft.trim()) return
                    setLaterMenu({ x: e.clientX, y: e.clientY })
                  }}
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="composer-locked">
            {nebula
              ? (nebula.cantPost ?? "You can't post here right now.")
              : partner
                ? `You can only message friends. Add @${partner.username} as a friend to chat again.`
                : "You can't send messages right now."}
          </p>
        )}
      </div>

      {laterMenu && (
        <SendLaterMenu
          anchor={laterMenu}
          disabledReason={laterBlocked}
          onPick={(at) => void sendLater(at)}
          onClose={() => setLaterMenu(null)}
        />
      )}
      {laterOpen && (
        <ScheduledPanel
          conversationId={conversation.id}
          list={laterList}
          onProblem={setNotice}
          onClose={() => setLaterOpen(false)}
        />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <span className="drop-overlay-icon">
            <FileIcon size={30} />
          </span>
          <strong>
            Drop to send to <EmojiText text={title} />
          </strong>
          <span>Photos, videos and files (files up to 25 MB, videos up to 64 MB)</span>
        </div>
      )}

      <ChatFireflies conversationId={conversation.id} nameOf={nameOf} meId={me.id} />
      {partner && social.birthdays.includes(partner.id) && (
        <BirthdayConfetti key={partner.id} userId={partner.id} name={partner.displayName} />
      )}

      {plusAnchor && conversation.canMessage && (
        <div
          ref={plusMenuRef}
          role="menu"
          className="menu plus-menu"
          style={plusMenuPlace(plusAnchor)}
        >
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setPlusAnchor(null)
              fileInputRef.current?.click()
            }}
          >
            <FileIcon size={18} />
            Photos, videos or files
          </button>
          {isGroup && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                setPlusAnchor(null)
                setPollOpen(true)
              }}
            >
              <PollIcon />
              Poll
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              setPlusAnchor(null)
              setGameAnchor(plusRef.current)
            }}
          >
            <GameIcon />
            Play a game
          </button>
          {!nebula && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={lantern}
              className={lantern ? 'menu-item menu-item--on' : 'menu-item'}
              onClick={() => {
                setPlusAnchor(null)
                setLantern((on) => !on)
                inputRef.current?.focus()
              }}
            >
              <LanternIcon />
              <span className="menu-item-text">
                <span>Lantern message</span>
                <span className="menu-item-sub">Fades away once it’s read</span>
              </span>
              {lantern && <span className="plus-menu-check">✓</span>}
            </button>
          )}
        </div>
      )}

      {gameAnchor && conversation.canMessage && (
        <GameMenu anchor={gameAnchor} onPick={(k) => void startGame(k)} onClose={closeGames} />
      )}

      {gifAnchor && conversation.canMessage && (
        <GifPicker
          anchor={gifAnchor}
          onPick={(g) => void sendGif(g)}
          onPickSticker={(st) => void sendSticker(st)}
          onClose={closeGifs}
        />
      )}

      {pollOpen && <NewPollDialog onCreate={createPoll} onClose={() => setPollOpen(false)} />}

      {emojiAnchor && conversation.canMessage && (
        <EmojiPicker
          anchor={emojiAnchor}
          userId={me.id}
          label="Add emoji to your message"
          allowMultiple
          onPick={insertEmoji}
          onClose={closeEmoji}
        />
      )}

      {viewing && (
        <PhotoViewer
          conversationId={conversation.id}
          photos={viewing.photos}
          startIndex={viewing.index}
          onClose={() => setViewing(null)}
          onFailure={handleFailure}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete message?"
          message={
            nebula
              ? deleting.senderId === me.id
                ? "It will be removed for everyone in this nebula. This can't be undone."
                : `You're deleting ${nameOf(deleting.senderId)}'s message as a moderator. It's removed for everyone and noted in Moderation.`
              : isGroup
                ? "It will be removed for everyone in the group. This can't be undone."
                : "It will be removed for both of you. This can't be undone."
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

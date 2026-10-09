import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  Attachment,
  ConversationSummary,
  Message,
  Presence,
  PublicUser,
  ReplyPreview,
  SignedInUser
} from '../../../preload/api-types'
import { chatTitle, eventText, memberCountLabel, typingText } from '../lib/groups'
import GroupAvatar from './GroupAvatar'
import { presenceHeader } from '../lib/presence'
import { clockTime, continuesGroup, dayLabel, isSameDay } from '../lib/time'
import Avatar, { AvatarFace } from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import { MessageAttachments, PhotoViewer, UploadTray, type Upload } from './Attachments'
import { attachmentSummary } from '../lib/attachments'
import {
  CallLineIcon,
  FileIcon,
  GroupIcon,
  PhoneIcon,
  ProfileIcon,
  SearchIcon,
  VideoIcon
} from './icons'
import CallPanel, { JoinCallBar } from './CallPanel'
import { useCalls } from '../calls/callState'
import MessageItem, { type ShownMessage } from './MessageItem'
import { PinIcon } from './ChatList'
import EmojiPicker from './EmojiPicker'
import EmojiText from './EmojiText'
import './ChatView.css'
import { isShortcutKey, shortcutLabel } from '../lib/platform'

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
}

/** A message still on its way, or one that didn't send. */
type Pending = {
  tempId: string
  body: string
  createdAt: string
  failed: boolean
  replyTo: ReplyPreview | null
  attachments: Attachment[]
}

const TYPING_SEND_EVERY_MS = 3000 // how often we tell the other person we're typing
const TYPING_SHOW_FOR_MS = 4500 // how long "is typing…" stays after their last keystroke
const MESSAGE_MAX = 4000
const FILES_PER_MESSAGE = 10
const FILE_MAX_BYTES = 25 * 1024 * 1024

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
    ? { kind: m.attachments[0].kind, name: m.attachments[0].name, count: m.attachments.length }
    : null
})

/** Short text for a message: its words, or "Photo" / the file name if it has none. */
const textOf = (m: Pick<Message, 'body' | 'attachments'>): string =>
  m.body || attachmentSummary(m.attachments)

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
  jumpRequest
}: ChatViewProps): React.JSX.Element {
  const partner = conversation.partner
  const isGroup = conversation.kind === 'group'
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
  /** The 😊 button, while the emoji picker it opened is showing */
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)
  /** Where the cursor goes after an emoji is added (applied once the text updates). */
  const cursorAfterInsert = useRef<number | null>(null)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadsRef = useRef<Upload[]>([])
  const chatOpen = useRef(true)

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

  const handleFailure = useCallback(
    (error: string, message: string) => {
      if (error === 'unauthorized') onSessionExpired()
      else setNotice(message)
    },
    [onSessionExpired]
  )

  /** Puts the newest version of a message in the list. */
  const upsert = useCallback((m: Message) => {
    setMessages((list) => (list.some((x) => x.id === m.id) ? applyUpdate(list, m) : [...list, m]))
  }, [])

  // Mark read when the window is in front and this chat is open.
  const markRead = useCallback(async () => {
    if (!document.hasFocus()) return
    const result = await window.glofly.conversations.markRead(conversation.id)
    if (result.ok) onRead(conversation.id)
  }, [conversation.id, onRead])

  // Load the newest messages.
  useEffect(() => {
    let cancelled = false
    window.glofly.conversations.messages(conversation.id).then((result) => {
      if (cancelled) return
      setLoading(false)
      if (!result.ok) return handleFailure(result.error, result.message)
      stickToBottom.current = true
      setMessages(result.data.messages)
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
  }, [messages, pending, someoneTyping, replyingTo, conversation.partnerReadAt])

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
    setHasMore(result.data.hasMore)
    rememberPeople(result.data.people)
  }

  function onScroll(): void {
    const list = listRef.current
    if (!list) return
    stickToBottom.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120
    if (list.scrollTop < 80) void loadOlder()
  }

  async function deliver(item: Pending): Promise<void> {
    const result = await window.glofly.conversations.send(
      conversation.id,
      item.body,
      item.replyTo?.id,
      item.attachments.map((a) => a.id)
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
      attachments: readyFiles
    }
    stickToBottom.current = true
    setPending((p) => [...p, item])
    setDraft('')
    setReplyingTo(null)
    setUploads([]) // sent ones go with the message; failed ones are dropped
    void deliver(item)
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
      if (file.size > FILE_MAX_BYTES) {
        setUploads((list) => [...list, fail('Too big. Files can be up to 25 MB.')])
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
  useEffect(() => {
    if (!jumpRequest || loading) return
    const attempt = ++revealing.current
    const id = jumpRequest.messageId
    const nextFrame = (): Promise<void> =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
    void (async () => {
      for (let page = 0; page < 40; page++) {
        if (attempt !== revealing.current) return // another jump started
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
        setHasMore(result.data.hasMore)
        rememberPeople(result.data.people)
        await nextFrame()
      }
      if (attempt === revealing.current)
        setNotice("Couldn't find that message. It may have been deleted.")
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per jump request
  }, [jumpRequest, loading])

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
        .find((m) => m.senderId === me.id && !m.deleted && !m.event)
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
  }

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
        event: null
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

  return (
    <div
      className="chat"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="chat-header">
        {partner ? (
          <Avatar
            id={partner.id}
            name={partner.displayName}
            avatarVersion={partner.avatarVersion}
            status={partnerPresence?.status}
            ring="var(--glo-bg)"
          />
        ) : (
          <button
            type="button"
            className="chat-header-face"
            aria-label="Group settings"
            onClick={onGroupSettings}
          >
            <GroupAvatar members={conversation.members} me={me} size={44} ring="var(--glo-bg)" />
          </button>
        )}
        <div className="chat-title">
          <div className="chat-names">
            <span className="chat-name">
              <EmojiText text={title} />
            </span>
            {partner && <span className="chat-user">@{partner.username}</span>}
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
          {
            <>
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
            </>
          }
          <button
            type="button"
            className="chat-header-button"
            aria-label="Search this chat"
            title={`Search messages (${shortcutLabel('F')})`}
            onClick={onSearch}
          >
            <SearchIcon size={19} />
          </button>
          <button
            type="button"
            className={
              conversation.pinnedAt
                ? 'chat-header-button chat-header-button--on'
                : 'chat-header-button'
            }
            aria-label={conversation.pinnedAt ? 'Unpin this chat' : 'Pin this chat'}
            aria-pressed={!!conversation.pinnedAt}
            title={conversation.pinnedAt ? 'Unpin' : 'Pin to the top'}
            onClick={onTogglePin}
          >
            <PinIcon size={19} />
          </button>
          {partner ? (
            <button
              type="button"
              className="chat-header-button"
              aria-label={`View ${partner.displayName}'s profile`}
              title="Profile"
              onClick={() => onViewProfile(partner)}
            >
              <ProfileIcon size={20} strokeWidth={1.9} />
            </button>
          ) : (
            <button
              type="button"
              className="chat-header-button"
              aria-label="Group settings"
              title="Group settings"
              onClick={onGroupSettings}
            >
              <GroupIcon size={21} />
            </button>
          )}
        </div>
      </header>

      {inThisCall ? <CallPanel me={me} /> : <JoinCallBar conversation={conversation} me={me} />}

      <div className="chat-messages" ref={listRef} onScroll={onScroll}>
        {loadingOlder && <p className="chat-loading">Loading earlier messages…</p>}
        {!loading && !hasMore && (
          <div className="chat-start">
            {partner ? (
              <Avatar
                id={partner.id}
                name={partner.displayName}
                avatarVersion={partner.avatarVersion}
                size={72}
              />
            ) : (
              <GroupAvatar members={conversation.members} me={me} size={72} ring="var(--glo-bg)" />
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

        {shown.map((item, i) => {
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
                avatar={
                  m.senderId === me.id ? (
                    <span className="avatar avatar--mine" aria-hidden="true">
                      <AvatarFace
                        id={me.id}
                        name={me.displayName}
                        avatarVersion={me.avatarVersion}
                      />
                    </span>
                  ) : sender && isGroup ? (
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
                    <Avatar
                      id={m.senderId}
                      name={sender?.displayName ?? '?'}
                      avatarVersion={sender?.avatarVersion}
                      size={40}
                    />
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
        })}
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

        {conversation.canMessage ? (
          <div className={replyingTo ? 'composer composer--replying' : 'composer'}>
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
            <div className="composer-row">
              <button
                type="button"
                className="attach-button"
                aria-label="Attach a file"
                title="Attach photos or files"
                onClick={() => fileInputRef.current?.click()}
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
              />
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
              <button
                type="button"
                className="send-button"
                aria-label="Send message"
                title={uploading ? 'Waiting for files to upload…' : undefined}
                disabled={!canSend}
                onClick={send}
              >
                <SendIcon />
              </button>
            </div>
          </div>
        ) : (
          <p className="composer-locked">
            {partner
              ? `You can only message friends. Add @${partner.username} as a friend to chat again.`
              : "You can't send messages right now."}
          </p>
        )}
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <span className="drop-overlay-icon">
            <FileIcon size={30} />
          </span>
          <strong>
            Drop to send to <EmojiText text={title} />
          </strong>
          <span>Photos and files up to 25 MB</span>
        </div>
      )}

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
            isGroup
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

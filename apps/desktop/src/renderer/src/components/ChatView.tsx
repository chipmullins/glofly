import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  Attachment,
  ConversationSummary,
  Message,
  Presence,
  ReplyPreview,
  SignedInUser
} from '../../../preload/api-types'
import { presenceHeader } from '../lib/presence'
import { clockTime, continuesGroup, dayLabel, isSameDay } from '../lib/time'
import Avatar, { AvatarFace } from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import { MessageAttachments, PhotoViewer, UploadTray, type Upload } from './Attachments'
import { attachmentSummary } from '../lib/attachments'
import { FileIcon, ProfileIcon } from './icons'
import MessageItem, { type ShownMessage } from './MessageItem'
import './ChatView.css'

type ChatViewProps = {
  me: SignedInUser
  conversation: ConversationSummary
  /** Their status, if they're a friend */
  partnerPresence?: Presence
  now: number
  /** Called after this chat is marked read, so the sidebar can clear its badge. */
  onRead: (conversationId: string) => void
  onViewProfile: () => void
  onSessionExpired: () => void
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
  partnerPresence,
  now,
  onRead,
  onViewProfile,
  onSessionExpired
}: ChatViewProps): React.JSX.Element {
  const partner = conversation.partner
  const [messages, setMessages] = useState<Message[]>([])
  const [pending, setPending] = useState<Pending[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Message | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [viewing, setViewing] = useState<{ photos: Attachment[]; index: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadsRef = useRef<Upload[]>([])
  const chatOpen = useRef(true)

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const keepScrollFrom = useRef<number | null>(null)
  const lastTypingSent = useRef(0)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempCounter = useRef(0)

  const nameOf = useCallback(
    (userId: string) => (userId === me.id ? me.displayName : partner.displayName),
    [me, partner]
  )

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
      void markRead()
    })
    inputRef.current?.focus()
    return () => {
      cancelled = true
    }
  }, [conversation.id, handleFailure, markRead])

  // Live updates: new messages, edits/deletes/reactions, and typing.
  useEffect(() => {
    return window.glofly.onEvent((event) => {
      if (event.type === 'message:new' && event.message.conversationId === conversation.id) {
        const m = event.message
        setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m]))
        if (m.senderId !== me.id) {
          setPartnerTyping(false)
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
        setPartnerTyping(true)
        if (typingTimer.current) clearTimeout(typingTimer.current)
        typingTimer.current = setTimeout(() => setPartnerTyping(false), TYPING_SHOW_FOR_MS)
      }
    })
  }, [conversation.id, me.id, markRead])

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current)
    },
    []
  )

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
  }, [messages, pending, partnerTyping, replyingTo, conversation.partnerReadAt])

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
      const last = [...messages].reverse().find((m) => m.senderId === me.id && !m.deleted)
      if (last && conversation.canMessage) {
        e.preventDefault()
        setEditingId(last.id)
      }
    }
  }

  function onChange(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(e.target.value)
    const nowMs = Date.now()
    if (e.target.value.trim() && nowMs - lastTypingSent.current > TYPING_SEND_EVERY_MS) {
      lastTypingSent.current = nowMs
      window.glofly.conversations.typing(conversation.id)
    }
  }

  // Grow the message box with its text, up to a limit.
  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`
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
        attachments: p.attachments
      },
      pending: { failed: p.failed }
    }))
  ]

  // "✓✓ Seen 10:03 PM" (from the design) under your latest message, once they've read it.
  // Only when your message is the last one (a reply from them already says they saw it),
  // and only when both of you allow read receipts.
  const lastItem = shown.at(-1)
  const lastIsMine =
    lastItem &&
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
            <Avatar
              id={partner.id}
              name={partner.displayName}
              avatarVersion={partner.avatarVersion}
              size={18}
            />
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
        <Avatar
          id={partner.id}
          name={partner.displayName}
          avatarVersion={partner.avatarVersion}
          status={partnerPresence?.status}
          ring="#FFFFFF"
        />
        <div className="chat-title">
          <div className="chat-names">
            <span className="chat-name">{partner.displayName}</span>
            <span className="chat-user">@{partner.username}</span>
          </div>
          {partnerPresence && (
            <span className="chat-status">{presenceHeader(partnerPresence, now)}</span>
          )}
        </div>
        <div className="chat-header-actions">
          <button
            type="button"
            className="chat-header-button"
            aria-label={`View ${partner.displayName}'s profile`}
            title="Profile"
            onClick={onViewProfile}
          >
            <ProfileIcon size={20} strokeWidth={1.9} />
          </button>
        </div>
      </header>

      <div className="chat-messages" ref={listRef} onScroll={onScroll}>
        {loadingOlder && <p className="chat-loading">Loading earlier messages…</p>}
        {!loading && !hasMore && (
          <div className="chat-start">
            <Avatar
              id={partner.id}
              name={partner.displayName}
              avatarVersion={partner.avatarVersion}
              size={72}
            />
            <h2>{partner.displayName}</h2>
            <p>
              This is the beginning of your messages with <strong>@{partner.username}</strong>. Say
              hello!
            </p>
          </div>
        )}

        {shown.map((item, i) => {
          const m = item.message
          const previous = shown[i - 1]?.message
          const newDay = !previous || !isSameDay(previous.createdAt, m.createdAt)
          // A reply always shows its name, so the quote is clearly attached to it.
          const grouped = !newDay && !m.replyTo && continuesGroup(previous, m)
          return (
            <div key={item.key}>
              {newDay && (
                <div className="day-divider">
                  <span>{dayLabel(m.createdAt)}</span>
                </div>
              )}
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
                  ) : (
                    <Avatar
                      id={partner.id}
                      name={partner.displayName}
                      avatarVersion={partner.avatarVersion}
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
          {partnerTyping && (
            <>
              <span className="typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>
                <strong>{partner.displayName}</strong> is typing…
              </span>
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
                  <span className="reply-bar-text">{textOf(replyingTo)}</span>
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
                aria-label={`Message ${partner.displayName}`}
                placeholder={`Message @${partner.username}`}
                value={draft}
                maxLength={MESSAGE_MAX + 200}
                onChange={onChange}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
              />
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
            You can only message friends. Add @{partner.username} as a friend to chat again.
          </p>
        )}
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <span className="drop-overlay-icon">
            <FileIcon size={30} />
          </span>
          <strong>Drop to send to {partner.displayName}</strong>
          <span>Photos and files up to 25 MB</span>
        </div>
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
          message="It will be removed for both of you. This can't be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

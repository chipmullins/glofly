import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationSummary, Message, SignedInUser } from '../../../preload/api-types'
import { initials } from '../lib/names'
import { clockTime, continuesGroup, dayLabel, isSameDay } from '../lib/time'
import Avatar from './Avatar'
import './ChatView.css'

type ChatViewProps = {
  me: SignedInUser
  conversation: ConversationSummary
  /** Called after this chat is marked read, so the sidebar can clear its badge. */
  onRead: (conversationId: string) => void
  onSessionExpired: () => void
}

/** A message still on its way, or one that didn't send. */
type Pending = {
  tempId: string
  body: string
  createdAt: string
  failed: boolean
}

const TYPING_SEND_EVERY_MS = 3000 // how often we tell the other person we're typing
const TYPING_SHOW_FOR_MS = 4500 // how long "is typing…" stays after their last keystroke
const MESSAGE_MAX = 4000

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

export default function ChatView({
  me,
  conversation,
  onRead,
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

  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const keepScrollFrom = useRef<number | null>(null)
  const lastTypingSent = useRef(0)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tempCounter = useRef(0)

  const handleFailure = useCallback(
    (error: string, message: string) => {
      if (error === 'unauthorized') onSessionExpired()
      else setNotice(message)
    },
    [onSessionExpired]
  )

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

  // Live updates: new messages and typing.
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
  }, [messages, pending, partnerTyping])

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
    const result = await window.glofly.conversations.send(conversation.id, item.body)
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

  function send(): void {
    const body = draft.trim()
    if (!body || !conversation.canMessage) return
    if (body.length > MESSAGE_MAX) {
      setNotice(`Messages can be up to ${MESSAGE_MAX.toLocaleString()} characters.`)
      return
    }
    tempCounter.current += 1
    const item: Pending = {
      tempId: `pending-${tempCounter.current}`,
      body,
      createdAt: new Date().toISOString(),
      failed: false
    }
    stickToBottom.current = true
    setPending((p) => [...p, item])
    setDraft('')
    void deliver(item)
  }

  function retry(item: Pending): void {
    setPending((p) => p.map((x) => (x.tempId === item.tempId ? { ...x, failed: false } : x)))
    void deliver({ ...item, failed: false })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter adds a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
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
  const shown = [
    ...messages.map((m) => ({
      key: m.id,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt,
      pending: null as Pending | null
    })),
    ...pending.map((p) => ({
      key: p.tempId,
      senderId: me.id,
      body: p.body,
      createdAt: p.createdAt,
      pending: p
    }))
  ]

  return (
    <div className="chat">
      <header className="chat-header">
        <Avatar id={partner.id} name={partner.displayName} />
        <div className="chat-title">
          <span className="chat-name">{partner.displayName}</span>
          <span className="chat-user">@{partner.username}</span>
        </div>
      </header>

      <div className="chat-messages" ref={listRef} onScroll={onScroll} aria-live="polite">
        {loadingOlder && <p className="chat-loading">Loading earlier messages…</p>}
        {!loading && !hasMore && (
          <div className="chat-start">
            <Avatar id={partner.id} name={partner.displayName} size={72} />
            <h2>{partner.displayName}</h2>
            <p>
              This is the beginning of your messages with <strong>@{partner.username}</strong>. Say
              hello!
            </p>
          </div>
        )}

        {shown.map((m, i) => {
          const previous = shown[i - 1]
          const newDay = !previous || !isSameDay(previous.createdAt, m.createdAt)
          const grouped = !newDay && continuesGroup(previous, m)
          const mine = m.senderId === me.id
          const name = mine ? me.displayName : partner.displayName
          return (
            <div key={m.key}>
              {newDay && (
                <div className="day-divider">
                  <span>{dayLabel(m.createdAt)}</span>
                </div>
              )}
              <div className={grouped ? 'message message--grouped' : 'message'}>
                {!grouped &&
                  (mine ? (
                    <span className="avatar avatar--mine" aria-hidden="true">
                      {initials(me.displayName)}
                    </span>
                  ) : (
                    <Avatar id={partner.id} name={partner.displayName} size={40} />
                  ))}
                <div className="message-content">
                  {!grouped && (
                    <div className="message-meta">
                      <span
                        className={mine ? 'message-author message-author--mine' : 'message-author'}
                      >
                        {name}
                      </span>
                      <span className="message-time">{clockTime(m.createdAt)}</span>
                    </div>
                  )}
                  <p
                    className={
                      m.pending
                        ? m.pending.failed
                          ? 'message-body message-body--failed'
                          : 'message-body message-body--sending'
                        : 'message-body'
                    }
                    title={grouped ? clockTime(m.createdAt) : undefined}
                  >
                    {m.body}
                  </p>
                  {m.pending?.failed && (
                    <span className="message-failed">
                      Not sent ·{' '}
                      <button type="button" onClick={() => retry(m.pending as Pending)}>
                        Retry
                      </button>{' '}
                      ·{' '}
                      <button
                        type="button"
                        onClick={() => setPending((p) => p.filter((x) => x.tempId !== m.key))}
                      >
                        Delete
                      </button>
                    </span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
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
          </p>
        )}

        {conversation.canMessage ? (
          <div className="composer">
            <textarea
              ref={inputRef}
              rows={1}
              aria-label={`Message ${partner.displayName}`}
              placeholder={`Message @${partner.username}`}
              value={draft}
              maxLength={MESSAGE_MAX + 200}
              onChange={onChange}
              onKeyDown={onKeyDown}
            />
            <button
              type="button"
              className="send-button"
              aria-label="Send message"
              disabled={!draft.trim()}
              onClick={send}
            >
              <SendIcon />
            </button>
          </div>
        ) : (
          <p className="composer-locked">
            You can only message friends. Add @{partner.username} as a friend to chat again.
          </p>
        )}
      </div>
    </div>
  )
}

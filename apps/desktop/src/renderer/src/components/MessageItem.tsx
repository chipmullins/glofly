import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Message } from '../../../preload/api-types'

export type ShownMessage = {
  key: string
  message: Message
  /** Set while a message you sent is still on its way (or failed). */
  pending: { failed: boolean } | null
}

type MessageItemProps = {
  item: ShownMessage
  grouped: boolean
  meId: string
  authorName: string
  avatar: React.ReactNode
  time: string
  nameOf: (userId: string) => string
  /** False when messaging isn't allowed (no longer friends, or blocked). */
  canAct: boolean
  editing: boolean
  highlighted: boolean
  onReact: (emoji: string) => void
  onReply: () => void
  onEdit: () => void
  onSaveEdit: (body: string) => void
  onCancelEdit: () => void
  onDelete: () => void
  onJumpTo: (messageId: string) => void
  onRetry: () => void
  onDiscard: () => void
}

// The quick reactions offered by the 😊 button.
const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥']

function Icon({
  children,
  size = 18
}: {
  children: React.ReactNode
  size?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** The inline editor. A fresh one opens each time, starting from the message's text. */
function EditBox({
  initial,
  onSave,
  onCancel
}: {
  initial: string
  onSave: (body: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  // Focus with the cursor at the end.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  // Grow with the text.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`
  }, [text])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSave(text)
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="edit-box">
      <textarea
        ref={ref}
        value={text}
        aria-label="Edit message"
        maxLength={4200}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <span className="edit-hint">
        Escape to{' '}
        <button type="button" onClick={onCancel}>
          cancel
        </button>{' '}
        · Enter to{' '}
        <button type="button" onClick={() => onSave(text)}>
          save
        </button>
      </span>
    </div>
  )
}

/** "You", "Jasmine Lee", or "You and Jasmine Lee" */
function whoReacted(userIds: string[], meId: string, nameOf: (id: string) => string): string {
  const names = userIds.map((id) => (id === meId ? 'You' : nameOf(id)))
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export default function MessageItem({
  item,
  grouped,
  meId,
  authorName,
  avatar,
  time,
  nameOf,
  canAct,
  editing,
  highlighted,
  onReact,
  onReply,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  onJumpTo,
  onRetry,
  onDiscard
}: MessageItemProps): React.JSX.Element {
  const m = item.message
  const mine = m.senderId === meId
  const [popup, setPopup] = useState<'react' | 'menu' | null>(null)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const showToolbar = !item.pending && !m.deleted && !editing

  // Close the reaction picker or menu when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!popup) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setPopup(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPopup(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [popup])

  async function copy(): Promise<void> {
    setPopup(null)
    try {
      await navigator.clipboard.writeText(m.body)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard not available; nothing to do.
    }
  }

  const classes = ['message']
  if (grouped) classes.push('message--grouped')
  if (popup) classes.push('message--active')
  if (highlighted) classes.push('message--highlight')
  if (editing) classes.push('message--editing')

  const bodyClass = item.pending
    ? item.pending.failed
      ? 'message-body message-body--failed'
      : 'message-body message-body--sending'
    : 'message-body'

  return (
    <div className={classes.join(' ')} data-message-id={m.id} ref={wrapRef}>
      {!grouped && avatar}
      <div className="message-content">
        {m.replyTo && (
          <button
            type="button"
            className="reply-quote"
            onClick={() => m.replyTo && onJumpTo(m.replyTo.id)}
            title="Jump to the original message"
          >
            <Icon size={14}>
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h10a6 6 0 0 1 6 6v5" />
            </Icon>
            <strong>{nameOf(m.replyTo.senderId)}</strong>
            <span
              className={
                m.replyTo.deleted
                  ? 'reply-quote-text reply-quote-text--deleted'
                  : 'reply-quote-text'
              }
            >
              {m.replyTo.deleted ? 'Original message was deleted' : m.replyTo.body}
            </span>
          </button>
        )}

        {!grouped && (
          <div className="message-meta">
            <span className={mine ? 'message-author message-author--mine' : 'message-author'}>
              {authorName}
            </span>
            <span className="message-time">{time}</span>
          </div>
        )}

        {editing ? (
          <EditBox initial={m.body} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : m.deleted ? (
          <p className="message-body message-body--deleted">This message was deleted.</p>
        ) : (
          <p className={bodyClass} title={grouped ? time : undefined}>
            {m.body}
            {m.editedAt && (
              <span
                className="message-edited"
                title={`Edited ${new Date(m.editedAt).toLocaleString()}`}
              >
                {' '}
                (edited)
              </span>
            )}
          </p>
        )}

        {item.pending?.failed && (
          <span className="message-failed">
            Not sent ·{' '}
            <button type="button" onClick={onRetry}>
              Retry
            </button>{' '}
            ·{' '}
            <button type="button" onClick={onDiscard}>
              Delete
            </button>
          </span>
        )}

        {m.reactions.length > 0 && (
          <div className="reactions">
            {m.reactions.map((r) => {
              const reacted = r.userIds.includes(meId)
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className={reacted ? 'reaction reaction--mine' : 'reaction'}
                  aria-pressed={reacted}
                  aria-label={`${r.emoji} ${r.userIds.length}: ${whoReacted(r.userIds, meId, nameOf)}`}
                  title={whoReacted(r.userIds, meId, nameOf)}
                  disabled={!canAct}
                  onClick={() => onReact(r.emoji)}
                >
                  <span className="reaction-emoji">{r.emoji}</span>
                  <span className="reaction-count">{r.userIds.length}</span>
                </button>
              )
            })}
          </div>
        )}

        {copied && <span className="message-copied">Copied</span>}
      </div>

      {showToolbar && (
        <div className="msg-toolbar" role="toolbar" aria-label="Message actions">
          {canAct && (
            <button
              type="button"
              aria-label="Add reaction"
              title="Add reaction"
              aria-expanded={popup === 'react'}
              onClick={() => setPopup((p) => (p === 'react' ? null : 'react'))}
            >
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" />
                <path d="M9 9.5h.01M15 9.5h.01" />
              </Icon>
            </button>
          )}
          {canAct && (
            <button type="button" aria-label="Reply" title="Reply" onClick={onReply}>
              <Icon>
                <path d="M9 14L4 9l5-5" />
                <path d="M4 9h10a6 6 0 0 1 6 6v5" />
              </Icon>
            </button>
          )}
          <button
            type="button"
            aria-label="More message options"
            title="More"
            aria-expanded={popup === 'menu'}
            onClick={() => setPopup((p) => (p === 'menu' ? null : 'menu'))}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>

          {popup === 'react' && (
            <div className="reaction-picker" role="menu" aria-label="Pick a reaction">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={`React with ${emoji}`}
                  onClick={() => {
                    setPopup(null)
                    onReact(emoji)
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {popup === 'menu' && (
            <div role="menu" className="menu message-menu">
              {mine && canAct && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setPopup(null)
                    onEdit()
                  }}
                >
                  <Icon>
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                  </Icon>
                  Edit message
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => void copy()}
              >
                <Icon>
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </Icon>
                Copy text
              </button>
              {mine && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item--danger"
                  onClick={() => {
                    setPopup(null)
                    onDelete()
                  }}
                >
                  <Icon>
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                  </Icon>
                  Delete message
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

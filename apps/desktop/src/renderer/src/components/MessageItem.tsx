import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Message, PublicUser } from '../../../preload/api-types'
import { splitMentions } from '../lib/mentions'
import { quoteSummary } from '../lib/attachments'
import { shortBody } from '@glofly/shared/gifs'
import { addRecent, isJumbo } from '../lib/emoji'
import EmojiPicker from './EmojiPicker'
import EmojiText, { Emoji } from './EmojiText'
import { GameCard, GifView, LanternTag, LinkPreviewCard, PollCard } from './ChatExtras'
import { lanternStyle } from '../lib/lantern'
import type { FireflyEmoji } from '../../../preload/api-types'

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
  /** The message's photos and files, if any. */
  attachments: React.ReactNode
  /** Groups: everyone in the chat (you included), so "@maya" shows as a mention */
  people?: PublicUser[]
  /** Clicking a mention (opens their profile) */
  onMentionClick?: (user: PublicUser) => void
  /** Report someone else's message (opens the Report dialog) */
  onReport?: () => void
  // ---- 0.5.0 ----
  /** Everyone in the chat, you included (games) */
  memberIds: string[]
  /** A vote or move came back: the newest version of the message */
  onUpdated: (m: Message) => void
  onFailure: (error: string, message: string) => void
  /** Long-press ❤️ or 🔥: react, and send a swarm of fireflies across the chat */
  onFireflies?: (emoji: FireflyEmoji) => void
  /** Take the link preview off your own message */
  onRemovePreview?: () => void
  // ---- 2.0 nebulas ----
  /** Their role's badge and name color (Owner, Admin…), or null */
  authorRole?: { name: string; light: string; badgeBg: string; badgeText: string } | null
  /** A moderator may delete this (someone else's) message */
  canDeleteOthers?: boolean
  /** Shown under the message (a voice nebula's Join card) */
  extra?: React.ReactNode
}

const HOLD_FOR_FIREFLIES_MS = 450
const isFireflyEmoji = (e: string): e is FireflyEmoji => e === '❤️' || e === '🔥'

/** Message text with "@username" of people in the chat shown as mentions (you stand out). */
function MentionText({
  text,
  people,
  meId,
  onClick
}: {
  text: string
  people: PublicUser[]
  meId: string
  onClick?: (user: PublicUser) => void
}): React.JSX.Element {
  const pieces = splitMentions(text, people)
  return (
    <>
      {pieces.map((piece, i) =>
        piece.user ? (
          <button
            key={i}
            type="button"
            className={piece.user.id === meId ? 'mention mention--me' : 'mention'}
            title={piece.user.displayName}
            onClick={() => piece.user && onClick?.(piece.user)}
          >
            {piece.text}
          </button>
        ) : (
          <EmojiText key={i} text={piece.text} />
        )
      )}
    </>
  )
}

// The quick reactions offered by the 😊 button (the + after them opens the full picker).
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
  onDiscard,
  attachments,
  people,
  onMentionClick,
  onReport,
  memberIds,
  onUpdated,
  onFailure,
  onFireflies,
  onRemovePreview,
  authorRole,
  canDeleteOthers,
  extra
}: MessageItemProps): React.JSX.Element {
  const m = item.message
  const mine = m.senderId === meId
  const [popup, setPopup] = useState<'react' | 'menu' | null>(null)
  /** The button the full emoji picker opened from, while it's open. */
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null)
  const reactButtonRef = useRef<HTMLButtonElement>(null)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const showToolbar = !item.pending && !m.deleted && !editing
  /** A GIF, poll or game: the body is only the plain-text version for older apps. */
  const special = !!(m.gif || m.poll || m.game)
  // Holding ❤️ or 🔥 in the quick reactions sends fireflies.
  const [charging, setCharging] = useState<string | null>(null)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const held = useRef(false)
  const stopHold = useCallback(() => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    setCharging(null)
  }, [])
  useEffect(() => stopHold, [stopHold])

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

  const closePicker = useCallback(() => setPickerAnchor(null), [])
  const pickReaction = useCallback(
    (emoji: string) => {
      setPickerAnchor(null)
      onReact(emoji)
    },
    [onReact]
  )

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
  if (popup || pickerAnchor) classes.push('message--active')
  if (highlighted) classes.push('message--highlight')
  if (editing) classes.push('message--editing')
  if (!item.pending && !m.deleted && !mine && m.mentions?.includes(meId)) {
    classes.push('message--mentions-me')
  }
  if (m.lantern && !m.deleted) classes.push('message--lantern')
  if (m.lantern && m.lanternFadeAt && !m.deleted) classes.push('message--lantern-fading')

  const bodyClass = item.pending
    ? item.pending.failed
      ? 'message-body message-body--failed'
      : 'message-body message-body--sending'
    : 'message-body'
  const jumbo = !item.pending && !m.deleted && isJumbo(m.body)

  return (
    <div
      className={classes.join(' ')}
      data-message-id={m.id}
      ref={wrapRef}
      style={m.lantern && !m.deleted ? lanternStyle(m.lanternFadeAt) : undefined}
    >
      {!grouped && avatar}
      <div
        className={
          item.pending && !item.pending.failed
            ? 'message-content message-content--sending'
            : 'message-content'
        }
      >
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
              {m.replyTo.deleted ? (
                'Original message was deleted'
              ) : m.replyTo.body ? (
                <EmojiText text={shortBody(m.replyTo.body)} />
              ) : m.replyTo.attachment ? (
                quoteSummary(m.replyTo.attachment)
              ) : (
                ''
              )}
            </span>
          </button>
        )}

        {!grouped && (
          <div className="message-meta">
            <span
              className={mine ? 'message-author message-author--mine' : 'message-author'}
              style={authorRole ? { color: authorRole.light } : undefined}
            >
              {authorName}
            </span>
            {authorRole && (
              <span
                className="cx-role-badge"
                style={{ background: authorRole.badgeBg, color: authorRole.badgeText }}
              >
                {authorRole.name.toUpperCase()}
              </span>
            )}
            <span className="message-time">{time}</span>
          </div>
        )}

        {editing ? (
          <EditBox initial={m.body} onSave={onSaveEdit} onCancel={onCancelEdit} />
        ) : m.deleted ? (
          <p className="message-body message-body--deleted">
            {m.lantern ? 'A lantern message faded away.' : 'This message was deleted.'}
          </p>
        ) : special || (!m.body && m.attachments.length > 0) ? null : (
          <p
            className={jumbo ? `${bodyClass} message-body--jumbo` : bodyClass}
            title={grouped ? time : undefined}
          >
            {people?.length ? (
              <MentionText text={m.body} people={people} meId={meId} onClick={onMentionClick} />
            ) : (
              <EmojiText text={m.body} />
            )}
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

        {!m.deleted && !editing && m.gif && <GifView gif={m.gif} />}
        {!m.deleted && m.poll && (
          <PollCard
            message={m}
            meId={meId}
            nameOf={nameOf}
            canAct={canAct}
            onUpdated={onUpdated}
            onFailure={onFailure}
          />
        )}
        {!m.deleted && m.game && (
          <GameCard
            message={m}
            meId={meId}
            nameOf={nameOf}
            canAct={canAct}
            memberIds={memberIds}
            onUpdated={onUpdated}
            onFailure={onFailure}
          />
        )}
        {!m.deleted && !editing && m.linkPreview && (
          <LinkPreviewCard
            conversationId={m.conversationId}
            messageId={m.id}
            preview={m.linkPreview}
            canRemove={mine && canAct && !!onRemovePreview}
            onRemove={() => onRemovePreview?.()}
          />
        )}

        {!m.deleted && attachments}
        {extra}

        {m.lantern && !m.deleted && !item.pending && <LanternTag fadeAt={m.lanternFadeAt} />}

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
                  <Emoji emoji={r.emoji} className="reaction-emoji" />
                  <span className="reaction-count">{r.userIds.length}</span>
                </button>
              )
            })}
            {canAct && !item.pending && !m.deleted && (
              <button
                type="button"
                className="reaction reaction--add"
                aria-label="Add reaction"
                title="Add reaction"
                aria-expanded={!!pickerAnchor}
                onClick={(e) => {
                  const button = e.currentTarget
                  setPickerAnchor((a) => (a ? null : button))
                }}
              >
                <Icon size={16}>
                  <circle cx="11" cy="13" r="8" />
                  <path d="M7.8 15.2s1.1 1.6 3.2 1.6 3.2-1.6 3.2-1.6" />
                  <path d="M8.5 11h.01M13.5 11h.01" />
                  <path d="M19 2v5M16.5 4.5h5" />
                </Icon>
              </button>
            )}
          </div>
        )}

        {copied && <span className="message-copied">Copied</span>}
      </div>

      {showToolbar && (
        <div className="msg-toolbar" role="toolbar" aria-label="Message actions">
          {canAct && (
            <button
              ref={reactButtonRef}
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
                  aria-label={
                    isFireflyEmoji(emoji) && onFireflies
                      ? `React with ${emoji} (hold to send fireflies)`
                      : `React with ${emoji}`
                  }
                  className={charging === emoji ? 'reaction-picker-charging' : undefined}
                  onPointerDown={() => {
                    held.current = false
                    if (!isFireflyEmoji(emoji) || !onFireflies) return
                    setCharging(emoji)
                    holdTimer.current = setTimeout(() => {
                      held.current = true
                      stopHold()
                      setPopup(null)
                      addRecent(meId, emoji)
                      onFireflies(emoji)
                    }, HOLD_FOR_FIREFLIES_MS)
                  }}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onPointerCancel={stopHold}
                  onClick={() => {
                    if (held.current) return // the hold already sent it
                    setPopup(null)
                    addRecent(meId, emoji)
                    onReact(emoji)
                  }}
                >
                  <Emoji emoji={emoji} className="reaction-picker-emoji" />
                </button>
              ))}
              <button
                type="button"
                role="menuitem"
                className="reaction-picker-more"
                aria-label="More emoji"
                title="More emoji"
                onClick={() => {
                  setPopup(null)
                  setPickerAnchor(reactButtonRef.current)
                }}
              >
                <Icon size={20}>
                  <path d="M12 5v14M5 12h14" />
                </Icon>
              </button>
              {onFireflies && (
                <span className="reaction-picker-hint" aria-hidden="true">
                  Hold ❤️ or 🔥 to send fireflies
                </span>
              )}
            </div>
          )}

          {popup === 'menu' && (
            <div role="menu" className="menu message-menu">
              {mine && canAct && !special && (
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
              {m.body && !special && (
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
              )}
              {onFireflies && !m.deleted && (
                // The keyboard way to send fireflies (holding ❤️ needs a pointer).
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setPopup(null)
                    addRecent(meId, '❤️')
                    onFireflies('❤️')
                  }}
                >
                  <Icon>
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                  </Icon>
                  Send fireflies
                </button>
              )}
              {mine && canAct && m.linkPreview && onRemovePreview && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    setPopup(null)
                    onRemovePreview()
                  }}
                >
                  <Icon>
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <path d="M4 4l16 16" />
                  </Icon>
                  Remove link preview
                </button>
              )}
              {!mine && onReport && (
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item menu-item--danger"
                  onClick={() => {
                    setPopup(null)
                    onReport()
                  }}
                >
                  <Icon>
                    <path d="M5 21V4" />
                    <path d="M5 4h11l-2 4 2 4H5" />
                  </Icon>
                  Report message
                </button>
              )}
              {(mine || canDeleteOthers) && (
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

      {pickerAnchor && canAct && (
        <EmojiPicker
          anchor={pickerAnchor}
          userId={meId}
          label="Add a reaction"
          onPick={pickReaction}
          onClose={closePicker}
        />
      )}
    </div>
  )
}

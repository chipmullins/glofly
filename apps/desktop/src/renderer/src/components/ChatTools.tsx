import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PinnedMessage, ScheduledMessage } from '../../../preload/api-types'
import { sendLaterChoices } from '@glofly/shared/chatTools'
import { attachmentSummary, shortBody } from '@glofly/shared'
import { localInputValue, scheduled as scheduledApi, whenLabel } from '../lib/tools'
import EmojiText from './EmojiText'

// 0.7.3 chat tools: the pinned messages panel, the Send later menu, and the strip + panel of
// messages waiting to be sent.

/** Pinned messages: a speech bubble with a pin in it (the plain pin is "pin this chat"). */
export function PinnedMessagesIcon({ size = 20 }: { size?: number }): React.JSX.Element {
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
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5z" />
      <path d="M10.5 6.5h3l-.5 3 2 2h-6l2-2z" />
      <path d="M12 11.5v2" />
    </svg>
  )
}

export function PinIcon({ size = 20 }: { size?: number }): React.JSX.Element {
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
      <path d="M9 4h6l-1 6 4 4H6l4-4z" />
      <path d="M12 14v7" />
    </svg>
  )
}

export function ClockIcon({ size = 20 }: { size?: number }): React.JSX.Element {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/** Closes on Escape or a click outside the element. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, onClose: () => void): void {
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) close.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [ref])
}

// ---------------------------------------------------------------------------------------------
// Pins

export function PinsPanel({
  pins,
  canPin,
  nameOf,
  onJump,
  onUnpin,
  onClose
}: {
  pins: PinnedMessage[]
  canPin: boolean
  nameOf: (userId: string) => string
  onJump: (messageId: string) => void
  onUnpin: (messageId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  return (
    <div ref={ref} className="pins-panel" role="dialog" aria-label="Pinned messages">
      <div className="pins-panel-head">
        <PinIcon size={18} />
        <strong>Pinned messages</strong>
        <button type="button" className="pins-panel-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {pins.length === 0 ? (
        <p className="pins-empty">
          Nothing pinned yet.{' '}
          {canPin ? 'Pin a message from its ••• menu to keep it handy here.' : ''}
        </p>
      ) : (
        <ul className="pins-list">
          {pins.map((p) => {
            const m = p.message
            const text = shortBody(m.body) || attachmentSummary(m.attachments) || 'Message'
            return (
              <li key={m.id} className="pins-item">
                <div className="pins-item-meta">
                  <strong>{nameOf(m.senderId)}</strong>
                  <time dateTime={m.createdAt}>
                    {new Date(m.createdAt).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric'
                    })}
                  </time>
                </div>
                <div className="pins-item-text">
                  <EmojiText text={text.length > 240 ? `${text.slice(0, 240)}…` : text} />
                </div>
                <div className="pins-item-actions">
                  <button type="button" className="link-button" onClick={() => onJump(m.id)}>
                    Jump to message
                  </button>
                  {canPin && (
                    <button type="button" className="link-button" onClick={() => onUnpin(m.id)}>
                      Unpin
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Send later

/** The choices for when (and "Pick a date & time…"), opened from the send button. */
export function SendLaterMenu({
  anchor,
  disabledReason,
  onPick,
  onClose
}: {
  anchor: { x: number; y: number }
  /** Why it can't be used right now (files or a GIF waiting), or null */
  disabledReason: string | null
  onPick: (at: Date) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const [custom, setCustom] = useState<string | null>(null)
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(anchor.x - width + 20, window.innerWidth - width - 8)),
      top: Math.max(8, anchor.y - height - 10)
    })
  }, [anchor, custom])
  const now = new Date()
  const choices = sendLaterChoices(now)
  const minValue = localInputValue(new Date(now.getTime() + 2 * 60 * 1000))
  return (
    <div
      ref={ref}
      className="menu send-later-menu"
      role="menu"
      aria-label="Send later"
      style={{ position: 'fixed', left: pos.left, top: pos.top }}
    >
      <div className="send-later-title">
        <ClockIcon size={16} /> Send later
      </div>
      {disabledReason ? (
        <p className="send-later-off">{disabledReason}</p>
      ) : custom === null ? (
        <>
          {choices.map((c) => (
            <button
              key={c.label}
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => onPick(c.at)}
            >
              <span>{c.label}</span>
              <span className="send-later-when">{whenLabel(c.at, now)}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => setCustom(localInputValue(choices[2]?.at ?? now))}
          >
            Pick a date &amp; time…
          </button>
        </>
      ) : (
        <form
          className="send-later-custom"
          onSubmit={(e) => {
            e.preventDefault()
            const at = new Date(custom)
            if (Number.isFinite(at.getTime())) onPick(at)
          }}
        >
          <input
            type="datetime-local"
            aria-label="When to send it"
            value={custom}
            min={minValue}
            autoFocus
            onChange={(e) => setCustom(e.target.value)}
          />
          <button type="submit" className="small-button small-button--primary">
            Schedule
          </button>
        </form>
      )}
    </div>
  )
}

/** "1 message scheduled · Tomorrow, 9:00 AM": above the message box, opens the list. */
export function ScheduledStrip({
  list,
  onOpen
}: {
  list: ScheduledMessage[]
  onOpen: () => void
}): React.JSX.Element | null {
  if (!list.length) return null
  const failed = list.filter((s) => s.failed).length
  const next = list.find((s) => !s.failed)
  return (
    <button
      type="button"
      className={failed ? 'scheduled-strip scheduled-strip--failed' : 'scheduled-strip'}
      onClick={onOpen}
    >
      <ClockIcon size={16} />
      <span>
        {list.length === 1 ? '1 message scheduled' : `${list.length} messages scheduled`}
        {next ? ` · ${whenLabel(next.sendAt)}` : ''}
        {failed ? ` · ${failed} couldn't be sent` : ''}
      </span>
      <span className="scheduled-strip-see">See</span>
    </button>
  )
}

export function ScheduledPanel({
  conversationId,
  list,
  onProblem,
  onClose
}: {
  conversationId: string
  list: ScheduledMessage[]
  onProblem: (message: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<{
    id: string
    what: 'text' | 'time'
    value: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  // The earliest time a message can be moved to (from when this list opened).
  const [minTime] = useState(() => localInputValue(new Date(Date.now() + 2 * 60 * 1000)))

  async function run(
    id: string,
    task: () => Promise<{ ok: boolean; message?: string }>
  ): Promise<void> {
    setBusy(id)
    const r = await task()
    setBusy(null)
    if (!r.ok) onProblem(r.message ?? 'Something went wrong. Try again.')
    else setEditing(null)
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className="dialog scheduled-panel"
        role="dialog"
        aria-label="Scheduled messages"
      >
        <div className="dialog-head">
          <div>
            <h1>Scheduled messages</h1>
            <p>Only you can see these until they&apos;re sent.</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {list.length === 0 && <p className="pins-empty">Nothing waiting to be sent.</p>}
        <ul className="scheduled-list">
          {list.map((s) => (
            <li
              key={s.id}
              className={s.failed ? 'scheduled-item scheduled-item--failed' : 'scheduled-item'}
            >
              <div className="scheduled-item-when">
                <ClockIcon size={15} />
                {whenLabel(s.sendAt)}
              </div>
              {s.failed && (
                <div className="scheduled-item-failed">Couldn&apos;t be sent: {s.failed}</div>
              )}
              {editing?.id === s.id && editing.what === 'text' ? (
                <textarea
                  className="scheduled-edit"
                  value={editing.value}
                  maxLength={4000}
                  autoFocus
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                />
              ) : (
                <div className="scheduled-item-text">
                  <EmojiText text={s.body} />
                </div>
              )}
              {editing?.id === s.id && editing.what === 'time' && (
                <input
                  type="datetime-local"
                  className="scheduled-edit-time"
                  aria-label="New time"
                  value={editing.value}
                  min={minTime}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                />
              )}
              <div className="scheduled-item-actions">
                {editing?.id === s.id ? (
                  <>
                    <button
                      type="button"
                      className="small-button small-button--primary"
                      disabled={busy === s.id || !editing.value.trim()}
                      onClick={() =>
                        void run(s.id, () =>
                          scheduledApi.edit(
                            conversationId,
                            s.id,
                            editing.what === 'text'
                              ? { body: editing.value }
                              : { sendAt: new Date(editing.value) }
                          )
                        )
                      }
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="small-button small-button--quiet"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        setEditing({
                          id: s.id,
                          what: 'time',
                          value: localInputValue(new Date(s.sendAt))
                        })
                      }
                    >
                      Edit time
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setEditing({ id: s.id, what: 'text', value: s.body })}
                    >
                      Edit text
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy === s.id}
                      onClick={() =>
                        void run(s.id, () => scheduledApi.sendNow(conversationId, s.id))
                      }
                    >
                      Send now
                    </button>
                    <button
                      type="button"
                      className="link-button link-button--danger"
                      disabled={busy === s.id}
                      onClick={() =>
                        void run(s.id, () => scheduledApi.remove(conversationId, s.id))
                      }
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

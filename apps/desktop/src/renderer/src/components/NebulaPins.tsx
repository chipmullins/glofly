import { useEffect, useRef } from 'react'
import { attachmentSummary, shortBody } from '@glofly/shared'
import type { PinnedMessage, PublicUser } from '../../../preload/api-types'
import { colorsFor } from '../lib/avatarColors'
import { AvatarFace } from './Avatar'
import EmojiText from './EmojiText'
import './NebulaPins.css'

// 0.7.5 Constellations (canvas board 8, approved): a "📌 3" chip next to a nebula's topic opens
// its pinned messages right there: who, when, the message, who pinned it, Jump and Unpin.

function when(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return time
  const week = 6 * 24 * 60 * 60_000
  if (now.getTime() - d.getTime() < week)
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function NebulaPinsChip({
  count,
  open,
  onToggle
}: {
  count: number
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={open ? 'cx-pins-chip cx-pins-chip--open' : 'cx-pins-chip'}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`${count} pinned ${count === 1 ? 'message' : 'messages'}`}
      title="Pinned messages"
      onClick={onToggle}
    >
      <span aria-hidden="true">📌</span> {count}
    </button>
  )
}

export function NebulaPinsPopover({
  nebulaName,
  pins,
  canPin,
  personOf,
  onJump,
  onUnpin,
  onClose
}: {
  nebulaName: string
  pins: PinnedMessage[]
  canPin: boolean
  personOf: (userId: string) => PublicUser | null | undefined
  onJump: (messageId: string) => void
  onUnpin: (messageId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  // Closes on Escape or a click outside (the chip toggles it itself).
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement
      if (ref.current?.contains(t) || t.closest?.('.cx-pins-chip')) return
      close.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    ref.current?.focus()
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [])
  return (
    <div
      ref={ref}
      className="cx-pins-pop"
      role="dialog"
      aria-label={`Pinned in ${nebulaName}`}
      tabIndex={-1}
    >
      <div className="cx-pins-pop-head">
        <span className="cx-pins-pop-title">
          <span aria-hidden="true">📌</span> Pinned in <EmojiText text={nebulaName} />
        </span>
        <button
          type="button"
          className="cx-pins-pop-close"
          aria-label="Close pinned messages"
          onClick={onClose}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
      <div className="cx-pins-pop-list">
        {pins.map((p) => {
          const m = p.message
          const sender = personOf(m.senderId)
          const by = p.pinnedBy ? personOf(p.pinnedBy) : undefined
          const name = sender?.displayName ?? 'Former member'
          const text = shortBody(m.body) || attachmentSummary(m.attachments) || 'Message'
          const [bg, fg] = colorsFor(m.senderId)
          return (
            <div key={m.id} className="cx-pins-pop-item">
              <span
                className="cx-pins-pop-face"
                style={{ background: bg, color: fg }}
                aria-hidden="true"
              >
                <AvatarFace id={m.senderId} name={name} avatarVersion={sender?.avatarVersion} />
              </span>
              <div className="cx-pins-pop-text">
                <div className="cx-pins-pop-meta">
                  <b>{name.split(/\s+/)[0]}</b>
                  <time dateTime={m.createdAt}>{when(m.createdAt)}</time>
                </div>
                <div className="cx-pins-pop-body">
                  <EmojiText text={text.length > 240 ? `${text.slice(0, 240)}…` : text} />
                </div>
                {by && (
                  <div className="cx-pins-pop-by">Pinned by {by.displayName.split(/\s+/)[0]}</div>
                )}
              </div>
              <div className="cx-pins-pop-actions">
                <button type="button" className="cx-pins-pop-jump" onClick={() => onJump(m.id)}>
                  Jump
                </button>
                {canPin && (
                  <button type="button" className="cx-pins-pop-unpin" onClick={() => onUnpin(m.id)}>
                    Unpin
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

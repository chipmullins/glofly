import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConstellationColor } from '@glofly/shared/constellations'
import { attachmentSummary, shortBody } from '@glofly/shared'
import type { ForwardTarget, Message, PublicUser } from '../../../preload/api-types'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import { ConstellationIcon } from '../constellations/bits'
import './dialogs.css'
import './Forward.css'

const MAX = 5

/**
 * 0.9.3 Forward a message (approved board 1): the message, a search, recent chats, groups and
 * nebulas with checkboxes (up to 5), an optional note, then Forward.
 */
export default function ForwardDialog({
  message,
  sender,
  onClose,
  onSent
}: {
  message: Message
  sender: PublicUser | null
  onClose: () => void
  /** How it went ("Forwarded to 2 places.", or what failed) */
  onSent: (summary: string) => void
}): React.JSX.Element {
  const [targets, setTargets] = useState<ForwardTarget[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    void window.glofly.conversations.forwardTargets().then((r) => {
      if (r.ok) setTargets(r.data)
      else setProblem(r.message ?? "Couldn't load your chats. Try again.")
    })
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[@#]/, '')
    const list = targets ?? []
    if (!q) return list
    return list.filter((t) =>
      [t.title, t.subtitle ?? ''].some((s) => s.toLowerCase().replace(/^[@#]/, '').includes(q))
    )
  }, [targets, query])

  const toggle = (id: string): void =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id]))

  async function forward(): Promise<void> {
    if (!picked.length || busy) return
    setBusy(true)
    setProblem(null)
    const r = await window.glofly.conversations.forward(message.id, picked, note)
    setBusy(false)
    if (!r.ok) {
      setProblem(r.message ?? "Couldn't forward it. Try again.")
      return
    }
    const failed = r.data.failed
    if (failed.length && !r.data.sent.length) {
      setProblem(failed[0].reason)
      return
    }
    const name = (id: string): string => targets?.find((t) => t.conversationId === id)?.title ?? 'one place'
    onSent(
      failed.length
        ? `Forwarded to ${r.data.sent.length}. Not sent to ${name(failed[0].conversationId)}: ${failed[0].reason}`
        : r.data.sent.length === 1
          ? `Forwarded to ${name(r.data.sent[0].conversationId)}.`
          : `Forwarded to ${r.data.sent.length} places.`
    )
  }

  const preview = (shortBody(message.body) || attachmentSummary(message.attachments)).trim()
  const fromName = message.forwarded?.name ?? sender?.displayName ?? 'someone'

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog dialog--panel forward-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forward-title"
      >
        <div className="forward-head">
          <h1 id="forward-title">Forward message</h1>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="forward-quote">
          <span className="forward-quote-from">From {fromName}</span>
          <span className="forward-quote-text">
            <EmojiText text={preview.length > 220 ? `${preview.slice(0, 220)}…` : preview} />
          </span>
        </div>
        <input
          ref={searchRef}
          className="forward-search"
          type="search"
          aria-label="Search people, groups and nebulas"
          placeholder="Search people, groups and nebulas"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="forward-list" role="group" aria-label={query ? 'Results' : 'Recent'}>
          {!query && <span className="forward-label">RECENT</span>}
          {targets === null && !problem && <span className="forward-empty">Loading your chats…</span>}
          {targets !== null && shown.length === 0 && (
            <span className="forward-empty">
              {query ? `Nothing matches “${query}”.` : 'No chats to forward to yet.'}
            </span>
          )}
          {shown.map((t) => {
            const on = picked.includes(t.conversationId)
            const full = !on && picked.length >= MAX
            return (
              <label key={t.conversationId} className={on ? 'forward-row forward-row--on' : 'forward-row'} aria-disabled={full || undefined}>
                <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(t.conversationId)} />
                <span className="forward-check" aria-hidden="true" />
                {t.kind === 'dm' && t.userId ? (
                  <Avatar id={t.userId} name={t.title} avatarVersion={t.avatarVersion} size={36} />
                ) : t.kind === 'nebula' && t.constellationId ? (
                  <ConstellationIcon
                    id={t.constellationId}
                    name={t.subtitle ?? t.title}
                    color={(t.color ?? 'violet') as ConstellationColor}
                    iconVersion={t.iconVersion}
                    className="forward-cx-icon"
                  />
                ) : (
                  <span className="forward-group-icon" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="9" cy="8" r="3.5" />
                      <path d="M2.5 19c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
                      <circle cx="17" cy="9" r="2.5" />
                      <path d="M17 14c2.3 0 4 1.2 4.6 3.6" />
                    </svg>
                  </span>
                )}
                <span className="forward-row-text">
                  <b>
                    <EmojiText text={t.title} />
                  </b>
                  {t.subtitle && (
                    <span>
                      <EmojiText text={t.subtitle} />
                    </span>
                  )}
                </span>
              </label>
            )
          })}
        </div>
        <input
          className="forward-search"
          aria-label="Add a note (optional)"
          placeholder="Add a note (optional)"
          maxLength={4000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) void forward()
          }}
        />
        {problem && (
          <p className="dialog-message" role="alert">
            {problem}
          </p>
        )}
        <div className="forward-foot">
          <span className="forward-count" aria-live="polite">
            {picked.length ? `Sending to ${picked.length} of up to ${MAX}` : `Pick up to ${MAX}`}
          </span>
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={!picked.length || busy}
            onClick={() => void forward()}
          >
            {busy ? 'Forwarding…' : 'Forward'}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import type { PublicUser, ReportReason } from '../../../preload/api-types'
import { CloseIcon } from './icons'
import './dialogs.css'
import './Safety.css'

// "Report message" (message menu) or "Report @maya" (profile card). The Glofly team sees what
// was reported in Glofly Control: the message and a few around it, as you see them now.

const REASONS: { id: ReportReason; label: string; desc: string }[] = [
  {
    id: 'harassment',
    label: 'Harassment or bullying',
    desc: 'Picking on, threatening or targeting someone'
  },
  { id: 'spam', label: 'Spam', desc: 'Ads, scams or the same thing over and over' },
  { id: 'hate', label: 'Hate', desc: 'Attacking people for who they are' },
  {
    id: 'sexual',
    label: 'Sexual content',
    desc: 'Unwanted or explicit sexual messages or pictures'
  },
  { id: 'violence', label: 'Violence or threats', desc: 'Threatening to hurt someone' },
  { id: 'self_harm', label: 'Self-harm', desc: 'Someone may be in danger of hurting themselves' },
  { id: 'other', label: 'Something else', desc: 'Tell us what happened below' }
]

type ReportDialogProps = {
  /** Who's being reported (the message's sender, or the person) */
  person: PublicUser
  /** Reporting one message (otherwise the person) */
  message: { id: string; conversationId: string; preview: string } | null
  /** Already blocked: no "Also block" box */
  canBlock: boolean
  /** Communities round 2: a nebula message (its constellation's moderators see it too) */
  toModerators?: boolean
  onClose: () => void
  onSessionExpired: () => void
  /** After sending (blocked: they also blocked the person) */
  onDone: (blocked: boolean) => void
}

export default function ReportDialog({
  person,
  message,
  canBlock,
  toModerators = false,
  onClose,
  onSessionExpired,
  onDone
}: ReportDialogProps): React.JSX.Element {
  const [reason, setReason] = useState<ReportReason | null>(null)
  const [details, setDetails] = useState('')
  const [block, setBlock] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function send(): Promise<void> {
    if (!reason) {
      setError("Pick what's wrong.")
      return
    }
    if (reason === 'other' && !details.trim()) {
      setError('Tell us a little about what happened.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.glofly.reports.send({
      ...(message
        ? { messageId: message.id, conversationId: message.conversationId }
        : { userId: person.id }),
      reason,
      ...(details.trim() ? { details: details.trim() } : {}),
      ...(block ? { block: true } : {})
    })
    setBusy(false)
    if (!result.ok) {
      if (result.error === 'unauthorized') onSessionExpired()
      else setError(result.message)
      return
    }
    setSent(true)
    onDone(block)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="dialog dialog--panel report-dialog"
      >
        <div className="dialog-head">
          <div>
            <h1 id="report-title">{message ? 'Report message' : `Report @${person.username}`}</h1>
            <p>
              {sent
                ? 'Thanks for telling us.'
                : message
                  ? toModerators
                    ? `From ${person.displayName}. The moderators of this constellation and the Glofly team will see it.`
                    : `From ${person.displayName}. The Glofly team will see this message and a few around it.`
                  : `The Glofly team will see your recent messages with ${person.displayName}.`}
            </p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {sent ? (
          <>
            <div className="report-sent">
              <p>
                We&apos;ll review it and take action if it breaks the rules. You won&apos;t hear
                back about what happens, but it helps keep Glofly safe.
              </p>
              {block && <p>You&apos;ve also blocked @{person.username}.</p>}
              {reason === 'self_harm' && (
                <p className="report-urgent">
                  If someone is in immediate danger, call your local emergency number (911 in the
                  US). In the US you can also call or text 988 for the Suicide &amp; Crisis
                  Lifeline.
                </p>
              )}
            </div>
            <div className="confirm-actions">
              <button
                type="button"
                className="small-button small-button--primary"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            {message && (
              <blockquote className="report-quote">
                <strong>{person.displayName}</strong>
                <span>{message.preview || 'Photo or file'}</span>
              </blockquote>
            )}
            <fieldset className="report-reasons">
              <legend>What&apos;s wrong?</legend>
              {REASONS.map((r) => (
                <label
                  key={r.id}
                  className={reason === r.id ? 'report-reason report-reason--on' : 'report-reason'}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.id}
                    checked={reason === r.id}
                    onChange={() => {
                      setReason(r.id)
                      setError(null)
                    }}
                  />
                  <span>
                    <span className="report-reason-label">{r.label}</span>
                    <span className="report-reason-desc">{r.desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="report-field">
              <label htmlFor="report-details">
                Anything else? <span>(optional)</span>
              </label>
              <textarea
                id="report-details"
                rows={3}
                maxLength={1000}
                value={details}
                placeholder="What happened, in your own words"
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>
            {canBlock && (
              <label className="report-block">
                <input
                  type="checkbox"
                  checked={block}
                  onChange={(e) => setBlock(e.target.checked)}
                />
                Also block @{person.username}
              </label>
            )}
            {error && (
              <p className="dialog-message" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="small-button small-button--quiet" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="small-button small-button--danger"
                disabled={busy}
                onClick={() => void send()}
              >
                {busy ? 'Sending…' : 'Send report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

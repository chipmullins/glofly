import { useId, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { Avatar, Dialog, NoteField } from './common'

// 0.8.2: "Message as Glofly team" (Accounts). In Glofly they see it from "Glofly Team · Official",
// with a reply box when replies are allowed; replies come to Control's Inbox.

const MAX = 1000

export function MessageDialog({
  user,
  onClose,
  onDone
}: {
  user: { id: string; username: string; displayName: string }
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [body, setBody] = useState('')
  const [allowReply, setAllowReply] = useState(true)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

  const send = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    if (!body.trim()) local.body = 'Write the message.'
    if (note.trim().length < 3)
      local.note = 'Add a short note for the audit log (a few words is enough).'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const r = await api.messageUser(user.id, body.trim(), allowReply, note.trim())
    setBusy(false)
    if (r.ok) onDone(r.data.message ?? `Sent to @${user.username}.`)
    else if (r.fields && Object.keys(r.fields).length) setErrors(r.fields)
    else setFormError(r.message)
  }

  return (
    <Dialog
      title="Message as Glofly team"
      intro="They see it in Glofly from the Glofly Team, marked Official."
      onClose={onClose}
      busy={busy}
    >
      <form className="message-form" onSubmit={(e) => void send(e)} noValidate>
        <div className="to-line">
          <span className="hint">To</span>
          <span className="to-chip">
            <Avatar id={user.id} name={user.displayName} />@{user.username}
          </span>
        </div>
        <div className="field">
          <label htmlFor={`${id}-body`}>Message</label>
          <textarea
            id={`${id}-body`}
            className="textarea"
            rows={4}
            maxLength={MAX}
            value={body}
            aria-invalid={errors.body ? true : undefined}
            aria-describedby={`${id}-count${errors.body ? ` ${id}-err` : ''}`}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className="composer-row">
            {errors.body ? (
              <span id={`${id}-err`} className="hint hint--error">
                {errors.body}
              </span>
            ) : (
              <span />
            )}
            <span id={`${id}-count`} className="hint">
              {body.length}/{MAX}
            </span>
          </span>
        </div>
        <label className="check check--card">
          <span className="text">
            <span className="title">Let them reply</span>
            <span className="hint">Replies come to Control’s Inbox</span>
          </span>
          <input
            type="checkbox"
            checked={allowReply}
            onChange={(e) => setAllowReply(e.target.checked)}
          />
        </label>

        <section className="team-preview-wrap" aria-label="What they’ll see">
          <span className="section-label">What they’ll see in Glofly</span>
          <div className="team-preview">
            <span className="team-preview-badge" aria-hidden="true">
              <svg width="20" height="22" viewBox="0 0 24 27">
                <path
                  d="M12 1l10 4v8c0 6.2-4.3 10.9-10 13-5.7-2.1-10-6.8-10-13V5z"
                  fill="#ffc24a"
                />
              </svg>
            </span>
            <span className="team-preview-body">
              <span className="team-preview-from">
                <strong>Glofly Team</strong>
                <span className="team-preview-official">Official</span>
              </span>
              <span className="team-preview-bubble">
                {body.trim() || (
                  <span className="team-preview-empty">Your message shows here.</span>
                )}
              </span>
              {allowReply && <span className="team-preview-reply">Reply…</span>}
            </span>
          </div>
        </section>

        <NoteField
          value={note}
          onChange={setNote}
          error={errors.note}
          placeholder='e.g. "Report follow-up"'
        />
        {formError && (
          <div className="error-box" role="alert">
            {formError}
          </div>
        )}
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

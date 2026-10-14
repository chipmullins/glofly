import { useEffect, useRef, useState } from 'react'
import type { AccountDetails } from '../../../preload/api-types'

// Settings → Account → Email: confirmed or not, "Resend link", "Change email", and a new
// address waiting to be confirmed. Confirming happens in the browser (from the email); the
// server then tells every signed-in device, and the Account page refreshes by itself.

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "Change your email": new address + password. It changes once the new address is confirmed. */
function ChangeEmailDialog({
  currentEmail,
  onSent,
  onCancel,
  onSessionExpired
}: {
  currentEmail: string
  onSent: (pendingEmail: string) => void
  onCancel: () => void
  onSessionExpired: () => void
}): React.JSX.Element {
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ newEmail?: string; password?: string; form?: string }>({})
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    cancelRef.current = onCancel
  })

  useEffect(() => {
    emailRef.current?.focus()
    // Capture first, so Escape closes only this box and not Settings underneath.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancelRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const email = newEmail.trim()
    if (!EMAIL_SHAPE.test(email)) {
      setErrors({ newEmail: 'Enter a valid email address.' })
      emailRef.current?.focus()
      return
    }
    if (email.toLowerCase() === currentEmail.toLowerCase()) {
      setErrors({ newEmail: 'That’s already your email.' })
      emailRef.current?.focus()
      return
    }
    if (!password) {
      setErrors({ password: 'Enter your password.' })
      passwordRef.current?.focus()
      return
    }
    setBusy(true)
    const result = await window.glofly.account.changeEmail(email, password)
    setBusy(false)
    if (result.ok) return onSent(result.data.pendingEmail)
    if (result.error === 'unauthorized') return onSessionExpired()
    const fields = result.fields ?? {}
    if (fields.newEmail || fields.password) {
      setErrors({ newEmail: fields.newEmail, password: fields.password })
      if (fields.password) {
        setPassword('')
        passwordRef.current?.focus()
      } else emailRef.current?.focus()
    } else setErrors({ form: result.message })
  }

  return (
    <div
      className="dialog-backdrop dialog-backdrop--nested"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-title"
        aria-describedby="email-message"
        className="dialog confirm acct-email-dialog"
        onSubmit={submit}
        noValidate
      >
        <h1 id="email-title">Change your email</h1>
        <p id="email-message" className="acct-email-text">
          We’ll email a link to the new address. Your email changes once you click it. Until then,{' '}
          <strong>{currentEmail}</strong> keeps working.
        </p>
        <label className="acct-label" htmlFor="email-new">
          New email
        </label>
        <input
          ref={emailRef}
          id="email-new"
          className="acct-input"
          type="email"
          autoComplete="email"
          spellCheck={false}
          maxLength={254}
          value={newEmail}
          aria-invalid={errors.newEmail ? true : undefined}
          aria-describedby={errors.newEmail ? 'email-new-error' : undefined}
          onChange={(e) => {
            setNewEmail(e.target.value)
            setErrors((x) => ({ ...x, newEmail: undefined, form: undefined }))
          }}
        />
        {errors.newEmail && (
          <span id="email-new-error" className="acct-error" role="alert">
            {errors.newEmail}
          </span>
        )}
        <label className="acct-label acct-label--spaced" htmlFor="email-password">
          Your password
        </label>
        <input
          ref={passwordRef}
          id="email-password"
          className="acct-input"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={password}
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'email-password-error' : undefined}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((x) => ({ ...x, password: undefined, form: undefined }))
          }}
        />
        {errors.password && (
          <span id="email-password-error" className="acct-error" role="alert">
            {errors.password}
          </span>
        )}
        {errors.form && (
          <span className="acct-error" role="alert">
            {errors.form}
          </span>
        )}
        <div className="confirm-actions">
          <button type="button" className="small-button small-button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="small-button small-button--primary" disabled={busy}>
            {busy ? 'Sending…' : 'Send confirm link'}
          </button>
        </div>
      </form>
    </div>
  )
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

export default function EmailSettings({
  details,
  onRefresh,
  onSessionExpired
}: {
  details: AccountDetails | null
  /** Fetch the account details again. */
  onRefresh: () => void
  onSessionExpired: () => void
}): React.JSX.Element {
  // A note belongs to the email state it was written for ("Sent! Check …" is old news once
  // the address is confirmed or changed), so it hides itself when that changes.
  const [rawNote, setRawNote] = useState<{ text: string; bad?: boolean; for: string } | null>(null)
  const noteKey = `${details?.email ?? ''}|${details?.emailVerified ?? ''}`
  const note = rawNote?.for === noteKey ? rawNote : null
  const setNote = (n: { text: string; bad?: boolean } | null): void =>
    setRawNote(n ? { ...n, for: noteKey } : null)
  const [busy, setBusy] = useState(false)
  const [changing, setChanging] = useState(false)
  // Older servers don't say; then there's nothing to confirm or change yet.
  const known = details?.emailVerified !== undefined

  async function resend(): Promise<void> {
    if (busy) return
    setBusy(true)
    const result = await window.glofly.account.resendVerification()
    setBusy(false)
    if (result.ok) setNote({ text: `Sent! Check ${details?.email ?? 'your inbox'}.` })
    else if (result.error === 'unauthorized') onSessionExpired()
    else if (result.error === 'conflict')
      onRefresh() // confirmed in the meantime
    else setNote({ text: result.message, bad: true })
  }

  async function cancelChange(): Promise<void> {
    if (busy) return
    setBusy(true)
    const result = await window.glofly.account.cancelEmailChange()
    setBusy(false)
    if (!result.ok && result.error === 'unauthorized') return onSessionExpired()
    setNote(result.ok ? { text: 'Email change cancelled.' } : { text: result.message, bad: true })
    onRefresh()
  }

  return (
    <div className="settings-card acct-card acct-email">
      <div className="acct-email-row">
        <div className="settings-row-text">
          <span className="settings-row-label acct-email-address">
            <span className="acct-email-value">{details?.email ?? ' '}</span>
            {known &&
              (details?.emailVerified ? (
                <span className="acct-pill acct-pill--good">
                  <CheckIcon />
                  Confirmed
                </span>
              ) : (
                <span className="acct-pill acct-pill--warn">Not confirmed</span>
              ))}
          </span>
          <span className="settings-row-desc">
            {!known
              ? 'Used to log in.'
              : details?.emailVerified
                ? 'Used to log in and to reset your password.'
                : 'Click the link we emailed you, so you can always get back into your account.'}
          </span>
        </div>
        {known && (
          <div className="acct-email-actions">
            {!details?.emailVerified && (
              <button
                type="button"
                className="small-button small-button--quiet"
                disabled={busy}
                onClick={() => void resend()}
              >
                Resend link
              </button>
            )}
            {/* A restricted (family-managed) account's email is changed by their family. */}
            {!details?.restricted && (
              <button
                type="button"
                className="small-button small-button--quiet"
                onClick={() => {
                  setNote(null)
                  setChanging(true)
                }}
              >
                Change email
              </button>
            )}
          </div>
        )}
      </div>

      {details?.pendingEmail && (
        <div className="acct-pending" role="status">
          <span>
            Waiting for you to confirm <strong>{details.pendingEmail}</strong>. The link we sent
            there works for 24 hours.
          </span>
          <button
            type="button"
            className="link-button acct-pending-cancel"
            disabled={busy}
            onClick={() => void cancelChange()}
          >
            Cancel change
          </button>
        </div>
      )}

      {note && (
        <span className={note.bad ? 'acct-error' : 'acct-saved acct-email-note'} role="status">
          {note.text}
        </span>
      )}

      {changing && details && (
        <ChangeEmailDialog
          currentEmail={details.email}
          onSent={(pending) => {
            setChanging(false)
            setNote({ text: `Check ${pending} for the confirm link.` })
            onRefresh()
          }}
          onCancel={() => setChanging(false)}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountDetails, SignedInUser } from '../../../preload/api-types'
import { missingRule, STRENGTH_LABELS, strengthOf } from '../lib/passwords'
import Avatar from './Avatar'
import EmailSettings from './EmailSettings'
import DevicesSettings from './DevicesSettings'

type AccountSettingsProps = {
  user: SignedInUser
  onSessionExpired: () => void
  onAccountDeleted: (deleteAfter: string) => void
}

function LockIcon(): React.JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  )
}

/** "Delete account?": asks for the password, since this signs out everywhere. */
function DeleteAccountDialog({
  onDeleted,
  onCancel,
  onSessionExpired
}: {
  onDeleted: (deleteAfter: string) => void
  onCancel: () => void
  onSessionExpired: () => void
}): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(onCancel)
  useEffect(() => {
    cancelRef.current = onCancel
  })

  useEffect(() => {
    inputRef.current?.focus()
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
    if (!password) {
      setError('Enter your password.')
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    const result = await window.glofly.account.delete(password)
    setBusy(false)
    if (result.ok) return onDeleted(result.data.deleteAfter)
    if (result.error === 'unauthorized') return onSessionExpired()
    setError(result.fields?.password ?? result.message)
    setPassword('')
    inputRef.current?.focus()
  }

  return (
    <div
      className="dialog-backdrop dialog-backdrop--nested"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        aria-describedby="delete-message"
        className="dialog confirm acct-delete-dialog"
        onSubmit={submit}
        noValidate
      >
        <h1 id="delete-title">Delete your account?</h1>
        <div id="delete-message" className="acct-delete-text">
          <p>
            You’ll be signed out everywhere and your account will be hidden right away. After 30
            days, your profile, photo, friends and direct messages (for both people in each chat)
            are removed for good.
          </p>
          <p>Changed your mind? Log in again within 30 days to restore everything.</p>
        </div>
        <label className="acct-label" htmlFor="delete-password">
          Enter your password to confirm
        </label>
        <input
          ref={inputRef}
          id="delete-password"
          className="acct-input"
          type="password"
          autoComplete="current-password"
          value={password}
          maxLength={128}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'delete-error' : undefined}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
        />
        {error && (
          <span id="delete-error" className="acct-error" role="alert">
            {error}
          </span>
        )}
        <div className="confirm-actions">
          <button type="button" className="small-button small-button--quiet" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="small-button small-button--danger" disabled={busy}>
            {busy ? 'Deleting…' : 'Delete account'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function AccountSettings({
  user,
  onSessionExpired,
  onAccountDeleted
}: AccountSettingsProps): React.JSX.Element {
  const [details, setDetails] = useState<AccountDetails | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [signOutOthers, setSignOutOthers] = useState(true)
  const [errors, setErrors] = useState<{ currentPassword?: string; newPassword?: string }>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const currentRef = useRef<HTMLInputElement>(null)
  const nextRef = useRef<HTMLInputElement>(null)

  const loadDetails = useCallback(() => {
    window.glofly.account.get().then((result) => {
      if (result.ok) setDetails(result.data)
      else if (result.error === 'unauthorized') onSessionExpired()
    })
  }, [onSessionExpired])

  // Confirmed or changed in the browser (or on another device): show it right away.
  useEffect(() => {
    loadDetails()
    return window.glofly.onEvent((event) => {
      if (event.type === 'account:changed') loadDetails()
    })
  }, [loadDetails])

  const strength = strengthOf(next)

  async function updatePassword(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (saving) return
    setSaved(null)
    // Quick checks first; the server checks everything again.
    if (!current) {
      setErrors({ currentPassword: 'Enter your current password.' })
      currentRef.current?.focus()
      return
    }
    const missing = missingRule(next)
    if (missing) {
      setErrors({ newPassword: `Your new password needs: ${missing.toLowerCase()}.` })
      nextRef.current?.focus()
      return
    }
    setSaving(true)
    const result = await window.glofly.account.changePassword(current, next, signOutOthers)
    setSaving(false)
    if (result.ok) {
      setErrors({})
      setCurrent('')
      setNext('')
      const n = result.data.signedOut
      setSaved(
        n > 0
          ? `Password updated. Signed out of ${n} other ${n === 1 ? 'device' : 'devices'}.`
          : 'Password updated.'
      )
      return
    }
    if (result.error === 'unauthorized') return onSessionExpired()
    const fields = result.fields ?? {}
    if (fields.currentPassword || fields.newPassword) {
      setErrors({ currentPassword: fields.currentPassword, newPassword: fields.newPassword })
      ;(fields.currentPassword ? currentRef : nextRef).current?.focus()
    } else {
      setErrors({ newPassword: result.message })
    }
  }

  return (
    <>
      <div className="acct-username">
        <Avatar id={user.id} name={user.displayName} avatarVersion={user.avatarVersion} size={48} />
        <div className="acct-username-text">
          <span className="acct-username-handle">@{user.username}</span>
          <span className="settings-row-desc">
            Your username is permanent, so friends can always find you.
          </span>
        </div>
        <span className="acct-lock" title="Usernames can't be changed">
          <LockIcon />
        </span>
      </div>

      <section className="settings-section">
        <h2>Email</h2>
        <EmailSettings
          details={details}
          onRefresh={loadDetails}
          onSessionExpired={onSessionExpired}
        />
      </section>

      <section className="settings-section">
        <h2>Where you’re signed in</h2>
        <DevicesSettings onSessionExpired={onSessionExpired} />
      </section>

      <section className="settings-section">
        <h2>Password</h2>
        <form className="settings-card acct-card" onSubmit={updatePassword} noValidate>
          <div className="acct-grid">
            <div className="acct-field">
              <label className="acct-label" htmlFor="acc-cur">
                Current password
              </label>
              <input
                ref={currentRef}
                id="acc-cur"
                className="acct-input"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                value={current}
                aria-invalid={errors.currentPassword ? true : undefined}
                aria-describedby={errors.currentPassword ? 'acc-cur-error' : undefined}
                onChange={(e) => {
                  setCurrent(e.target.value)
                  setErrors((x) => ({ ...x, currentPassword: undefined }))
                  setSaved(null)
                }}
              />
              {errors.currentPassword && (
                <span id="acc-cur-error" className="acct-error">
                  {errors.currentPassword}
                </span>
              )}
            </div>
            <div className="acct-field">
              <label className="acct-label" htmlFor="acc-new">
                New password
              </label>
              <input
                ref={nextRef}
                id="acc-new"
                className="acct-input"
                type="password"
                autoComplete="new-password"
                maxLength={128}
                value={next}
                aria-invalid={errors.newPassword ? true : undefined}
                aria-describedby={errors.newPassword ? 'acc-new-error' : 'acc-new-strength'}
                onChange={(e) => {
                  setNext(e.target.value)
                  setErrors((x) => ({ ...x, newPassword: undefined }))
                  setSaved(null)
                }}
              />
              <div className="acct-strength" id="acc-new-strength" aria-hidden={!next}>
                <div className="acct-strength-bars">
                  {[1, 2, 3, 4].map((n) => (
                    <span
                      key={n}
                      className={
                        n <= strength
                          ? `acct-strength-bar acct-strength-bar--${strength}`
                          : 'acct-strength-bar'
                      }
                    />
                  ))}
                </div>
                <span className={`acct-strength-label acct-strength-label--${strength}`}>
                  {STRENGTH_LABELS[strength]}
                </span>
              </div>
              {errors.newPassword && (
                <span id="acc-new-error" className="acct-error">
                  {errors.newPassword}
                </span>
              )}
            </div>
          </div>

          <label className="acct-check">
            <input
              type="checkbox"
              checked={signOutOthers}
              onChange={(e) => setSignOutOthers(e.target.checked)}
            />
            Sign me out of Glofly on all other devices
          </label>

          <div className="acct-actions">
            <span className="acct-saved" role="status">
              {saved}
            </span>
            <button type="submit" className="small-button small-button--primary" disabled={saving}>
              {saving ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </section>

      {details?.restricted ? (
        <section className="settings-section">
          <p className="settings-row-desc">
            Your account is managed by your family, so they take care of changing your email or
            deleting the account.
          </p>
        </section>
      ) : (
        <section className="settings-section">
          <h2 className="acct-danger-title">Danger zone</h2>
          <div className="acct-danger">
            <div className="settings-row-text">
              <span className="settings-row-label">Delete account</span>
              <span className="settings-row-desc">
                Permanently removes your profile, friends and messages. You’ll have 30 days to
                change your mind.
              </span>
            </div>
            <button type="button" className="acct-delete-button" onClick={() => setDeleting(true)}>
              Delete account
            </button>
          </div>
        </section>
      )}

      {deleting && (
        <DeleteAccountDialog
          onDeleted={onAccountDeleted}
          onCancel={() => setDeleting(false)}
          onSessionExpired={onSessionExpired}
        />
      )}
    </>
  )
}

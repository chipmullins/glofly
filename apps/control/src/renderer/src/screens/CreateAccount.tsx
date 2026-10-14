import { useEffect, useId, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { Dialog, NoteField, TextField } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import type { AdminUser } from '../../../preload/types'

// "Create an account for someone": Control picks the email, username and display name; the
// person finishes on glofly.app/welcome with their own password, birthday and the Terms.

const USERNAME_RULE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._]*[a-zA-Z0-9])?$/

type Availability = { state: 'idle' | 'checking' | 'good' | 'bad'; message?: string }

export function CreateAccount({
  admin,
  onClose,
  onDone
}: {
  admin: AdminUser
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [addFriend, setAddFriend] = useState(true)
  // 0.4.0: a family account (restricted): for a child, with a parent's OK.
  const [restricted, setRestricted] = useState(false)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // What the server said about a username (kept with the name it was asked about).
  const [checked, setChecked] = useState<{
    name: string
    available: boolean
    reason?: string
  } | null>(null)
  const userId = useId()

  const clean = username.trim().replace(/^@/, '')
  const shapeOk =
    clean.length >= 3 && clean.length <= 20 && USERNAME_RULE.test(clean) && !/[._]{2}/.test(clean)

  // Live "Available" check, like the register screen (a moment after typing stops).
  useEffect(() => {
    if (!shapeOk) return
    let live = true
    const timer = setTimeout(() => {
      void api.usernameAvailable(clean).then((result) => {
        if (live && result.ok) setChecked({ name: clean, ...result.data })
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [clean, shapeOk])

  const available: Availability = !clean
    ? { state: 'idle' }
    : !shapeOk
      ? {
          state: 'bad',
          message:
            '3–20 letters, numbers, periods or underscores; start and end with a letter or number.'
        }
      : checked?.name !== clean
        ? { state: 'checking' }
        : checked.available
          ? { state: 'good' }
          : { state: 'bad', message: checked.reason ?? 'That username is taken.' }

  const first = displayName.trim().split(/\s+/)[0]

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    if (!email.trim()) local.email = 'Enter their email.'
    if (!clean) local.username = 'Choose a username.'
    else if (available.state === 'bad')
      local.username = available.message ?? 'That username is taken.'
    if (!displayName.trim()) local.displayName = 'Enter a display name.'
    if (note.trim().length < 3)
      local.note = 'Add a short note for the audit log (a few words is enough).'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const result = await api.createInvite({
      email: email.trim(),
      username: clean,
      displayName: displayName.trim(),
      addFriend,
      ...(restricted ? { restricted: true } : {}),
      note: note.trim()
    })
    setBusy(false)
    if (result.ok) {
      onDone(result.data.message ?? 'Invite sent.')
      return
    }
    if (result.fields && Object.keys(result.fields).length) setErrors(result.fields)
    else setFormError(result.message)
  }

  const userState = errors.username
    ? 'bad'
    : available.state === 'good'
      ? 'good'
      : available.state === 'bad'
        ? 'bad'
        : undefined

  return (
    <Dialog
      title="Create an account for someone"
      intro="They’ll get an email to finish setting up. They choose their own password, enter their birthday and agree to the Terms themselves."
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        <TextField
          label="Their email"
          type="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          maxLength={254}
        />
        <div className="two-cols">
          <div className="field">
            <label htmlFor={userId}>Username</label>
            <div className="input-wrap" data-state={userState}>
              <span className="prefix" aria-hidden="true">
                @
              </span>
              <input
                id={userId}
                value={username}
                maxLength={21}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={userState === 'bad' ? true : undefined}
                aria-describedby={`${userId}-help`}
                onChange={(e) => setUsername(e.target.value)}
              />
              {available.state === 'good' && !errors.username && (
                <span className="state" style={{ color: 'var(--c-good)' }}>
                  Available
                </span>
              )}
              {available.state === 'checking' && (
                <span className="state" style={{ color: 'var(--c-muted)', fontWeight: 500 }}>
                  Checking…
                </span>
              )}
            </div>
            <span
              id={`${userId}-help`}
              className={
                errors.username || available.state === 'bad'
                  ? 'hint hint--error'
                  : 'hint hint--warn'
              }
              aria-live="polite"
            >
              {errors.username ??
                (available.state === 'bad'
                  ? available.message
                  : 'Permanent. Check it with them first.')}
            </span>
          </div>
          <TextField
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            error={errors.displayName}
            hint="They can change this later."
            maxLength={32}
          />
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={addFriend}
            onChange={(e) => setAddFriend(e.target.checked)}
          />
          Add me (@{admin.username}) as their friend
        </label>

        <label className="check" style={{ alignItems: 'flex-start', paddingTop: 10 }}>
          <input
            type="checkbox"
            checked={restricted}
            style={{ marginTop: 1 }}
            onChange={(e) => setRestricted(e.target.checked)}
          />
          <span>
            Family account (restricted)
            <span className="hint" style={{ display: 'block' }}>
              For a child, only with a parent’s OK. Only you add their friends (in Accounts), and
              the welcome page doesn’t ask them to be 13 or older.
            </span>
          </span>
        </label>

        <NoteField
          value={note}
          onChange={setNote}
          error={errors.note}
          placeholder='e.g. "Friend from work, setting up for testing"'
        />

        <div className="notice">
          <Icon d={ICONS.mail} size={18} strokeWidth={2} />
          <span>
            {first ? `${first} gets` : 'They get'}{' '}
            <strong>“{admin.displayName} invited you to Glofly”</strong> with a link that works for
            7 days. Until they finish, the account shows as <strong>Invited</strong> and can’t be
            used.
          </span>
        </div>

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
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

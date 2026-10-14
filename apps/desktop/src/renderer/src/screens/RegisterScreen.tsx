import { useEffect, useRef, useState } from 'react'
import type { PhotoType, RegisterRequest, SignupMode } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import wordmarkImg from '../assets/glofly-wordmark.png'
import { PRIVACY_URL, TERMS_URL } from '../lib/links'
import './LoginScreen.css'
import './RegisterScreen.css'
import { PASSWORD_RULES, STRENGTH_LABELS } from '../lib/passwords'
import { initials } from '../lib/names'
import { PHOTO_TYPES, readPhoto, type PickedPhoto } from '../lib/photoPick'
import PhotoCropper from '../components/PhotoCropper'

/** The optional profile photo, uploaded right after the account is made. */
export type RegisterPhoto = { data: ArrayBuffer; type: PhotoType }

type RegisterScreenProps = {
  /** Resolves to null on success, or a message per field (and/or a general message). */
  onRegister: (
    request: RegisterRequest,
    photo: RegisterPhoto | null
  ) => Promise<{ fields: Record<string, string>; message?: string } | null>
  onLogin: () => void
  busy?: boolean
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

// Same rules the server enforces (apps/server/src/auth/validation.ts).

type UsernameStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unavailable'; reason: string }

function CheckIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

function CameraIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

function CircleIcon(): React.JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
    </svg>
  )
}

function EyeIcon({ open }: { open: boolean }): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <path d="M4 4l16 16" />}
    </svg>
  )
}

/** Error text under a field, or its helper text when there's no error. */
function Hint({
  id,
  error,
  helper
}: {
  id: string
  error?: string
  helper?: string
}): React.JSX.Element | null {
  if (error) {
    return (
      <span id={id} className="field-hint field-hint--error">
        {error}
      </span>
    )
  }
  return helper ? (
    <span id={id} className="field-hint">
      {helper}
    </span>
  ) : null
}

export default function RegisterScreen({
  onRegister,
  onLogin,
  busy = false
}: RegisterScreenProps): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [year, setYear] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formMessage, setFormMessage] = useState<string | null>(null)
  const [usernameCheck, setUsernameCheck] = useState<{
    name: string
    status: UsernameStatus
  } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Who can sign up (set in Glofly Control): invite only asks for a code; closed says so.
  const [signupMode, setSignupMode] = useState<SignupMode | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  // Optional profile photo: positioned in the crop window, kept here until the account exists.
  const [photo, setPhoto] = useState<(RegisterPhoto & { preview: string }) | null>(null)
  const [cropping, setCropping] = useState<PickedPhoto | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const closed = signupMode === 'closed'
  const locked = busy || submitting || closed

  useEffect(() => {
    let live = true
    window.glofly.auth.signupMode().then((mode) => {
      if (live) setSignupMode(mode)
    })
    return () => {
      live = false
    }
  }, [])

  // Live "Available" check: waits until typing pauses, then asks the server.
  const trimmedUsername = username.trim()
  useEffect(() => {
    if (!trimmedUsername) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await window.glofly.auth.checkUsername(trimmedUsername)
      if (cancelled) return
      const status: UsernameStatus = !result
        ? { state: 'idle' } // offline: checked again on submit
        : result.available
          ? { state: 'available' }
          : { state: 'unavailable', reason: result.reason ?? 'That username is taken.' }
      setUsernameCheck({ name: trimmedUsername, status })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmedUsername])

  // Empty → nothing shown; latest answer matches → show it; otherwise still checking.
  const usernameStatus: UsernameStatus = !trimmedUsername
    ? { state: 'idle' }
    : usernameCheck?.name === trimmedUsername
      ? usernameCheck.status
      : { state: 'checking' }

  const ruleResults = PASSWORD_RULES.map((r) => ({ ...r, met: r.test(password) }))
  const strength = password ? ruleResults.filter((r) => r.met).length : 0

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still counts
    if (!file) return
    const picked = await readPhoto(file)
    if ('error' in picked) {
      setPhotoError(picked.error)
      return
    }
    setPhotoError(null)
    setCropping(picked)
  }

  function clearError(field: string): void {
    if (!errors[field]) return
    setErrors((prev) => {
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  /** Quick checks before bothering the server. The server checks everything again. */
  function checkLocally(): Record<string, string> {
    const found: Record<string, string> = {}
    if (signupMode === 'invite' && !inviteCode.trim()) found.inviteCode = 'Enter your invite code.'
    if (!email.trim()) found.email = 'Enter your email address.'
    if (!username.trim()) found.username = 'Choose a username.'
    else if (usernameStatus.state === 'unavailable') found.username = usernameStatus.reason
    if (!displayName.trim()) found.displayName = 'Enter a display name.'
    const missing = ruleResults.find((r) => r.required && !r.met)
    if (missing) found.password = `Your password needs ${missing.label.toLowerCase()}.`
    if (!month || !day || !year) found.birthday = 'Enter your birthday.'
    if (!acceptTerms) found.acceptTerms = 'Please agree to the Terms of Service and Privacy Policy.'
    return found
  }

  function focusFirstError(fields: Record<string, string>): void {
    const order = [
      'inviteCode',
      'email',
      'username',
      'displayName',
      'password',
      'birthday',
      'acceptTerms'
    ]
    const first = order.find((f) => fields[f])
    if (!first) return
    formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus()
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (locked) return
    setFormMessage(null)

    const local = checkLocally()
    if (Object.keys(local).length) {
      setErrors(local)
      focusFirstError(local)
      return
    }

    const monthNumber = String(MONTHS.indexOf(month) + 1).padStart(2, '0')
    const birthday = `${year.padStart(4, '0')}-${monthNumber}-${day.padStart(2, '0')}`

    setSubmitting(true)
    const failure = await onRegister(
      {
        email: email.trim(),
        username: username.trim(),
        displayName: displayName.trim(),
        password,
        birthday,
        acceptTerms,
        ...(signupMode === 'invite' ? { inviteCode: inviteCode.trim() } : {})
      },
      photo ? { data: photo.data, type: photo.type } : null
    )
    setSubmitting(false)
    if (failure) {
      setErrors(failure.fields)
      setFormMessage(failure.message ?? failure.fields.form ?? null)
      // Sign-ups changed while the form was open (e.g. now invite only): ask again.
      if (failure.fields.inviteCode || failure.fields.form) {
        window.glofly.auth.signupMode().then((mode) => mode && setSignupMode(mode))
      }
      focusFirstError(failure.fields)
    }
  }

  const describe = (field: string, hasHelper = false): string | undefined =>
    errors[field] || hasHelper ? `reg-${field}-hint` : undefined

  return (
    <div className="register">
      <section className="brand">
        <div className="brand-dot reg-dot--1" />
        <img src={fireflyImg} alt="" className="glo-fly glo-fly--1 reg-fly--1" draggable={false} />
        <div className="brand-dot reg-dot--2" />
        <img src={fireflyImg} alt="" className="glo-fly glo-fly--2 reg-fly--2" draggable={false} />
        <img src={fireflyImg} alt="" className="glo-fly glo-fly--3 reg-fly--3" draggable={false} />
        <div className="brand-dot reg-dot--3" />

        <div className="brand-mark">
          <img src={fireflyImg} alt="" draggable={false} />
          Glofly
        </div>

        <div className="brand-hero">
          <h2>
            Glow on.
            <br />
            <span>Say hi.</span>
          </h2>
          <ul className="features">
            <li>
              <span className="feature-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
                </svg>
              </span>
              Instant messages and group chats
            </li>
            <li>
              <span className="feature-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="6" width="14" height="12" rx="2" />
                  <path d="M16 10l6-3v10l-6-3z" />
                </svg>
              </span>
              Voice, video and screen sharing
            </li>
            <li>
              <span className="feature-icon">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="9" cy="8" r="4" />
                  <path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
                  <circle cx="19" cy="7" r="2.5" />
                </svg>
              </span>
              See who&apos;s online, away or busy
            </li>
          </ul>
        </div>

        <div className="brand-tagline">A brighter kind of together.</div>
      </section>

      <section className="form-panel register-panel">
        <div className="titlebar-drag" aria-hidden="true" />
        <form ref={formRef} className="register-form" onSubmit={handleSubmit} noValidate>
          <img src={wordmarkImg} alt="Glofly" className="register-wordmark" draggable={false} />

          <div className="login-heading register-heading">
            <h1>Join Glofly</h1>
            <p>Your people are just a hello away.</p>
          </div>

          {closed && (
            <div className="login-error" role="status">
              <span>
                Glofly isn&apos;t taking new sign-ups right now. Already have an account? Log in
                below.
              </span>
            </div>
          )}

          <div className="fields register-fields">
            {signupMode === 'invite' && (
              <div className="field">
                <label htmlFor="reg-invite">Invite code</label>
                <input
                  id="reg-invite"
                  data-field="inviteCode"
                  className="text-input"
                  placeholder="GLOW-XXXX"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}
                  value={inviteCode}
                  aria-invalid={errors.inviteCode ? true : undefined}
                  aria-describedby="reg-inviteCode-hint"
                  onChange={(e) => {
                    setInviteCode(e.target.value)
                    clearError('inviteCode')
                  }}
                />
                <Hint
                  id="reg-inviteCode-hint"
                  error={errors.inviteCode}
                  helper="Glofly is invite only for now. Ask the person who invited you for a code."
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="reg-email">Email address</label>
              <input
                id="reg-email"
                data-field="email"
                className="text-input"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                spellCheck={false}
                value={email}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={describe('email')}
                onChange={(e) => {
                  setEmail(e.target.value)
                  clearError('email')
                }}
              />
              <Hint id="reg-email-hint" error={errors.email} />
            </div>

            <div className="field">
              <label htmlFor="reg-user">Username</label>
              <div className="username-wrap">
                <span className="username-at" aria-hidden="true">
                  @
                </span>
                <input
                  id="reg-user"
                  data-field="username"
                  className="text-input text-input--username"
                  type="text"
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={20}
                  value={username}
                  aria-invalid={errors.username ? true : undefined}
                  aria-describedby={describe('username', true)}
                  onChange={(e) => {
                    setUsername(e.target.value)
                    clearError('username')
                  }}
                />
                <span className="username-status" aria-live="polite">
                  {usernameStatus.state === 'checking' && (
                    <span className="username-status--checking">Checking…</span>
                  )}
                  {usernameStatus.state === 'available' && (
                    <span className="username-status--available">
                      <CheckIcon size={15} />
                      Available
                    </span>
                  )}
                  {usernameStatus.state === 'unavailable' && (
                    <span className="username-status--taken">Not available</span>
                  )}
                </span>
              </div>
              <Hint
                id="reg-username-hint"
                error={
                  errors.username ??
                  (usernameStatus.state === 'unavailable' ? usernameStatus.reason : undefined)
                }
                helper="Your unique handle. Friends use it to find you."
              />
            </div>

            <div className="field">
              <label htmlFor="reg-display">Display name</label>
              <div className="display-row">
                {/* Optional profile photo: the circle shows your initials until you pick one. */}
                <div className="reg-photo-wrap">
                  <button
                    type="button"
                    className={photo ? 'reg-photo reg-photo--set' : 'reg-photo'}
                    aria-label={photo ? 'Change profile photo' : 'Add a profile photo (optional)'}
                    title={photo ? 'Change photo' : 'Add a photo (optional)'}
                    disabled={locked}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    {photo ? (
                      <img src={photo.preview} alt="" draggable={false} />
                    ) : (
                      <span className="reg-photo-initials" aria-hidden="true">
                        {displayName.trim() ? initials(displayName) : <CameraIcon />}
                      </span>
                    )}
                    {!photo && (
                      <span className="reg-photo-plus" aria-hidden="true">
                        +
                      </span>
                    )}
                  </button>
                  {photo && (
                    <button
                      type="button"
                      className="reg-photo-remove"
                      aria-label="Remove photo"
                      title="Remove photo"
                      disabled={locked}
                      onClick={() => setPhoto(null)}
                    >
                      ×
                    </button>
                  )}
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept={PHOTO_TYPES.join(',')}
                    hidden
                    onChange={(e) => void pickPhoto(e)}
                  />
                </div>
                <input
                  id="reg-display"
                  data-field="displayName"
                  className="text-input"
                  type="text"
                  placeholder="Chip"
                  autoComplete="nickname"
                  maxLength={32}
                  value={displayName}
                  aria-invalid={errors.displayName ? true : undefined}
                  aria-describedby={describe('displayName', true)}
                  onChange={(e) => {
                    setDisplayName(e.target.value)
                    clearError('displayName')
                  }}
                />
              </div>
              <Hint
                id="reg-displayName-hint"
                error={errors.displayName ?? photoError ?? undefined}
                helper={
                  photo
                    ? 'What friends see in chats. Click the photo to change it.'
                    : 'What friends see in chats. Adding a photo is optional.'
                }
              />
            </div>

            <div className="field">
              <label htmlFor="reg-pass">Password</label>
              <div className="password-wrap">
                <input
                  id="reg-pass"
                  data-field="password"
                  className="text-input text-input--password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  maxLength={128}
                  value={password}
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby="reg-password-rules"
                  onChange={(e) => {
                    setPassword(e.target.value)
                    clearError('password')
                  }}
                />
                <button
                  type="button"
                  className="eye-button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  <EyeIcon open={!showPassword} />
                </button>
              </div>
              <div className="strength" aria-hidden={!password}>
                <div className="strength-bars">
                  {[1, 2, 3, 4].map((n) => (
                    <span
                      key={n}
                      className={n <= strength ? 'strength-bar strength-bar--on' : 'strength-bar'}
                    />
                  ))}
                </div>
                <span className={`strength-label strength-label--${strength}`}>
                  {STRENGTH_LABELS[strength]}
                </span>
              </div>
              <ul id="reg-password-rules" className="password-rules">
                {ruleResults.map((r) => (
                  <li key={r.id} className={r.met ? 'rule rule--met' : 'rule'}>
                    {r.met ? <CheckIcon /> : <CircleIcon />}
                    {r.label}
                    {!r.required && <span className="visually-hidden"> (optional)</span>}
                  </li>
                ))}
              </ul>
              {errors.password && (
                <span className="field-hint field-hint--error">{errors.password}</span>
              )}
            </div>

            <fieldset className="birthday" aria-describedby="reg-birthday-hint">
              <legend>Birthday</legend>
              <div className="birthday-row">
                <select
                  aria-label="Month"
                  data-field="birthday"
                  className={
                    month
                      ? 'text-input birthday-select'
                      : 'text-input birthday-select birthday-select--empty'
                  }
                  value={month}
                  aria-invalid={errors.birthday ? true : undefined}
                  onChange={(e) => {
                    setMonth(e.target.value)
                    clearError('birthday')
                  }}
                >
                  <option value="" disabled>
                    Month
                  </option>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Day"
                  className="text-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Day"
                  maxLength={2}
                  value={day}
                  aria-invalid={errors.birthday ? true : undefined}
                  onChange={(e) => {
                    setDay(e.target.value.replace(/\D/g, ''))
                    clearError('birthday')
                  }}
                />
                <input
                  aria-label="Year"
                  className="text-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="Year"
                  maxLength={4}
                  value={year}
                  aria-invalid={errors.birthday ? true : undefined}
                  onChange={(e) => {
                    setYear(e.target.value.replace(/\D/g, ''))
                    clearError('birthday')
                  }}
                />
              </div>
              <Hint
                id="reg-birthday-hint"
                error={errors.birthday}
                helper="Used to confirm your age. Never shown on your profile."
              />
            </fieldset>

            <div className="field">
              <label className="terms">
                <input
                  type="checkbox"
                  data-field="acceptTerms"
                  checked={acceptTerms}
                  aria-invalid={errors.acceptTerms ? true : undefined}
                  onChange={(e) => {
                    setAcceptTerms(e.target.checked)
                    clearError('acceptTerms')
                  }}
                />
                <span>
                  I agree to the{' '}
                  <a
                    className="link-button link-button--strong"
                    href={TERMS_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a
                    className="link-button link-button--strong"
                    href={PRIVACY_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Privacy Policy
                  </a>
                </span>
              </label>
              {errors.acceptTerms && (
                <span className="field-hint field-hint--error">{errors.acceptTerms}</span>
              )}
            </div>
          </div>

          {formMessage && (
            <div className="login-error" role="alert">
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
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7.5v5" />
                <path d="M12 16.2v.3" />
              </svg>
              <span>{formMessage}</span>
            </div>
          )}

          <button type="submit" className="login-submit" disabled={locked} aria-busy={submitting}>
            Create account
          </button>

          <p className="login-footer">
            Already have an account?{' '}
            <button type="button" className="link-button link-button--strong" onClick={onLogin}>
              Log in
            </button>
          </p>
        </form>
      </section>
      {cropping && (
        <PhotoCropper
          src={cropping.src}
          animated={cropping.type === 'image/gif'}
          onApply={({ data, preview }) => {
            setPhoto({ data, type: 'image/webp', preview })
            setCropping(null)
          }}
          onUseWhole={() => {
            setPhoto({ data: cropping.data, type: cropping.type, preview: cropping.src })
            setCropping(null)
          }}
          onCancel={() => setCropping(null)}
        />
      )}
    </div>
  )
}

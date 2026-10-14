import { useRef, useState } from 'react'
import fireflyImg from '../assets/firefly.png'
import wordmarkImg from '../assets/glofly-wordmark.png'
import './LoginScreen.css'

export type LoginDetails = {
  identifier: string
  password: string
  keepSignedIn: boolean
  /** Restores an account that's set to be deleted. */
  restore?: boolean
}

/** Why a login didn't go through: a message, or an account that's set to be deleted. */
export type LoginProblem = { message: string } | { deleteAfter: string }

type LoginScreenProps = {
  /** Resolves to null on success, or what went wrong. */
  onLogin: (details: LoginDetails) => Promise<LoginProblem | null>
  onCreateAccount: () => void
  busy?: boolean
  /** Shown above the form, e.g. after deleting an account. */
  notice?: string | null
}

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

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

function ErrorBox({ id, message }: { id: string; message: string }): React.JSX.Element {
  return (
    <div id={id} className="login-error" role="alert">
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
      <span>{message}</span>
    </div>
  )
}

/** "Forgot password?": emails a link to choose a new password on glofly.app. */
function ForgotPasswordForm({
  initialIdentifier,
  onBack
}: {
  initialIdentifier: string
  onBack: (identifier: string) => void
}): React.JSX.Element {
  const [identifier, setIdentifier] = useState(initialIdentifier)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What they typed, once the email has gone out. */
  const [sentTo, setSentTo] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (sending) return
    const value = identifier.trim()
    if (!value) {
      setError('Enter your username or email.')
      inputRef.current?.focus()
      return
    }
    setSending(true)
    setError(null)
    const result = await window.glofly.auth.forgotPassword(value)
    setSending(false)
    if (result.ok) setSentTo(value)
    else {
      setError(result.message)
      inputRef.current?.focus()
    }
  }

  if (sentTo) {
    return (
      <div className="login-form">
        <img src={wordmarkImg} alt="Glofly" className="login-wordmark" draggable={false} />
        <div className="login-heading">
          <h1>Check your email</h1>
          <p>
            If <strong className="login-sent-to">{sentTo}</strong> belongs to a Glofly account,
            we&apos;ve emailed it a link to choose a new password.
          </p>
        </div>
        <div className="login-note" role="status">
          The link works for 1 hour. Nothing there in a few minutes? Check your spam folder, or try
          again.
        </div>
        <button type="button" className="login-submit" autoFocus onClick={() => onBack(sentTo)}>
          Back to log in
        </button>
        <p className="login-footer">
          Didn&apos;t get it?{' '}
          <button
            type="button"
            className="link-button link-button--strong"
            onClick={() => setSentTo(null)}
          >
            Send another link
          </button>
        </p>
      </div>
    )
  }

  return (
    <form className="login-form" onSubmit={submit} noValidate>
      <img src={wordmarkImg} alt="Glofly" className="login-wordmark" draggable={false} />
      <div className="login-heading">
        <h1>Forgot your password?</h1>
        <p>It happens. We&apos;ll email you a link to choose a new one.</p>
      </div>

      <div className="fields">
        <div className="field">
          <label htmlFor="forgot-user">Username or email</label>
          <input
            ref={inputRef}
            id="forgot-user"
            className="text-input"
            type="text"
            placeholder="yourname"
            autoComplete="username"
            autoFocus
            spellCheck={false}
            maxLength={254}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'forgot-error' : undefined}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value)
              setError(null)
            }}
          />
        </div>
      </div>

      {error && <ErrorBox id="forgot-error" message={error} />}

      <button type="submit" className="login-submit" disabled={sending} aria-busy={sending}>
        {sending ? 'Sending…' : 'Email me a link'}
      </button>

      <p className="login-footer">
        Remembered it?{' '}
        <button
          type="button"
          className="link-button link-button--strong"
          onClick={() => onBack(identifier.trim())}
        >
          Back to log in
        </button>
      </p>
    </form>
  )
}

export default function LoginScreen({
  onLogin,
  onCreateAccount,
  busy = false,
  notice = null
}: LoginScreenProps): React.JSX.Element {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Right password, but the account is set to be deleted on this date: offer to restore it. */
  const [restoreBy, setRestoreBy] = useState<string | null>(null)
  const [forgot, setForgot] = useState(false)
  const userRef = useRef<HTMLInputElement>(null)
  const passRef = useRef<HTMLInputElement>(null)
  const locked = busy || submitting

  // Pressing Enter in either field submits, because this is a real <form>.
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault()
    if (locked) return
    if (!identifier.trim()) {
      userRef.current?.focus()
      return
    }
    if (!password) {
      passRef.current?.focus()
      return
    }
    await attempt(false)
  }

  async function attempt(restore: boolean): Promise<void> {
    setSubmitting(true)
    setError(null)
    const problem = await onLogin({
      identifier: identifier.trim(),
      password,
      keepSignedIn,
      restore
    })
    setSubmitting(false)
    if (!problem) return
    if ('deleteAfter' in problem) {
      setRestoreBy(problem.deleteAfter)
      return
    }
    setRestoreBy(null)
    setError(problem.message)
    setPassword('')
    passRef.current?.focus()
  }

  function cancelRestore(): void {
    setRestoreBy(null)
    setPassword('')
    passRef.current?.focus()
  }

  return (
    <div className="login">
      <section className="brand">
        <div className="brand-dot brand-dot--1" />
        <img src={fireflyImg} alt="" className="glo-fly glo-fly--1" draggable={false} />
        <div className="brand-dot brand-dot--2" />
        <img src={fireflyImg} alt="" className="glo-fly glo-fly--2" draggable={false} />
        <img src={fireflyImg} alt="" className="glo-fly glo-fly--3" draggable={false} />
        <div className="brand-dot brand-dot--3" />

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
          <div className="bubbles">
            <div className="bubble bubble--them">Hey! We gaming tonight?</div>
            <div className="bubble bubble--me">Duh! It&apos;s MMO time!</div>
            <div className="bubble--typing" aria-label="Typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>

        <div className="brand-tagline">A brighter kind of together.</div>
      </section>

      <section className="form-panel">
        <div className="titlebar-drag" aria-hidden="true" />
        {forgot ? (
          <ForgotPasswordForm
            initialIdentifier={identifier.trim()}
            onBack={(typed) => {
              if (typed) setIdentifier(typed)
              setPassword('')
              setError(null)
              setForgot(false)
            }}
          />
        ) : (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <img src={wordmarkImg} alt="Glofly" className="login-wordmark" draggable={false} />

            <div className="login-heading">
              <h1>Welcome back!</h1>
              <p>We knew you couldn&apos;t stay away.</p>
            </div>

            {notice && !restoreBy && (
              <div className="login-note" role="status">
                {notice}
              </div>
            )}

            {restoreBy && (
              <div className="login-restore" role="alert">
                <strong>This account is set to be deleted on {longDate(restoreBy)}.</strong>
                <span>
                  Restore it to get your profile, friends and messages back, just as they were.
                </span>
                <div className="login-restore-actions">
                  <button
                    type="button"
                    className="login-restore-yes"
                    disabled={locked}
                    onClick={() => void attempt(true)}
                  >
                    Restore my account
                  </button>
                  <button type="button" className="link-button" onClick={cancelRestore}>
                    Not now
                  </button>
                </div>
              </div>
            )}

            <div className="fields">
              <div className="field">
                <label htmlFor="login-user">Username or email</label>
                <input
                  ref={userRef}
                  id="login-user"
                  className="text-input"
                  type="text"
                  placeholder="yourname"
                  autoComplete="username"
                  autoFocus
                  spellCheck={false}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? 'login-error' : undefined}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </div>

              <div className="field">
                <div className="field-label-row">
                  <label htmlFor="login-pass">Password</label>
                  <button
                    type="button"
                    className="link-button link-button--small"
                    onClick={() => setForgot(true)}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="password-wrap">
                  <input
                    ref={passRef}
                    id="login-pass"
                    className="text-input text-input--password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
              </div>

              <label className="remember">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                />
                Keep me signed in
              </label>
            </div>

            {error && <ErrorBox id="login-error" message={error} />}

            <button type="submit" className="login-submit" disabled={locked} aria-busy={submitting}>
              Log in
            </button>

            <p className="login-footer">
              New here?{' '}
              <button
                type="button"
                className="link-button link-button--strong"
                onClick={onCreateAccount}
              >
                Create an account
              </button>
            </p>
          </form>
        )}
      </section>
    </div>
  )
}

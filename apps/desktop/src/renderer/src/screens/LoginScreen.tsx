import { useRef, useState } from 'react'
import fireflyImg from '../assets/firefly.png'
import wordmarkImg from '../assets/glofly-wordmark.png'
import './LoginScreen.css'

export type LoginDetails = {
  identifier: string
  password: string
  keepSignedIn: boolean
}

type LoginScreenProps = {
  onLogin: (details: LoginDetails) => void
  busy?: boolean
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

export default function LoginScreen({
  onLogin,
  busy = false
}: LoginScreenProps): React.JSX.Element {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const userRef = useRef<HTMLInputElement>(null)
  const passRef = useRef<HTMLInputElement>(null)

  // Pressing Enter in either field submits, because this is a real <form>.
  function handleSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault()
    if (busy) return
    if (!identifier.trim()) {
      userRef.current?.focus()
      return
    }
    if (!password) {
      passRef.current?.focus()
      return
    }
    onLogin({ identifier: identifier.trim(), password, keepSignedIn })
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
            A little hello.
            <br />
            <span>A lot of connection.</span>
          </h2>
          <div className="bubbles">
            <div className="bubble bubble--them">Hey! You on tonight?</div>
            <div className="bubble bubble--me">Always. Calling you now.</div>
            <div className="bubble--typing" aria-label="Typing">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>

        <div className="brand-tagline">Say it. Send it. Glofly.</div>
      </section>

      <section className="form-panel">
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <img src={wordmarkImg} alt="Glofly" className="login-wordmark" draggable={false} />

          <div className="login-heading">
            <h1>Welcome back!</h1>
            <p>We knew you couldn&apos;t stay away.</p>
          </div>

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
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>

            <div className="field">
              <div className="field-label-row">
                <label htmlFor="login-pass">Password</label>
                <button type="button" className="link-button link-button--small">
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

          <button type="submit" className="login-submit" disabled={busy}>
            Log in
          </button>

          <p className="login-footer">
            New here?{' '}
            <button type="button" className="link-button link-button--strong">
              Create an account
            </button>
          </p>
        </form>
      </section>
    </div>
  )
}

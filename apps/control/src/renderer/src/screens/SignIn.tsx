import { useEffect, useRef, useState, type JSX } from 'react'
import { Icon, ICONS, Logo } from '../components/icons'
import type { SignInCodeResult } from '../../../preload/types'

// Two steps, every time: the admin password (not the Glofly one), then a code from the
// authenticator app (or one of the backup codes).

type Step = { kind: 'password' } | { kind: 'code'; username: string; backup: boolean }

export function SignIn({
  notice,
  onSignedIn
}: {
  notice: string | null
  onSignedIn: (result: Extract<SignInCodeResult, { ok: true }>) => void
}): JSX.Element {
  const [step, setStep] = useState<Step>({ kind: 'password' })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.control.setScreen('signin')
  }, [])

  useEffect(() => {
    if (step.kind === 'code') codeRef.current?.focus()
  }, [step])

  async function submitPassword(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    if (!username.trim() || !password) {
      setError('Enter your username and admin password.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.control.signIn.password(username.trim(), password)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setPassword('')
    setCode('')
    setStep({ kind: 'code', username: result.username, backup: false })
  }

  async function submitCode(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || step.kind !== 'code') return
    const value = code.trim()
    if (!step.backup && !/^\d{6}$/.test(value.replace(/\s/g, ''))) {
      setError('Enter the 6-digit code.')
      return
    }
    if (step.backup && value.replace(/[^A-Za-z0-9]/g, '').length !== 10) {
      setError('Backup codes look like ABCDE-23456.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await window.control.signIn.code(step.backup ? 'backupCode' : 'code', value)
    setBusy(false)
    if (result.ok) {
      onSignedIn(result)
      return
    }
    setCode('')
    if (result.error === 'start_over') {
      setStep({ kind: 'password' })
      setError(result.message)
      return
    }
    setError(result.message)
    codeRef.current?.focus()
  }

  const startOver = (): void => {
    setStep({ kind: 'password' })
    setError(null)
    setCode('')
  }

  return (
    <div className="signin">
      <div className="titlebar" aria-hidden="true" />
      <div className="signin-inner">
        <div className="signin-brand">
          <Logo size={64} />
          <div>
            <div className="name">Glofly Control</div>
            <div className="sub">For Glofly&apos;s admin only</div>
          </div>
        </div>

        {notice && (
          <div className="signin-notice" role="status">
            {notice}
          </div>
        )}

        {step.kind === 'password' ? (
          <form className="signin-card" onSubmit={submitPassword} noValidate>
            <div className="steps">
              <span className="current">Step 1 of 2</span>
              <span className="line" />
              <span>Code</span>
            </div>
            <div>
              <h1>Sign in</h1>
              <p>Use your Glofly username and your admin password (not your Glofly password).</p>
            </div>
            <div className="field">
              <label htmlFor="si-user">Username</label>
              <input
                id="si-user"
                className="input"
                value={username}
                autoComplete="username"
                spellCheck={false}
                autoFocus
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="si-pass">Admin password</label>
              <input
                id="si-pass"
                className="input"
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ minHeight: 48 }}
            >
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        ) : (
          <form className="signin-card" onSubmit={submitCode} noValidate>
            <div className="steps">
              <span className="done">
                <Icon d={ICONS.check} size={15} strokeWidth={3} />
                Password
              </span>
              <span className="line" />
              <span className="current">Step 2 of 2</span>
            </div>
            <div>
              <h1>{step.backup ? 'Enter a backup code' : 'Enter your code'}</h1>
              <p>
                {step.backup ? (
                  'One of the backup codes you saved when Control was set up. Each works once.'
                ) : (
                  <>
                    Open your authenticator app and type the 6-digit code for{' '}
                    <strong style={{ color: 'var(--c-ink)' }}>Glofly Control</strong>.
                  </>
                )}
              </p>
            </div>
            <div className="field">
              <label htmlFor="si-code">{step.backup ? 'Backup code' : 'Code'}</label>
              <input
                ref={codeRef}
                id="si-code"
                className={`code-input${step.backup ? ' code-input--backup' : ''}`}
                value={code}
                inputMode={step.backup ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                maxLength={step.backup ? 14 : 7}
                spellCheck={false}
                aria-describedby="si-code-help"
                onChange={(e) =>
                  setCode(step.backup ? e.target.value : e.target.value.replace(/[^\d ]/g, ''))
                }
              />
              <span id="si-code-help" className="hint" style={{ fontSize: 13 }}>
                {step.backup ? 'Like ABCDE-23456.' : 'A new code appears every 30 seconds.'}
              </span>
            </div>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn btn--primary"
              disabled={busy}
              style={{ minHeight: 48 }}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <div className="signin-links">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setStep({ ...step, backup: !step.backup })
                  setCode('')
                  setError(null)
                }}
              >
                {step.backup ? 'Use the authenticator app' : 'Use a backup code'}
              </button>
              <button type="button" className="link-btn" onClick={startOver}>
                Not @{step.username}? Start over
              </button>
            </div>
          </form>
        )}

        <p className="signin-foot">
          <Icon d={ICONS.lock} size={15} strokeWidth={2} />
          Only works from your home network · every action is logged
        </p>
      </div>
    </div>
  )
}

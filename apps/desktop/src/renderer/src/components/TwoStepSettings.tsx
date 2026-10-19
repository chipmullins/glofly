import { useCallback, useEffect, useRef, useState } from 'react'
import type { TwoStepStatus } from '../../../preload/api-types'
import { cleanCode } from '@glofly/shared/security'
import { twoStep } from '../lib/tools'

// Settings → Account → Two-step sign-in (0.7.3): after the password, a code by email (or text).

type Flow = 'on' | 'phone' | 'off' | 'remove-phone' | 'backup'

const TITLES: Record<Flow, string> = {
  on: 'Turn on two-step sign-in',
  phone: 'Add a phone for texts',
  off: 'Turn off two-step sign-in?',
  'remove-phone': 'Remove your phone?',
  backup: 'New backup codes'
}

function BackupCodes({ codes }: { codes: string[] }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = `Glofly backup codes (each works once)\n\n${codes.join('\n')}\n`
  return (
    <div className="twostep-backup">
      <p className="acct-delete-text">
        Each code works once, if your email and phone can&apos;t be reached.{' '}
        <strong>Keep these somewhere safe.</strong> You won&apos;t see them again.
      </p>
      <ol className="twostep-codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="twostep-backup-actions">
        <button
          type="button"
          className="small-button small-button--quiet"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => setCopied(true))
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="small-button small-button--quiet"
          onClick={() => {
            const a = document.createElement('a')
            a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
            a.download = 'glofly-backup-codes.txt'
            a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 5000)
          }}
        >
          Save as .txt
        </button>
      </div>
    </div>
  )
}

function TwoStepDialog({
  flow,
  status,
  onDone,
  onClose
}: {
  flow: Flow
  status: TwoStepStatus
  onDone: (s: TwoStepStatus) => void
  onClose: () => void
}): React.JSX.Element {
  const [step, setStep] = useState<'password' | 'code' | 'codes'>('password')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    inputRef.current?.focus()
  }, [step])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (step === 'codes') return onClose()
    if (step === 'password') {
      if (!password) return setError('Enter your password.')
      setBusy(true)
      if (flow === 'on' || flow === 'phone') {
        const r = await twoStep.start(flow === 'phone' ? 'sms' : 'email', password, phone)
        setBusy(false)
        if (!r.ok) return setError(r.message)
        setSentTo(r.data.sentTo)
        setStep('code')
        return
      }
      const r =
        flow === 'off'
          ? await twoStep.off(password)
          : flow === 'remove-phone'
            ? await twoStep.removePhone(password)
            : await twoStep.newBackupCodes(password)
      setBusy(false)
      if (!r.ok) return setError(r.message)
      if ('backupCodes' in r.data) {
        onDone(r.data.status)
        setCodes(r.data.backupCodes)
        setStep('codes')
        return
      }
      onDone(r.data)
      onClose()
      return
    }
    // The code
    const typed = cleanCode(code)
    if (typed.length !== 6) return setError('Enter the 6-digit code.')
    setBusy(true)
    const r = await twoStep.confirm(typed)
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      setCode('')
      return
    }
    onDone(r.data.status)
    if (r.data.backupCodes) {
      setCodes(r.data.backupCodes)
      setStep('codes')
    } else onClose()
  }

  const danger = flow === 'off' || flow === 'remove-phone'
  return (
    <div
      className="dialog-backdrop dialog-backdrop--nested"
      onMouseDown={(e) => e.target === e.currentTarget && step !== 'codes' && onClose()}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="twostep-title"
        className="dialog confirm acct-delete-dialog twostep-dialog"
        onSubmit={submit}
        noValidate
      >
        <h1 id="twostep-title">{step === 'codes' ? 'Your backup codes' : TITLES[flow]}</h1>
        {step === 'password' && (
          <>
            <div className="acct-delete-text">
              {flow === 'on' && (
                <p>
                  After your password, Glofly will ask for a 6-digit code we send to{' '}
                  <strong>{status.email}</strong>. First, let&apos;s check that email gets it.
                </p>
              )}
              {flow === 'phone' && (
                <p>Codes will come by text first, with email as a backup. Standard rates apply.</p>
              )}
              {flow === 'off' && (
                <p>
                  Signing in will only need your password again, and your backup codes stop working.
                </p>
              )}
              {flow === 'remove-phone' && <p>Codes will only come by email.</p>}
              {flow === 'backup' && (
                <p>Your old backup codes stop working once you get new ones.</p>
              )}
            </div>
            {flow === 'phone' && (
              <>
                <label className="acct-label" htmlFor="twostep-phone">
                  Mobile number
                </label>
                <input
                  id="twostep-phone"
                  className="acct-input"
                  type="tel"
                  autoComplete="tel"
                  placeholder="(502) 555-0123"
                  maxLength={40}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </>
            )}
            <label className="acct-label" htmlFor="twostep-password">
              Enter your password to continue
            </label>
            <input
              ref={inputRef}
              id="twostep-password"
              className="acct-input"
              type="password"
              autoComplete="current-password"
              maxLength={128}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
            />
          </>
        )}
        {step === 'code' && (
          <>
            <p className="acct-delete-text">
              We sent a 6-digit code to <strong>{sentTo}</strong>. It works for 10 minutes.
            </p>
            <label className="acct-label" htmlFor="twostep-code">
              Code
            </label>
            <input
              ref={inputRef}
              id="twostep-code"
              className="acct-input twostep-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={12}
              value={code}
              onChange={(e) => {
                setCode(e.target.value)
                setError(null)
              }}
            />
          </>
        )}
        {step === 'codes' && <BackupCodes codes={codes} />}
        {error && (
          <span className="acct-error" role="alert">
            {error}
          </span>
        )}
        <div className="confirm-actions">
          {step !== 'codes' && (
            <button type="button" className="small-button small-button--quiet" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            type="submit"
            className={
              danger ? 'small-button small-button--danger' : 'small-button small-button--primary'
            }
            disabled={busy}
          >
            {busy
              ? 'One moment…'
              : step === 'codes'
                ? "I've saved them"
                : step === 'code'
                  ? 'Confirm'
                  : flow === 'off'
                    ? 'Turn off'
                    : flow === 'remove-phone'
                      ? 'Remove'
                      : flow === 'backup'
                        ? 'Get new codes'
                        : 'Send the code'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function TwoStepSettings({
  onSessionExpired
}: {
  onSessionExpired: () => void
}): React.JSX.Element {
  const [status, setStatus] = useState<TwoStepStatus | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const load = useCallback(() => {
    void twoStep.status().then((r) => {
      if (r.ok) setStatus(r.data)
      else if (r.error === 'unauthorized') onSessionExpired()
    })
  }, [onSessionExpired])
  useEffect(() => {
    load()
    return window.glofly.onEvent((event) => {
      if (event.type === 'account:changed') load()
    })
  }, [load])

  if (!status)
    return (
      <div className="settings-card">
        <div className="settings-row">
          <span className="settings-row-desc">Loading…</span>
        </div>
      </div>
    )

  return (
    <div className="settings-card">
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">
            Two-step sign-in{' '}
            <span className={status.enabled ? 'twostep-badge twostep-badge--on' : 'twostep-badge'}>
              {status.enabled ? 'On' : 'Off'}
            </span>
          </span>
          <span className="settings-row-desc">
            {status.enabled
              ? `Codes go to ${status.phone ? `${status.phone} by text, or ` : ''}${status.email}. ${status.backupCodesLeft} backup code${status.backupCodesLeft === 1 ? '' : 's'} left.`
              : 'After your password, Glofly asks for a code we send you, so a stolen password isn’t enough to get in.'}
          </span>
          {!status.emailVerified && !status.enabled && (
            <span className="settings-row-desc twostep-warn">
              Confirm your email first (above), so codes can reach you.
            </span>
          )}
        </div>
        {!status.enabled && (
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={!status.emailVerified}
            onClick={() => setFlow('on')}
          >
            Turn on
          </button>
        )}
      </div>
      {status.enabled && (
        <>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Codes by text</span>
              <span className="settings-row-desc">
                {!status.smsAvailable
                  ? 'Codes by text are coming soon. For now they come by email.'
                  : status.phone
                    ? `Texts go to ${status.phone}.`
                    : 'Get codes by text too (email stays as a backup).'}
              </span>
            </div>
            {status.smsAvailable &&
              (status.phone ? (
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  onClick={() => setFlow('remove-phone')}
                >
                  Remove phone
                </button>
              ) : (
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  onClick={() => setFlow('phone')}
                >
                  Add a phone
                </button>
              ))}
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Backup codes</span>
              <span className="settings-row-desc">
                For when your email and phone can&apos;t be reached. Getting new ones turns the old
                ones off.
              </span>
            </div>
            <button
              type="button"
              className="small-button small-button--quiet"
              onClick={() => setFlow('backup')}
            >
              New backup codes
            </button>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Turn off two-step sign-in</span>
            </div>
            <button
              type="button"
              className="small-button small-button--danger"
              onClick={() => setFlow('off')}
            >
              Turn off
            </button>
          </div>
        </>
      )}
      {flow && (
        <TwoStepDialog
          flow={flow}
          status={status}
          onDone={setStatus}
          onClose={() => setFlow(null)}
        />
      )}
    </div>
  )
}

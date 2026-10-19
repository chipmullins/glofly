import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import type {
  LoginTwoStep,
  QrLoginStart,
  SignedInUser,
  TwoStepMethod
} from '../../../preload/api-types'
import { cleanCode, TWO_STEP_CODE_LENGTH } from '@glofly/shared/security'
import { AvatarFace } from '../components/Avatar'
import wordmarkImg from '../assets/glofly-wordmark.png'

// 0.7.3 sign-in extras: the two-step code step, and signing in with a QR code from the phone.

export type TwoStepInfo = LoginTwoStep['twoStep']

function ErrorLine({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="login-error" role="alert">
      <span>{message}</span>
    </div>
  )
}

const methodWord = (m: TwoStepMethod): string => (m === 'sms' ? 'text' : 'email')

/** After the password: "Enter the code we sent to •••• 0123". */
export function TwoStepForm({
  info: first,
  onSignedIn,
  onBack
}: {
  info: TwoStepInfo
  onSignedIn: (user: SignedInUser) => void
  onBack: (message?: string) => void
}): React.JSX.Element {
  const [info, setInfo] = useState(first)
  const [code, setCode] = useState('')
  const [backup, setBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [sentAt, setSentAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement>(null)
  const submitted = useRef('')

  // "Send a new code" unlocks 30 seconds after the last one.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const waitLeft = Math.max(0, 30 - Math.floor((now - sentAt) / 1000))

  const submit = useCallback(
    async (value: string): Promise<void> => {
      const typed = cleanCode(value)
      if (busy || !typed) return
      submitted.current = typed
      setBusy(true)
      setError(null)
      const r = await window.glofly.auth.loginCode(info.challenge, typed)
      setBusy(false)
      if (r.ok) {
        onSignedIn(r.user)
        return
      }
      if (r.reason === 'code_expired') {
        onBack(r.message)
        return
      }
      setError(r.message)
      setCode('')
      inputRef.current?.focus()
    },
    [busy, info.challenge, onBack, onSignedIn]
  )

  async function resend(method?: TwoStepMethod): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await window.glofly.auth.loginResend(info.challenge, method)
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    setInfo(r.data)
    const at = Date.now()
    setSentAt(at)
    setNow(at)
    setCode('')
    setNote(`New code sent to ${r.data.sentTo}.`)
    inputRef.current?.focus()
  }

  return (
    <form
      className="login-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void submit(code)
      }}
    >
      <img src={wordmarkImg} alt="Glofly" className="login-wordmark" draggable={false} />
      <div className="login-heading">
        <h1>
          {backup
            ? 'Use a backup code'
            : 'Check your ' + (info.method === 'sms' ? 'texts' : 'email')}
        </h1>
        <p>
          {backup ? (
            'Enter one of the backup codes you saved when you turned on two-step sign-in.'
          ) : (
            <>
              We sent a {TWO_STEP_CODE_LENGTH}-digit code to{' '}
              <strong className="login-sent-to">{info.sentTo}</strong>. It works for 10 minutes.
            </>
          )}
        </p>
      </div>
      {note && !error && (
        <div className="login-note" role="status">
          {note}
        </div>
      )}
      <div className="fields">
        <div className="field">
          <label htmlFor="login-code">{backup ? 'Backup code' : 'Code'}</label>
          <input
            ref={inputRef}
            id="login-code"
            className={backup ? 'text-input' : 'text-input login-code-input'}
            type="text"
            inputMode={backup ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            autoFocus
            spellCheck={false}
            placeholder={backup ? 'abcd-2345' : '123456'}
            maxLength={backup ? 12 : 12}
            aria-invalid={error ? true : undefined}
            value={code}
            onChange={(e) => {
              const v = e.target.value
              setCode(v)
              setError(null)
              // Six digits typed or pasted: go.
              if (!backup) {
                const digits = cleanCode(v)
                if (digits.length === TWO_STEP_CODE_LENGTH && digits !== submitted.current)
                  void submit(digits)
              }
            }}
          />
        </div>
      </div>
      {error && <ErrorLine message={error} />}
      <button
        type="submit"
        className="login-submit"
        disabled={busy || !code.trim()}
        aria-busy={busy}
      >
        {busy ? 'Checking…' : 'Sign in'}
      </button>
      <div className="login-twostep-links">
        {!backup && (
          <>
            <button
              type="button"
              className="link-button"
              disabled={busy || waitLeft > 0}
              onClick={() => void resend()}
            >
              {waitLeft > 0 ? `Send a new code (${waitLeft}s)` : 'Send a new code'}
            </button>
            {info.alternatives.map((m) => (
              <button
                key={m}
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => void resend(m)}
              >
                {m === 'sms' ? 'Text it instead' : `Send it by ${methodWord(m)} instead`}
              </button>
            ))}
          </>
        )}
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setBackup((b) => !b)
            setCode('')
            setError(null)
            inputRef.current?.focus()
          }}
        >
          {backup ? 'Use a code we send you' : 'Use a backup code'}
        </button>
      </div>
      <p className="login-footer">
        <button type="button" className="link-button link-button--strong" onClick={() => onBack()}>
          Back
        </button>
      </p>
    </form>
  )
}

/** A QR code drawn from its modules (no image file, no outside service). */
function QrImage({ text, size = 208 }: { text: string; size?: number }): React.JSX.Element | null {
  const qr = useMemo(() => {
    try {
      return QRCode.create(text, { errorCorrectionLevel: 'M' })
    } catch {
      return null
    }
  }, [text])
  if (!qr) return null
  const n = qr.modules.size
  const quiet = 3
  const path: string[] = []
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (qr.modules.get(x, y)) path.push(`M${x + quiet} ${y + quiet}h1v1h-1z`)
  const total = n + quiet * 2
  return (
    <svg
      className="login-qr-code"
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="QR code to sign in with your phone"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path d={path.join('')} fill="#1c1210" />
    </svg>
  )
}

type QrState =
  | { kind: 'loading' }
  | { kind: 'showing'; code: QrLoginStart }
  | {
      kind: 'scanned'
      code: QrLoginStart
      by: { id: string; displayName: string; avatarVersion: string | null }
    }
  | { kind: 'declined' }
  | { kind: 'problem'; message: string }

/** "Sign in with your phone": a QR code the phone's camera opens in Glofly to approve. */
export function QrSignIn({
  keepSignedIn,
  onSignedIn,
  onBack
}: {
  keepSignedIn: boolean
  onSignedIn: (user: SignedInUser) => void
  onBack: () => void
}): React.JSX.Element {
  const [state, setState] = useState<QrState>({ kind: 'loading' })
  const [round, setRound] = useState(0)
  const done = useRef(false)

  // A new code (at the start, after it runs out, or after a decline and "Show a new code").
  useEffect(() => {
    let gone = false
    void window.glofly.auth.qrStart(keepSignedIn).then((r) => {
      if (gone) return
      setState(r.ok ? { kind: 'showing', code: r.data } : { kind: 'problem', message: r.message })
    })
    return () => {
      gone = true
    }
  }, [round, keepSignedIn])

  // Asking every 1.5 seconds how it's going (only while a code is up).
  const code = state.kind === 'showing' || state.kind === 'scanned' ? state.code : null
  useEffect(() => {
    if (!code) return
    let gone = false
    let busy = false
    const tick = async (): Promise<void> => {
      if (busy || gone || done.current) return
      busy = true
      const r = await window.glofly.auth.qrPoll(code.id, code.secret)
      busy = false
      if (gone) return
      if (r.state === 'signed-in') {
        done.current = true
        onSignedIn(r.user)
      } else if (r.state === 'scanned') setState({ kind: 'scanned', code, by: r.by })
      else if (r.state === 'declined') setState({ kind: 'declined' })
      else if (r.state === 'expired')
        setRound((n) => n + 1) // a fresh code, by itself
      else if (r.state === 'error') setState({ kind: 'problem', message: r.message })
    }
    const t = setInterval(() => void tick(), 1500)
    // Also make a new one just before it runs out (2 minutes).
    const renew = setTimeout(
      () => setRound((n) => n + 1),
      Math.max(5_000, new Date(code.expiresAt).getTime() - Date.now() - 2_000)
    )
    return () => {
      gone = true
      clearInterval(t)
      clearTimeout(renew)
    }
  }, [code, onSignedIn])

  return (
    <div className="login-form login-qr">
      <img src={wordmarkImg} alt="Glofly" className="login-wordmark" draggable={false} />
      <div className="login-heading">
        <h1>Sign in with your phone</h1>
        <p>
          Open your phone&apos;s camera and point it at the code. Glofly on your phone will ask you
          to approve.
        </p>
      </div>
      <div className="login-qr-box" aria-live="polite">
        {state.kind === 'loading' && <div className="login-qr-wait">Making a code…</div>}
        {state.kind === 'showing' && <QrImage text={state.code.url} />}
        {state.kind === 'scanned' && (
          <div className="login-qr-scanned">
            <span className="login-qr-face">
              <AvatarFace
                id={state.by.id}
                name={state.by.displayName}
                avatarVersion={state.by.avatarVersion}
              />
            </span>
            <strong>{state.by.displayName}</strong>
            <span>Approve on your phone</span>
          </div>
        )}
        {state.kind === 'declined' && (
          <div className="login-qr-scanned">
            <strong>Declined on your phone</strong>
            <button
              type="button"
              className="login-submit"
              onClick={() => {
                setState({ kind: 'loading' })
                setRound((n) => n + 1)
              }}
            >
              Show a new code
            </button>
          </div>
        )}
        {state.kind === 'problem' && (
          <div className="login-qr-scanned">
            <ErrorLine message={state.message} />
            <button
              type="button"
              className="login-submit"
              onClick={() => {
                setState({ kind: 'loading' })
                setRound((n) => n + 1)
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>
      <ol className="login-qr-steps">
        <li>Sign in to Glofly on your phone first.</li>
        <li>Point the camera at the code and tap the link that appears.</li>
        <li>Check it says this computer, then tap Sign in.</li>
      </ol>
      <p className="login-footer">
        <button type="button" className="link-button link-button--strong" onClick={onBack}>
          Use your password instead
        </button>
      </p>
    </div>
  )
}

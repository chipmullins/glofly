import { useCallback, useEffect, useState } from 'react'

// A gentle reminder at the top of the app until the email is confirmed:
// "Confirm your email so you can always get back into your account."
// "Later" hides it for a few days on this PC. It disappears by itself once the link in
// the email is clicked (the server tells every signed-in device).

const SNOOZE_DAYS = 3
const snoozeKey = (userId: string): string => `glofly.confirmEmailSnoozed.${userId}`

function snoozedUntil(userId: string): number {
  try {
    return Number(localStorage.getItem(snoozeKey(userId))) || 0
  } catch {
    return 0
  }
}

export default function ConfirmEmailBar({
  userId,
  onChangeEmail,
  onSessionExpired
}: {
  userId: string
  /** Opens Settings → Account (wrong address, or the email never arrived). */
  onChangeEmail: () => void
  onSessionExpired: () => void
}): React.JSX.Element | null {
  const [email, setEmail] = useState<string | null>(null)
  const [snoozed, setSnoozed] = useState(() => snoozedUntil(userId) > Date.now())
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | string>('idle')

  const check = useCallback(() => {
    window.glofly.account.get().then((result) => {
      // Older servers don't say whether it's confirmed: no reminder then.
      if (result.ok) setEmail(result.data.emailVerified === false ? result.data.email : null)
    })
  }, [])

  useEffect(() => {
    check()
    return window.glofly.onEvent((event) => {
      if (event.type === 'account:changed') check()
      if (event.type === 'connection' && event.connected) check()
    })
  }, [check])

  if (!email || snoozed) return null

  async function resend(): Promise<void> {
    setSent('sending')
    const result = await window.glofly.account.resendVerification()
    if (result.ok) return setSent('sent')
    if (result.error === 'unauthorized') return onSessionExpired()
    if (result.error === 'conflict') return check() // confirmed in the meantime
    setSent(result.message)
  }

  function later(): void {
    try {
      localStorage.setItem(
        snoozeKey(userId),
        String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000)
      )
    } catch {
      // Storage unavailable: it just comes back next launch.
    }
    setSnoozed(true)
  }

  return (
    <div className="update-bar confirm-email-bar" role="status">
      <span className="confirm-email-text">
        {sent === 'sent' ? (
          <>
            Sent! Check <strong>{email}</strong> for the link.
          </>
        ) : sent !== 'idle' && sent !== 'sending' ? (
          sent
        ) : (
          <>
            Confirm your email <span className="update-bar-version">({email})</span> so you can
            always get back into your account.
          </>
        )}
      </span>
      {sent !== 'sent' && (
        <button
          type="button"
          className="update-bar-restart"
          disabled={sent === 'sending'}
          onClick={() => void resend()}
        >
          {sent === 'sending' ? 'Sending…' : 'Resend link'}
        </button>
      )}
      <button type="button" className="update-bar-later" onClick={onChangeEmail}>
        Change email
      </button>
      <button type="button" className="update-bar-later" onClick={later}>
        Later
      </button>
    </div>
  )
}

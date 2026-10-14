import { useEffect, useState } from 'react'
import type { Paused } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import '../screens/LoginScreen.css'
import './Safety.css'

/**
 * "Glofly is paused" (0.4.0): Glofly Control paused everyone (Server → Pause Glofly). Covers
 * the whole window. The main process asks the server every 30 seconds; once Glofly is back the
 * window reloads by itself. Nothing is lost and nobody is signed out.
 */
export default function PausedScreen({ info }: { info: Paused }): React.JSX.Element {
  const [checking, setChecking] = useState(false)
  const [stillPaused, setStillPaused] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(30)

  // A gentle countdown to the next automatic check.
  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => (s <= 1 ? 30 : s - 1)), 1000)
    return () => clearInterval(timer)
  }, [])

  async function tryNow(): Promise<void> {
    if (checking) return
    setChecking(true)
    setStillPaused(false)
    const result = await window.glofly.appStatus.checkPaused()
    setChecking(false)
    setSecondsLeft(30)
    if (result) setStillPaused(true)
  }

  return (
    <div className="update-required paused" role="alertdialog" aria-labelledby="paused-title">
      <div className="titlebar-drag" aria-hidden="true" />
      <div className="update-required-card">
        <img src={fireflyImg} alt="" className="update-required-fly paused-fly" draggable={false} />
        <h1 id="paused-title">Glofly is paused</h1>
        <p>{info.message}</p>
        <p className="update-required-version">
          Your chats and sign-in are safe. Glofly comes back here by itself as soon as it&apos;s
          running again.
        </p>
        <div className="update-required-actions">
          <button
            type="button"
            className="login-submit"
            onClick={() => void tryNow()}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Try again now'}
          </button>
        </div>
        <p className="update-required-hint" aria-live="polite">
          {stillPaused ? 'Still paused. ' : ''}Checking again in {secondsLeft}s.
        </p>
      </div>
    </div>
  )
}

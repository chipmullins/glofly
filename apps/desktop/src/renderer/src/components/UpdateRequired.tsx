import { useEffect, useState } from 'react'
import type { UpdateRequired } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import { isWeb } from '../lib/platform'
import '../screens/LoginScreen.css'
import './Safety.css'

/**
 * "Please update Glofly": the server needs a newer version (Glofly Control → minimum app
 * version). Covers the whole window. The installed Windows app looks for the update and
 * offers Restart to update; Download always works (glofly.app/download).
 */
export default function UpdateRequiredScreen({
  info
}: {
  info: UpdateRequired
}): React.JSX.Element {
  const [ready, setReady] = useState<string | null>(null)
  const [checking, setChecking] = useState<'checking' | 'unavailable' | null>(null)

  useEffect(() => {
    let alive = true
    window.glofly.updates.status().then((v) => alive && v && setReady(v))
    const stop = window.glofly.updates.onReady((v) => setReady(v))
    window.glofly.updates.checkNow().then((state) => alive && setChecking(state))
    return () => {
      alive = false
      stop()
    }
  }, [])

  return (
    <div className="update-required" role="alertdialog" aria-labelledby="update-required-title">
      <div className="titlebar-drag" aria-hidden="true" />
      <div className="update-required-card">
        <img src={fireflyImg} alt="" className="update-required-fly" draggable={false} />
        <h1 id="update-required-title">
          {isWeb ? 'Please reload Glofly' : 'Please update Glofly'}
        </h1>
        <p>{info.message}</p>
        {info.minVersion && (
          <p className="update-required-version">You need version {info.minVersion} or newer.</p>
        )}
        <div className="update-required-actions">
          {isWeb ? (
            // A browser gets the newest Glofly just by loading the page again.
            <button
              type="button"
              className="login-submit"
              onClick={() => window.glofly.updates.restart()}
            >
              Reload Glofly
            </button>
          ) : ready ? (
            <button
              type="button"
              className="login-submit"
              onClick={() => window.glofly.updates.restart()}
            >
              Restart to update ({ready})
            </button>
          ) : (
            <a
              className="login-submit update-required-download"
              href={info.downloadUrl}
              target="_blank"
              rel="noreferrer"
            >
              Download the update
            </a>
          )}
        </div>
        {!isWeb && !ready && checking === 'checking' && (
          <p className="update-required-hint">
            Glofly is also downloading the update itself. This screen offers Restart when it&apos;s
            ready.
          </p>
        )}
      </div>
    </div>
  )
}

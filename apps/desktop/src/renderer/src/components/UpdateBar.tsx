import { useEffect, useState } from 'react'
import { useCalls } from '../calls/callState'
import { isWeb } from '../lib/platform'

/**
 * "A new version of Glofly is ready · Restart" once an update has downloaded
 * (installed app only). Restarting is held back during a call so it can't cut
 * one off. Dismissing it just means the update installs next time Glofly quits.
 */
export default function UpdateBar(): React.JSX.Element | null {
  const { current } = useCalls()
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    window.glofly.updates.status().then((v) => {
      if (alive && v) setVersion(v)
    })
    const stop = window.glofly.updates.onReady((v) => {
      setVersion(v)
      setDismissed(false)
    })
    return () => {
      alive = false
      stop()
    }
  }, [])

  if (!version || dismissed) return null
  const inCall = current !== null

  return (
    <div className="update-bar" role="status">
      <span>
        A new version of Glofly is ready <span className="update-bar-version">({version})</span>
      </span>
      <button
        type="button"
        className="update-bar-restart"
        disabled={inCall}
        title={inCall ? `You can ${isWeb ? 'reload' : 'restart'} once your call ends` : undefined}
        onClick={() => window.glofly.updates.restart()}
      >
        {inCall
          ? isWeb
            ? 'Reload after your call'
            : 'Restart after your call'
          : isWeb
            ? 'Reload'
            : 'Restart to update'}
      </button>
      <button
        type="button"
        className="update-bar-later"
        onClick={() => setDismissed(true)}
        aria-label="Later"
      >
        Later
      </button>
    </div>
  )
}

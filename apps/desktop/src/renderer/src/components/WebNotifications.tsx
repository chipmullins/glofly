import { useEffect, useState } from 'react'
import { isTouch, web } from '../lib/platform'

// Glofly in a browser only: asking the browser for notifications.
//
// Browsers only let a page ask "Allow notifications?" after a click, so the main screen shows a
// small bar with Turn on, and Settings → Notifications has the switch. Once allowed, messages and
// calls also arrive with every Glofly tab closed (web push), where the browser supports it.
// An iPad only allows notifications for Glofly added to the Home Screen.

type Permission = 'granted' | 'denied' | 'default' | 'unsupported'

const DISMISS_KEY = 'glofly.webNotifyDismissed'
const DISMISS_DAYS = 14

const standalone = (): boolean =>
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

/** The browser's answer so far, kept up to date. */
function usePermission(): Permission {
  const [permission, setPermission] = useState<Permission>(
    () => web?.notifications.permission() ?? 'unsupported'
  )
  useEffect(() => {
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'notifications:permission') setPermission(event.permission)
    })
    // Changed in the browser's own site settings: noticed when the tab comes back.
    const recheck = (): void => setPermission(web?.notifications.permission() ?? 'unsupported')
    document.addEventListener('visibilitychange', recheck)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [])
  return permission
}

function dismissed(): boolean {
  try {
    return Number(localStorage.getItem(DISMISS_KEY)) > Date.now()
  } catch {
    return false
  }
}

/** The bar at the top of the main screen: "Turn on notifications". */
export function WebNotifyBar(): React.JSX.Element | null {
  const permission = usePermission()
  const [hidden, setHidden] = useState(dismissed)
  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    void window.glofly.app.getSettings().then((s) => s && setEnabled(s.notifications.enabled))
  }, [])

  if (!web || hidden || !enabled) return null
  // iPad / iPhone Safari in a tab: notifications only work from the Home Screen.
  const needsHomeScreen = permission === 'unsupported' && isTouch && web.apple && !standalone()
  if (permission !== 'default' && !needsHomeScreen) return null

  function later(): void {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000))
    } catch {
      // Hidden until the page reloads, then.
    }
    setHidden(true)
  }

  return (
    <div className="update-bar web-notify-bar" role="status">
      <span>
        {needsHomeScreen
          ? 'For notifications on this iPad, tap Share, then Add to Home Screen, and open Glofly from there.'
          : web.notifications.pushSupported
            ? 'Get notified about messages and calls, even with this tab closed.'
            : 'Get notified about messages and calls while Glofly is open.'}
      </span>
      {!needsHomeScreen && (
        <button
          type="button"
          className="update-bar-restart"
          onClick={() =>
            void web!.notifications.ask().then((p) => p !== 'default' && setHidden(true))
          }
        >
          Turn on
        </button>
      )}
      <button type="button" className="update-bar-later" onClick={later}>
        {needsHomeScreen ? 'Got it' : 'Not now'}
      </button>
    </div>
  )
}

/** Settings → Notifications & sounds → Browser notifications. */
export function BrowserNotificationsRow({
  enabled,
  onChange
}: {
  enabled: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  const permission = usePermission()
  const blocked = permission === 'denied'
  const unsupported = permission === 'unsupported'
  const on = enabled && permission === 'granted'

  let desc = web?.notifications.pushSupported
    ? 'Show new messages and calls when Glofly isn’t in front, even with the tab closed.'
    : 'Show new messages and calls when Glofly isn’t in front.'
  if (blocked) {
    desc =
      'Your browser is blocking notifications from Glofly. Allow them in its site settings (the icon left of the address), then come back.'
  } else if (unsupported) {
    desc =
      isTouch && web?.apple
        ? 'On an iPad, notifications work when Glofly is added to the Home Screen (Share → Add to Home Screen).'
        : 'This browser can’t show notifications.'
  }

  function toggle(): void {
    if (on) return onChange(false)
    // Asking has to happen right here, inside the click.
    if (permission === 'default') void web?.notifications.ask()
    onChange(true)
  }

  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-label">Browser notifications</span>
        <span className="settings-row-desc">{desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="Browser notifications"
        disabled={blocked || unsupported}
        className={on ? 'toggle toggle--on' : 'toggle'}
        onClick={toggle}
      >
        <span className="toggle-knob" />
      </button>
    </div>
  )
}

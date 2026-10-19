import { useEffect, useState } from 'react'
import type { QuietHours } from '../../../preload/api-types'
import { QUIET_DEFAULT, timeOfDayLabel } from '@glofly/shared/chatTools'
import { quietHours as api } from '../lib/tools'
import { setQuietHours } from '../lib/quiet'
import { Toggle } from './SettingsDialog'

// Settings → Notifications & sounds → Quiet hours (0.7.3): like Do Not Disturb, on a timer.
// On every device signed in (the server keeps phones quiet too).

const zone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export default function QuietHoursSettings(): React.JSX.Element {
  const [q, setQ] = useState<QuietHours | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const load = (): void => void api.get().then((r) => r.ok && setQ(r.data.quietHours))
    load()
    return window.glofly.onEvent((event) => {
      if (event.type === 'account:changed') load()
    })
  }, [])

  async function save(next: QuietHours | null): Promise<void> {
    const before = q
    setQ(next)
    setError(null)
    const r = await api.set(next)
    if (!r.ok) {
      setQ(before)
      setError(r.message)
      return
    }
    setQuietHours(r.data.quietHours)
  }

  const on = !!q
  const current: QuietHours = q ?? { ...QUIET_DEFAULT, tz: zone(), calls: false }
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-text">
          <span className="settings-row-label">Quiet hours</span>
          <span className="settings-row-desc">
            {on
              ? `No sounds or notifications from ${timeOfDayLabel(current.from)} to ${timeOfDayLabel(current.to)}, on all your devices. Messages still arrive.`
              : 'Like Do Not Disturb, on a timer: no sounds or notifications overnight, on all your devices.'}
          </span>
          {error && (
            <span className="settings-row-desc twostep-warn" role="alert">
              {error}
            </span>
          )}
        </div>
        {q === undefined ? (
          <span className="toggle toggle--loading" aria-hidden="true" />
        ) : (
          <Toggle
            on={on}
            label="Quiet hours"
            onChange={(v) => void save(v ? { ...current, tz: zone() } : null)}
          />
        )}
      </div>
      {on && (
        <>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Hours</span>
              <span className="settings-row-desc">
                Your computer&apos;s time zone ({current.tz}).
              </span>
            </div>
            <div className="quiet-times">
              <label>
                <span className="visually-hidden">From</span>
                <input
                  type="time"
                  aria-label="Quiet from"
                  value={current.from}
                  onChange={(e) =>
                    e.target.value && void save({ ...current, from: e.target.value, tz: zone() })
                  }
                />
              </label>
              <span aria-hidden="true">to</span>
              <label>
                <span className="visually-hidden">To</span>
                <input
                  type="time"
                  aria-label="Quiet until"
                  value={current.to}
                  onChange={(e) =>
                    e.target.value && void save({ ...current, to: e.target.value, tz: zone() })
                  }
                />
              </label>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <span className="settings-row-label">Let calls ring</span>
              <span className="settings-row-desc">Calls still ring during quiet hours.</span>
            </div>
            <Toggle
              on={current.calls}
              label="Let calls ring during quiet hours"
              onChange={(v) => void save({ ...current, calls: v })}
            />
          </div>
        </>
      )}
    </>
  )
}

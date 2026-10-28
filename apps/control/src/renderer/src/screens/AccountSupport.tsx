import { useState, type JSX } from 'react'
import { api, PLATFORM_LABEL, type AccountSupport } from '../lib/api'
import { Chip } from '../components/common'
import { ago, plural } from '../lib/format'

// Accounts → Support (Oct 28, 2026): everything needed to help someone with "it doesn't work" in
// one place: their devices and whether each can get pushes and ring for calls, their recent calls,
// and the error reports their apps sent. Loaded only when opened.

const APP_NAMES: Record<string, string> = {
  ...PLATFORM_LABEL,
  desktop: 'Desktop',
  web: 'Web',
  ios: 'iPhone',
  android: 'Android'
}
const CALL_KIND = { dm: '1-on-1', group: 'Group', nebula: 'Voice nebula' } as const

function length(seconds: number | null): string {
  if (seconds === null) return 'still going'
  if (seconds < 60) return `${seconds} s`
  return `${Math.round(seconds / 60)} min`
}

export function SupportSection({ id }: { id: string }): JSX.Element {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<AccountSupport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = (): void => {
    setError(null)
    void api.support(id).then((r) => (r.ok ? setData(r.data) : setError(r.message)))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="section-label">Support</span>
      {!open ? (
        <button
          type="button"
          className="btn btn--action"
          onClick={() => {
            setOpen(true)
            load()
          }}
        >
          Show devices, calls and errors
        </button>
      ) : error ? (
        <div className="error-box" role="alert">
          {error}
        </div>
      ) : !data ? (
        <p className="loading">Loading…</p>
      ) : (
        <SupportDetails data={data} onRefresh={load} />
      )}
    </div>
  )
}

function SupportDetails({
  data,
  onRefresh
}: {
  data: AccountSupport
  onRefresh: () => void
}): JSX.Element {
  const openErrors = data.errors.filter((e) => !e.resolvedAt)
  return (
    <>
      <p style={{ margin: 0, fontSize: 14 }}>
        Used Glofly on {plural(data.activity.daysLast30, 'day')} of the last 30
        {data.activity.apps.length > 0 &&
          ` (${data.activity.apps.map((p) => APP_NAMES[p] ?? p).join(', ')})`}
        .{' '}
        <button type="button" className="link-btn" onClick={onRefresh}>
          Refresh
        </button>
      </p>

      <span className="hint" style={{ fontSize: 13, fontWeight: 600 }}>
        Devices
      </span>
      {data.devices.length === 0 && <span className="hint">Not signed in anywhere.</span>}
      {data.devices.map((d) => {
        const phone = d.platform === 'ios' || d.platform === 'android'
        return (
          <div key={d.id} className="device" style={{ alignItems: 'flex-start' }}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span>
                {d.deviceName ?? 'Unknown device'}
                <span className="version">
                  {' '}
                  · {APP_NAMES[d.platform] ?? d.platform} {d.appVersion ? `v${d.appVersion}` : ''}
                </span>
              </span>
              <span className="row-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {phone || d.platform === 'web' ? (
                  d.push ? (
                    <Chip small tone="good">
                      Notifications on
                    </Chip>
                  ) : (
                    <Chip small tone="warn">
                      No notifications
                    </Chip>
                  )
                ) : null}
                {d.platform === 'ios' &&
                  (d.push?.calls ? (
                    <Chip small tone="good">
                      Calls ring
                    </Chip>
                  ) : (
                    <Chip small tone="warn">
                      Calls can&apos;t ring
                    </Chip>
                  ))}
                {d.push && !d.push.preview && <Chip small>Previews hidden</Chip>}
                {!d.persistent && <Chip small>Not kept signed in</Chip>}
              </span>
            </span>
            <span className="when">{ago(d.lastUsedAt)}</span>
          </div>
        )
      })}

      <span className="hint" style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
        Recent calls
      </span>
      {data.calls.length === 0 && <span className="hint">No calls yet.</span>}
      {data.calls.slice(0, 8).map((c) => (
        <div key={c.id} className="device">
          <span>
            {CALL_KIND[c.kind] ?? c.kind} {c.video ? 'video' : 'voice'}
            <span className="version">
              {' '}
              · {c.caller ? 'they called' : 'they were called'}
              {c.joined
                ? ` · ${length(c.seconds)} · ${plural(c.people, 'person', 'people')}`
                : ' · didn’t join'}
            </span>
          </span>
          <span className="when">{ago(c.at)}</span>
        </div>
      ))}

      <span className="hint" style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>
        Error reports from their apps {openErrors.length > 0 && `(${openErrors.length} open)`}
      </span>
      {data.errors.length === 0 && <span className="hint">None.</span>}
      {data.errors.slice(0, 10).map((e) => (
        <div key={e.id} className="device" style={{ alignItems: 'flex-start' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ overflowWrap: 'anywhere' }}>{e.message.slice(0, 140)}</span>
            <span className="version">
              {[APP_NAMES[e.app] ?? e.app, e.appVersion, e.os].filter(Boolean).join(' · ')} ·{' '}
              {plural(e.count, 'time')} (everyone){e.resolvedAt ? ' · resolved' : ''}
            </span>
          </span>
          <span className="when">{ago(e.lastAt)}</span>
        </div>
      ))}
    </>
  )
}

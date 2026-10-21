import { useCallback, useEffect, useId, useState, type JSX } from 'react'
import {
  ALERT_KINDS,
  ALERT_LABELS,
  api,
  URGENT_ALERTS,
  type AlertKind,
  type AlertPrefs,
  type ApprovedPhone,
  type Uptime,
  type UptimeEvent
} from '../lib/api'
import type { ActionSpec } from '../components/ActionDialog'
import { Chip } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ago, plural, shortDate, when } from '../lib/format'
import { setQuickNotes, useQuickNotes } from '../lib/quickNotes'
import { endCallsSpec, lockdownSpec } from './serverSpecs'

// 0.9.0 cards on Control → Server: uptime, Lockdown, End all calls, approved phones, alerts and
// quick notes. Every change goes through a confirm dialog with a note (except alert settings and
// quick notes, which aren't audited actions).

type Toast = (message: string, bad?: boolean) => void
type OpenAction = (spec: ActionSpec) => void

/** "4 min", "1 h 12 min", "6 s". */
function length(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  return `${Math.round(h / 24)} days`
}

function eventWords(e: UptimeEvent): { what: string; len: string } {
  const open = e.endedAt === null
  switch (e.kind) {
    case 'outage':
      return {
        what: open ? 'Server stopped answering' : 'Server stopped answering · came back by itself',
        len: e.seconds !== null ? length(e.seconds) : 'Still down'
      }
    case 'restart':
      return {
        what: 'You restarted the server',
        len: e.seconds !== null ? `Back in ${length(e.seconds)}` : 'Restarting'
      }
    case 'update':
      return {
        what: 'Server updated (stopped and started again)',
        len: e.seconds !== null ? `Back in ${length(e.seconds)}` : 'Starting'
      }
    case 'pause':
      return {
        what: open ? 'You paused Glofly · still paused' : 'You paused Glofly',
        len: e.seconds !== null ? length(e.seconds) : 'Paused now'
      }
  }
}

const DAY_WORDS = { up: 'Up all day', you: 'Restart or pause you did', down: 'Went down by itself' }

// ───────────── Uptime, last 30 days ─────────────

export function UptimeCard({ version }: { version: number }): JSX.Element | null {
  const [data, setData] = useState<Uptime | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let live = true
    void api.uptime().then((r) => {
      if (!live) return
      if (r.ok) setData(r.data)
      else setMissing(true)
    })
    return () => {
      live = false
    }
  }, [version])

  if (missing) return null
  if (!data)
    return (
      <section className="card card-pad" aria-label="Uptime, last 30 days">
        <p className="loading" style={{ padding: 0 }}>
          Loading uptime…
        </p>
      </section>
    )

  const count = (s: 'up' | 'you' | 'down'): number => data.days.filter((d) => d.status === s).length
  const outageSec = data.days.reduce((n, d) => n + (d.status === 'down' ? d.downSec : 0), 0)
  const summary = `30 days: ${plural(count('up'), 'day')} fully up, ${plural(count('you'), 'day')} with a restart, pause or update you did, ${plural(count('down'), 'day')} when it went down by itself${count('down') ? ` (${length(outageSec)} in all)` : ''}.`
  const first = data.days[0]?.day

  return (
    <section className="card card-pad uptime" aria-labelledby="uptime-title">
      <div className="uptime-head">
        <h2 id="uptime-title">Uptime, last 30 days</h2>
        <span className="uptime-percent">{data.percent.toFixed(2)}%</span>
      </div>
      <div className="uptime-bars" role="img" aria-label={summary}>
        {data.days.map((d) => (
          <span
            key={d.day}
            className={`uptime-bar uptime-bar--${d.status}`}
            title={`${shortDate(`${d.day}T12:00:00`)}: ${DAY_WORDS[d.status]}${d.downSec ? ` · ${length(d.downSec)} down` : ''}`}
          />
        ))}
      </div>
      <div className="uptime-axis" aria-hidden="true">
        <span>{first ? shortDate(`${first}T12:00:00`) : ''}</span>
        <span>Today</span>
      </div>
      <div className="legend uptime-legend">
        <span>
          <i className="uptime-bar--up" />
          Up all day
        </span>
        <span>
          <i className="uptime-bar--you" />
          Restart or pause you did
        </span>
        <span>
          <i className="uptime-bar--down" />
          Went down by itself
        </span>
      </div>
      {data.events.length === 0 ? (
        <p className="hint" style={{ margin: 0, fontSize: 13.5 }}>
          No restarts, pauses or outages in the last 30 days.
        </p>
      ) : (
        <ul className="uptime-events" aria-label="What happened">
          {data.events.map((e) => {
            const w = eventWords(e)
            return (
              <li key={`${e.kind}-${e.startedAt}`}>
                <span className="when">{when(e.startedAt)}</span>
                <span className="what">{w.what}</span>
                <span className="len">{w.len}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// ───────────── Lockdown ─────────────

export function LockdownCard({
  version,
  onAction,
  onLockdownChange
}: {
  version: number
  onAction: OpenAction
  onLockdownChange: (on: boolean) => void
}): JSX.Element | null {
  const [state, setState] = useState<{
    on: boolean
    since: string | null
    affected: number
    hours: number
  } | null>(null)
  const [missing, setMissing] = useState(false)
  const [n, setN] = useState(0)

  useEffect(() => {
    let live = true
    void api.lockdown().then((r) => {
      if (!live) return
      if (r.ok) {
        setState({ ...r.data.lockdown, affected: r.data.affected, hours: r.data.hours })
        onLockdownChange(r.data.lockdown.on)
      } else setMissing(true)
    })
    return () => {
      live = false
    }
  }, [version, n, onLockdownChange])

  if (missing) return null
  const on = state?.on === true
  const open = (): void =>
    onAction(
      lockdownSpec(state, (l) => {
        onLockdownChange(l.on)
        setN((x) => x + 1)
      })
    )

  return (
    <section
      className={`card card-pad server-card${on ? ' server-card--paused' : ''}`}
      aria-labelledby="lockdown-title"
    >
      <div className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <Icon d={ICONS.lock} size={22} strokeWidth={2} />
        </span>
        <div className="server-card-titles">
          <h2 id="lockdown-title">Lockdown</h2>
          <span className="hint">For a spam wave: new accounts can only talk to friends.</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="lockdown-title"
          className="switch switch--danger"
          disabled={!state}
          onClick={open}
        >
          <span className="switch-knob" />
        </button>
      </div>
      {on ? (
        <div className="notice notice--bad" role="status">
          <Icon d={ICONS.lock} size={18} strokeWidth={2} />
          <span>
            <strong>Lockdown is on</strong>
            {state?.since ? ` since ${when(state.since)} (${ago(state.since)})` : ''}.{' '}
            {state && plural(state.affected, 'account')} under {state?.hours ?? 24} hours old can
            only talk to friends they already have.
          </span>
        </div>
      ) : (
        <div className="server-status">
          <Chip tone="good">Off</Chip>
          <span className="hint">
            {state
              ? `${plural(state.affected, 'account')} made in the last ${state.hours} hours would be affected`
              : 'Loading…'}
          </span>
        </div>
      )}
      <ul className="server-list">
        <li>Accounts under a day old can’t send friend requests or message anyone new.</li>
        <li>They can’t join constellations or groups with people they don’t know.</li>
        <li>Everyone else keeps using Glofly as usual.</li>
      </ul>
      <div className="server-buttons">
        <button
          type="button"
          className={on ? 'btn btn--primary' : 'btn btn--danger-soft'}
          disabled={!state}
          onClick={open}
        >
          {on ? 'Turn off Lockdown' : 'Turn on Lockdown…'}
        </button>
      </div>
    </section>
  )
}

// ───────────── End all calls ─────────────

export function EndCallsCard({ onAction }: { onAction: OpenAction }): JSX.Element {
  return (
    <section className="card card-pad server-card" aria-labelledby="calls-title">
      <div className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <Icon d={ICONS.calls} size={22} strokeWidth={2} />
        </span>
        <div className="server-card-titles">
          <h2 id="calls-title">End all calls</h2>
          <span className="hint">Hangs up every call and Watch Together.</span>
        </div>
      </div>
      <p className="hint" style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        For calls that are stuck or being misused. Nobody is signed out, and they can call again
        right away.
      </p>
      <div className="server-buttons">
        <button
          type="button"
          className="btn btn--danger-soft"
          onClick={() => onAction(endCallsSpec())}
        >
          End all calls…
        </button>
      </div>
    </section>
  )
}

// ───────────── Approved phones ─────────────

/** "K7M-2QF" → "K7M · 2QF". */
const showCode = (code: string): string => code.replace('-', ' · ')

export function PhonesCard({
  version,
  onAction,
  pairRequest,
  toast
}: {
  version: number
  onAction: OpenAction
  /** Goes up when the command bar asks for "Approve a new iPhone" */
  pairRequest: number
  toast: Toast
}): JSX.Element | null {
  const [phones, setPhones] = useState<ApprovedPhone[] | null>(null)
  const [max, setMax] = useState(3)
  const [missing, setMissing] = useState(false)
  const [pair, setPair] = useState<{ code: string; until: number; count: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [n, setN] = useState(0)

  const load = useCallback(
    () =>
      api.phones().then((r) => {
        if (r.ok) {
          setPhones(r.data.devices)
          setMax(r.data.max)
        } else setMissing(true)
        return r
      }),
    []
  )

  useEffect(() => {
    void load()
  }, [load, version, n])

  // While a code is showing: count down, and look for the phone every 4 seconds.
  useEffect(() => {
    if (!pair) return
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const look = setInterval(() => {
      void load().then((r) => {
        if (r.ok && r.data.devices.length > pair.count) {
          setPair(null)
          toast(`${r.data.devices[0]?.name ?? 'The phone'} is approved.`)
        }
      })
    }, 4000)
    return () => {
      clearInterval(tick)
      clearInterval(look)
    }
  }, [pair, load, toast])

  const full = phones !== null && phones.length >= max
  const startPair = useCallback(
    (): void =>
      onAction({
        title: 'Approve a new iPhone',
        intro:
          'Control shows a code to type on the phone. It works for 5 minutes, only on this home network (your Wi‑Fi).',
        confirmLabel: 'Show the code',
        notePlaceholder: 'e.g. "My new iPhone"',
        run: async (_v, note) => {
          const r = await api.phonePairCode(note)
          if (!r.ok) return r
          setNow(Date.now())
          setPair({
            code: r.data.code,
            until: Date.now() + r.data.expiresIn * 1000,
            count: phones?.length ?? 0
          })
          return { ok: true, data: { message: 'Type the code on your iPhone.' } }
        }
      }),
    [onAction, phones]
  )

  // From the command bar.
  useEffect(() => {
    if (pairRequest > 0 && phones) startPair()
    // Only when a new request arrives (or the list first loads with one waiting).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairRequest, phones === null])

  if (missing) return null
  const left = pair ? Math.max(0, Math.ceil((pair.until - now) / 1000)) : 0

  return (
    <section className="card card-pad server-card" aria-labelledby="phones-title">
      <div className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <Icon d={ICONS.phone} size={22} strokeWidth={2} />
        </span>
        <div className="server-card-titles">
          <h2 id="phones-title">Approved phones</h2>
          <span className="hint">Control for iPhone works only on phones you approve here.</span>
        </div>
      </div>

      {!phones && (
        <p className="loading" style={{ padding: 0 }}>
          Loading…
        </p>
      )}
      {phones?.length === 0 && (
        <p className="hint" style={{ margin: 0, fontSize: 13.5 }}>
          No phones yet. Approve your iPhone to use Control on the go.
        </p>
      )}
      {phones && phones.length > 0 && (
        <ul className="phone-list">
          {phones.map((p) => (
            <li key={p.id} className="phone-row">
              <span className="text">
                <span className="name">{p.name}</span>
                <span className="sub">
                  Approved {shortDate(p.createdAt)} ·{' '}
                  {p.lastUsedAt ? `last used ${ago(p.lastUsedAt)}` : 'not used yet'}
                </span>
              </span>
              <Chip small tone={p.alerts ? 'good' : 'plain'}>
                {p.alerts ? 'Alerts on' : 'Alerts off'}
              </Chip>
              <button
                type="button"
                className="btn btn--small btn--danger-soft"
                onClick={() =>
                  onAction({
                    title: `Remove ${p.name}`,
                    intro:
                      'It can’t use Control any more and its sessions end now. You can approve it again later with a new code.',
                    confirmLabel: 'Remove phone',
                    danger: true,
                    notePlaceholder: 'e.g. "Lost my phone"',
                    run: async (_v, note) => {
                      const r = await api.removePhone(p.id, note)
                      if (r.ok) setN((x) => x + 1)
                      return r
                    }
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {pair ? (
        <div className="pair-box" role="status" aria-live="polite">
          <span className="title">Approve a new iPhone</span>
          {left > 0 ? (
            <>
              <span className="sub">
                Open Glofly Control on your iPhone at home (on your Wi‑Fi) and type this code.
              </span>
              <span className="pair-code" aria-label={`Code ${pair.code.split('').join(' ')}`}>
                {showCode(pair.code)}
              </span>
              <span className="sub">
                Works for{' '}
                <strong>
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
                </strong>{' '}
                more. This card notices when the phone is approved.
              </span>
              <div className="server-buttons">
                <button type="button" className="btn btn--small" onClick={() => setPair(null)}>
                  Hide the code
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="sub">
                The code ran out. Make a new one when your phone is ready.
              </span>
              <div className="server-buttons">
                <button type="button" className="btn btn--small" onClick={startPair}>
                  New code…
                </button>
                <button type="button" className="btn btn--small" onClick={() => setPair(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="server-buttons">
          <button type="button" className="btn" disabled={!phones || full} onClick={startPair}>
            <Icon d={ICONS.plus} size={16} strokeWidth={2.2} />
            Approve a new iPhone…
          </button>
          {full && (
            <span className="hint" style={{ alignSelf: 'center' }}>
              You can approve up to {max} phones. Remove one first.
            </span>
          )}
        </div>
      )}
    </section>
  )
}

// ───────────── Alerts ─────────────

export function AlertsCard({
  version,
  testRequest,
  onDesktopChange,
  toast
}: {
  version: number
  /** Goes up when the command bar asks for "Send a test alert" */
  testRequest: number
  onDesktopChange: (on: boolean) => void
  toast: Toast
}): JSX.Element | null {
  const [prefs, setPrefs] = useState<AlertPrefs | null>(null)
  const [pushReady, setPushReady] = useState(true)
  const [missing, setMissing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ text: string; bad: boolean } | null>(null)
  const id = useId()

  useEffect(() => {
    let live = true
    void api.alerts(new Date().toISOString()).then((r) => {
      if (!live) return
      if (r.ok) {
        setPrefs(r.data.prefs)
        setPushReady(r.data.pushReady)
      } else setMissing(true)
    })
    return () => {
      live = false
    }
  }, [version])

  const save = async (change: {
    kinds?: Partial<Record<AlertKind, boolean>>
    desktop?: boolean
  }): Promise<void> => {
    if (!prefs) return
    const before = prefs
    setPrefs({
      kinds: { ...prefs.kinds, ...change.kinds },
      desktop: change.desktop ?? prefs.desktop
    })
    const r = await api.setAlertPrefs(change)
    if (r.ok) {
      setPrefs(r.data.prefs)
      onDesktopChange(r.data.prefs.desktop)
    } else {
      setPrefs(before)
      toast(r.message, true)
    }
  }

  const test = useCallback(async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    const r = await api.testAlert()
    setTesting(false)
    setTestResult(
      r.ok ? { text: r.data.message ?? 'Sent.', bad: false } : { text: r.message, bad: true }
    )
  }, [])

  useEffect(() => {
    if (testRequest <= 0) return
    const timer = setTimeout(() => void test(), 0)
    return () => clearTimeout(timer)
  }, [testRequest, test])

  if (missing) return null

  const row = (k: AlertKind): JSX.Element => (
    <div key={k} className="alert-pref">
      <span className="text">
        <span className="title" id={`${id}-${k}`}>
          {ALERT_LABELS[k].title}
        </span>
        <span className="sub">{ALERT_LABELS[k].sub}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={prefs?.kinds[k] === true}
        aria-labelledby={`${id}-${k}`}
        className="switch"
        disabled={!prefs}
        onClick={() => void save({ kinds: { [k]: !prefs?.kinds[k] } })}
      >
        <span className="switch-knob" />
      </button>
    </div>
  )

  return (
    <section className="card card-pad server-card alerts-card" aria-labelledby="alerts-title">
      <div className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <Icon d={ICONS.bell} size={22} strokeWidth={2} />
        </span>
        <div className="server-card-titles">
          <h2 id="alerts-title">Alerts</h2>
          <span className="hint">What Control tells you about, on your phone and here.</span>
        </div>
      </div>

      {!pushReady && (
        <div className="notice notice--warn">
          <Icon d={ICONS.info} size={18} strokeWidth={2} />
          <span>
            Alerts to phones are off on this server. They need the Apple push settings on the server
            (<code>APNS_KEY_FILE</code>, <code>APNS_KEY_ID</code> and <code>APNS_TEAM_ID</code>).
            Desktop notifications still work.
          </span>
        </div>
      )}

      <div className="alert-groups">
        <div className="alert-group">
          <h3 className="section-label">Urgent · breaks through Focus</h3>
          {ALERT_KINDS.filter((k) => URGENT_ALERTS.includes(k)).map(row)}
        </div>
        <div className="alert-group">
          <h3 className="section-label">Normal</h3>
          {ALERT_KINDS.filter((k) => !URGENT_ALERTS.includes(k)).map(row)}
        </div>
      </div>

      <div className="alert-pref alert-pref--desktop">
        <span className="text">
          <span className="title" id={`${id}-desktop`}>
            Show desktop notifications while Control is open
          </span>
          <span className="sub">
            Control checks every 30 seconds. Clicking one opens the page it’s about.
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={prefs?.desktop === true}
          aria-labelledby={`${id}-desktop`}
          className="switch"
          disabled={!prefs}
          onClick={() => void save({ desktop: !prefs?.desktop })}
        >
          <span className="switch-knob" />
        </button>
      </div>

      <p className="hint" style={{ margin: 0, fontSize: 12.5 }}>
        Alerts never include message text or the names of people who reported someone, so nothing
        private shows on your lock screen.
      </p>

      <div className="server-buttons" style={{ alignItems: 'center' }}>
        <button type="button" className="btn" disabled={testing} onClick={() => void test()}>
          {testing ? 'Sending…' : 'Send a test alert'}
        </button>
        {testResult && (
          <span
            className={testResult.bad ? 'hint hint--error' : 'hint'}
            role="status"
            style={{ fontSize: 13 }}
          >
            {testResult.text}
          </span>
        )}
      </div>
    </section>
  )
}

// ───────────── Quick notes ─────────────

export function QuickNotesCard(): JSX.Element {
  const notes = useQuickNotes()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

  const save = async (next: string[]): Promise<boolean> => {
    setBusy(true)
    const r = await api.setQuickNotes(next)
    setBusy(false)
    if (r.ok) {
      setQuickNotes(r.data.notes)
      setError(null)
      return true
    }
    setError(r.fields ? (Object.values(r.fields)[0] ?? r.message) : r.message)
    return false
  }

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const value = text.trim()
    if (value.length < 3) {
      setError('Each note needs at least 3 characters.')
      return
    }
    if (notes.includes(value)) {
      setError('That note is already there.')
      return
    }
    if (await save([...notes, value])) {
      setText('')
      setAdding(false)
    }
  }

  return (
    <section className="card card-pad server-card" aria-labelledby={`${id}-title`}>
      <div className="server-card-head">
        <span className="server-card-icon" aria-hidden="true">
          <Icon d={ICONS.note} size={22} strokeWidth={2} />
        </span>
        <div className="server-card-titles">
          <h2 id={`${id}-title`}>Quick notes</h2>
          <span className="hint">
            One tap fills the audit note on any action, here and on your phone.
          </span>
        </div>
        {!adding && notes.length < 20 && (
          <button type="button" className="link-btn" onClick={() => setAdding(true)}>
            Add a note
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="hint" style={{ margin: 0, fontSize: 13.5 }}>
          No quick notes. Add the reasons you use most.
        </p>
      ) : (
        <ul className="quick-notes quick-notes--edit" aria-label="Your quick notes">
          {notes.map((n) => (
            <li key={n} className="quick-note quick-note--static">
              {n}
              <button
                type="button"
                className="quick-note-remove"
                aria-label={`Remove “${n}”`}
                disabled={busy}
                onClick={() => void save(notes.filter((x) => x !== n))}
              >
                <Icon d={ICONS.close} size={14} strokeWidth={2.2} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <form className="quick-add" onSubmit={(e) => void add(e)} noValidate>
          <label htmlFor={`${id}-new`} className="visually-hidden">
            New quick note
          </label>
          <input
            id={`${id}-new`}
            className="input"
            maxLength={60}
            value={text}
            placeholder="e.g. Spam account"
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false)
                setError(null)
              }
            }}
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Add
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setAdding(false)
              setError(null)
              setText('')
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {error && (
        <span id={`${id}-error`} className="hint hint--error" role="alert">
          {error}
        </span>
      )}
    </section>
  )
}

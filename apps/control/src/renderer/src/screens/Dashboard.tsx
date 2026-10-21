import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  api,
  PLATFORM_LABEL,
  type ControlAlert,
  type Dashboard as DashboardData,
  type HappeningNow
} from '../lib/api'
import { Avatar, Chip, StatusChip } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ago, bytes, plural, uptime, when } from '../lib/format'
import type { Page } from '../components/Sidebar'

const MODE_NAMES = { open: 'Open', invite: 'Invite only', closed: 'Closed' } as const

export function Dashboard({
  onCreate,
  onFind,
  onOpenAccount,
  onPage,
  onOpenAlert,
  dataVersion
}: {
  onCreate: () => void
  onFind: (q: string) => void
  onOpenAccount: (id: string) => void
  onPage: (page: Page) => void
  /** 0.8.2: open the page an alert is about */
  onOpenAlert: (alert: ControlAlert) => void
  dataVersion: number
}): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [find, setFind] = useState('')
  /** 0.7.3: errors reported in the last 24 hours (null: older server, no card) */
  const [errorsLastDay, setErrorsLastDay] = useState<number | null>(null)

  const load = useCallback(() => {
    void api.dashboard().then((result) => {
      if (result.ok) {
        setData(result.data)
        setError(null)
      } else setError(result.message)
    })
    void api
      .errors('open')
      .then((result) => setErrorsLastDay(result.ok ? result.data.lastDay : null))
  }, [])

  useEffect(() => {
    load()
    // Numbers stay fresh while the dashboard is open.
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [load, dataVersion])

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  })

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="sub">{today}</p>
        </div>
        <div className="tools">
          <form
            className="search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              onFind(find)
            }}
          >
            <Icon d={ICONS.search} size={16} strokeWidth={2} />
            <input
              type="search"
              placeholder="Find an account"
              aria-label="Find an account"
              value={find}
              onChange={(e) => setFind(e.target.value)}
              style={{ width: 180 }}
            />
          </form>
          <button type="button" className="btn btn--primary" onClick={onCreate}>
            <Icon d={ICONS.plus} size={16} strokeWidth={2.2} />
            Create account
          </button>
        </div>
      </header>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {!data && !error && <p className="loading">Loading…</p>}

      {data && (
        <>
          {data.now && <HappeningNowStrip now={data.now} onPage={onPage} />}
          <DashboardBody
            data={data}
            errorsLastDay={errorsLastDay}
            onOpenAccount={onOpenAccount}
            onPage={onPage}
          />
          {data.now && <RecentAlerts alerts={data.now.alerts} onOpen={onOpenAlert} />}
        </>
      )}
    </>
  )
}

function DashboardBody({
  data,
  errorsLastDay,
  onOpenAccount,
  onPage
}: {
  data: DashboardData
  errorsLastDay: number | null
  onOpenAccount: (id: string) => void
  onPage: (page: Page) => void
}): JSX.Element {
  const s = data.stats
  const h = data.health
  const change =
    s.messagesYesterday > 0
      ? Math.round(((s.messagesToday - s.messagesYesterday) / s.messagesYesterday) * 100)
      : null

  const stats: { label: string; value: string; note: string; quiet?: boolean }[] = [
    {
      label: 'Accounts',
      value: s.accounts.toLocaleString('en-US'),
      note: `+${s.newThisWeek} this week`,
      quiet: s.newThisWeek === 0
    },
    {
      label: 'Online now',
      value: s.onlineNow.toLocaleString('en-US'),
      note: `${plural(s.devicesConnected, 'device')} connected`,
      quiet: true
    },
    {
      label: 'Messages today',
      value: s.messagesToday.toLocaleString('en-US'),
      note:
        change === null
          ? `${s.messagesYesterday} yesterday`
          : `${change >= 0 ? '+' : ''}${change}% vs. yesterday`,
      quiet: change === null || change < 0
    },
    {
      label: 'Calls today',
      value: s.callsToday.toLocaleString('en-US'),
      note: plural(s.groupCallsToday, 'group call'),
      quiet: true
    },
    {
      label: 'Files stored',
      value: bytes(s.storageBytes),
      note: `${plural(s.fileCount, 'photo or file', 'photos and files')}`,
      quiet: true
    }
  ]

  const health: { name: string; state: string; light: 'ok' | 'warn' | 'bad' }[] = [
    { name: 'Server', state: `Running · ${uptime(h.server.uptimeSec)}`, light: 'ok' },
    {
      name: 'Database',
      state: h.database.ok ? `Connected · ${h.database.ms} ms` : 'Not reachable',
      light: h.database.ok ? 'ok' : 'bad'
    },
    {
      name: 'Presence (Redis)',
      state: h.redis.ok ? 'Connected' : 'Not reachable',
      light: h.redis.ok ? 'ok' : 'bad'
    },
    { name: 'Live connections', state: plural(h.realtime.devices, 'device'), light: 'ok' },
    {
      name: 'Email',
      state: `${h.email.transport === 'Amazon SES' ? 'Sending' : h.email.transport} · ${h.email.failedToday} failed today`,
      light: h.email.failedToday > 0 ? 'warn' : 'ok'
    },
    {
      name: 'Calls (LiveKit)',
      state: h.calls.configured ? 'Set up' : 'Not set up',
      light: h.calls.configured ? 'ok' : 'warn'
    },
    ...(h.push
      ? [
          {
            name: 'Phone notifications',
            state: h.push.configured
              ? `Firebase · ${h.push.failedToday} failed today`
              : 'Not set up',
            light: (h.push.configured && h.push.failedToday === 0 ? 'ok' : 'warn') as 'ok' | 'warn'
          }
        ]
      : [])
  ]

  const maxPeople = Math.max(1, ...data.versions.map((v) => v.people))
  // Each app (desktop, Android, iPhone, web) numbers its versions separately.
  const platforms = (['desktop', 'android', 'ios', 'web'] as const)
    .map((platform) => {
      const rows = data.versions.filter((v) => (v.platform ?? 'desktop') === platform)
      const newest = rows.find((v) => v.version)?.version ?? null
      const behind = rows.filter((v) => v.version !== newest).reduce((n, v) => n + v.people, 0)
      return { platform, rows, newest, behind }
    })
    .filter((p) => p.rows.length > 0)
  const several = platforms.length > 1
  const maxDay = Math.max(1, ...data.daily.map((d) => Math.max(d.messages, d.calls)))

  return (
    <>
      <section aria-label="Totals" className="stats">
        {stats.map((stat) => (
          <div key={stat.label} className="card stat">
            <span className="label">{stat.label}</span>
            <span className="value">{stat.value}</span>
            <span className={`note${stat.quiet ? ' note--quiet' : ''}`}>{stat.note}</span>
          </div>
        ))}
        {errorsLastDay !== null && (
          <button type="button" className="card stat" onClick={() => onPage('errors')}>
            <span className="label">Errors · last 24 h</span>
            <span className="value">{errorsLastDay.toLocaleString('en-US')}</span>
            <span className={`note${errorsLastDay ? ' note--bad' : ' note--quiet'}`}>
              {errorsLastDay ? 'Open Errors →' : 'All quiet'}
            </span>
          </button>
        )}
      </section>

      <div className="grid-2">
        <section className="card card-pad" aria-labelledby="health-title">
          <div className="card-title">
            <h2 id="health-title">Health</h2>
          </div>
          {health.map((row) => (
            <div key={row.name} className="health-row">
              <span className="name">
                <span
                  className={`light${row.light === 'ok' ? '' : ` light--${row.light}`}`}
                  aria-hidden="true"
                />
                {row.name}
              </span>
              <span className="state">{row.state}</span>
            </div>
          ))}
        </section>

        <section className="card card-pad" aria-labelledby="versions-title">
          <div className="card-title">
            <h2 id="versions-title">App versions in use</h2>
          </div>
          <p className="hint" style={{ margin: 0, fontSize: 13 }}>
            Each person counted once, by the device they used last (past 30 days).
          </p>
          {data.versions.length === 0 && (
            <p className="empty">Nobody has used Glofly in the past 30 days.</p>
          )}
          {platforms.map(({ platform, rows, newest, behind }) => (
            <div key={platform}>
              {several && (
                <h3 style={{ margin: '14px 0 0', fontSize: 14, fontWeight: 600 }}>
                  {PLATFORM_LABEL[platform]}
                </h3>
              )}
              <div className="versions">
                {rows.map((v) => (
                  <div key={v.version ?? 'old'} className="version-row">
                    <span className="v">{v.version ?? 'Older'}</span>
                    <span className="bar" aria-hidden="true">
                      <span style={{ width: `${Math.round((v.people / maxPeople) * 100)}%` }} />
                    </span>
                    <span className="n">{plural(v.people, 'person', 'people')}</span>
                  </div>
                ))}
              </div>
              {behind > 0 && newest && (
                <p className="notice notice--warn" style={{ margin: '12px 0 0' }}>
                  {plural(behind, 'person is', 'people are')} still on an older
                  {several ? ` ${PLATFORM_LABEL[platform]}` : ''} version than {newest}
                  {platform === 'desktop' && rows.some((v) => v.version === null)
                    ? ' ("Older" = 0.1.7 or before)'
                    : ''}
                  . Setting a minimum version (Announcements → Required update) would ask them to
                  update.
                </p>
              )}
            </div>
          ))}
        </section>
      </div>

      <section className="card card-pad" aria-labelledby="activity-title">
        <div className="card-title">
          <h2 id="activity-title">Last 14 days</h2>
          <div className="legend">
            <span>
              <i style={{ background: 'var(--c-purple)' }} />
              Messages
            </span>
            <span>
              <i style={{ background: '#e08a00' }} />
              Calls
            </span>
          </div>
        </div>
        <div className="activity" role="img" aria-label={activityLabel(data.daily)}>
          {data.daily.map((d) => {
            const date = new Date(`${d.day}T12:00:00`)
            return (
              <div
                key={d.day}
                className="day"
                title={`${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}: ${plural(d.messages, 'message')}, ${plural(d.calls, 'call')}, ${plural(d.signups, 'new account')}`}
              >
                <div className="bars">
                  <span
                    className="bar bar--messages"
                    style={{ height: `${(d.messages / maxDay) * 100}%` }}
                  />
                  <span
                    className="bar bar--calls"
                    style={{ height: `${(d.calls / maxDay) * 100}%` }}
                  />
                </div>
                <span className="label">{date.getDate()}</span>
              </div>
            )
          })}
        </div>
      </section>

      <div className="grid-2">
        <section className="card card-pad" aria-labelledby="new-title">
          <div className="card-title">
            <h2 id="new-title">New accounts</h2>
            <button type="button" className="link-btn" onClick={() => onPage('accounts')}>
              See all
            </button>
          </div>
          {data.recentAccounts.length === 0 && <p className="empty">No accounts yet.</p>}
          {data.recentAccounts.map((r) => (
            <div key={r.id} className="person-row">
              <Avatar id={r.id} name={r.displayName} invite={r.kind === 'invite'} />
              <span className="text">
                {r.kind === 'account' ? (
                  <button
                    type="button"
                    className="link-btn name"
                    style={{ textAlign: 'left', color: 'var(--c-ink)', textDecoration: 'none' }}
                    onClick={() => onOpenAccount(r.id)}
                  >
                    {r.displayName}
                  </button>
                ) : (
                  <span className="name">{r.displayName}</span>
                )}
                <span className="handle">
                  @{r.username} ·{' '}
                  {r.kind === 'invite'
                    ? `invited ${ago(r.createdAt)}`
                    : `joined ${ago(r.createdAt)}`}
                </span>
              </span>
              <StatusChip status={r.status} />
            </div>
          ))}
        </section>

        <section className="card card-pad" aria-labelledby="actions-title">
          <div className="card-title">
            <h2 id="actions-title">Your recent actions</h2>
            <button type="button" className="link-btn" onClick={() => onPage('audit')}>
              Audit log
            </button>
          </div>
          {data.recentActions.length === 0 && (
            <p className="empty">Nothing yet. Every action you take shows here.</p>
          )}
          {data.recentActions.map((a) => (
            <div key={a.id} className="action-row">
              <span>
                <strong style={{ fontWeight: 600 }}>{a.action}</strong>
                {a.targetLabel ? ` · ${a.targetLabel}` : ''}
              </span>
              <span className="meta">
                {a.note ? `“${a.note}” · ` : ''}
                {when(a.createdAt)}
              </span>
            </div>
          ))}
          <p className="hint" style={{ marginTop: 10, fontSize: 13 }}>
            Sign-ups are <strong>{MODE_NAMES[data.signupMode]}</strong>.{' '}
            <button type="button" className="link-btn" onClick={() => onPage('signups')}>
              Change
            </button>
          </p>
        </section>
      </div>
    </>
  )
}

/** 0.8.2: what's going on right now (older servers don't send `now`: no strip). */
function HappeningNowStrip({
  now,
  onPage
}: {
  now: HappeningNow
  onPage: (page: Page) => void
}): JSX.Element {
  const oldest = now.oldestOpenReport
  return (
    <section className="card happening" aria-labelledby="now-title">
      <h2 id="now-title" className="happening-title">
        <span className="live-dot" aria-hidden="true" />
        Happening now
      </h2>
      <div className="happening-items">
        <div className="happening-item">
          <span className="value">{now.calls.toLocaleString('en-US')}</span>
          <span className="label">
            {now.calls === 1 ? 'call' : 'calls'} · {plural(now.inCalls, 'person', 'people')} in them
          </span>
        </div>
        <button type="button" className="happening-item" onClick={() => onPage('inbox')}>
          <span className={`value${now.inboxUnread ? ' value--gold' : ''}`}>
            {now.inboxUnread.toLocaleString('en-US')}
          </span>
          <span className="label">
            Inbox {now.inboxUnread === 1 ? 'reply' : 'replies'} to read →
          </span>
        </button>
        <button type="button" className="happening-item" onClick={() => onPage('reports')}>
          <span className="value">{oldest ? ago(oldest.createdAt).replace(' ago', '') : '—'}</span>
          <span className="label">
            {oldest ? 'oldest open report is waiting →' : 'no open reports'}
          </span>
        </button>
        {now.lockdown.on && (
          <button type="button" className="happening-item" onClick={() => onPage('server')}>
            <Chip tone="bad">Lockdown on</Chip>
            <span className="label">
              {now.lockdown.since ? `since ${ago(now.lockdown.since)}` : ''} →
            </span>
          </button>
        )}
      </div>
    </section>
  )
}

function RecentAlerts({
  alerts,
  onOpen
}: {
  alerts: ControlAlert[]
  onOpen: (alert: ControlAlert) => void
}): JSX.Element {
  return (
    <section className="card card-pad" aria-labelledby="alerts-title">
      <div className="card-title">
        <h2 id="alerts-title">Recent alerts</h2>
      </div>
      {alerts.length === 0 ? (
        <p className="empty">No alerts yet. Server, report and sign-in alerts show here.</p>
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id}>
              <button type="button" className="alert-row" onClick={() => onOpen(a)}>
                <span className="text">
                  <span className="title">{a.title}</span>
                  <span className="sub">{a.body}</span>
                </span>
                <span className="when">{when(a.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function activityLabel(daily: DashboardData['daily']): string {
  const messages = daily.reduce((n, d) => n + d.messages, 0)
  const calls = daily.reduce((n, d) => n + d.calls, 0)
  return `Last 14 days: ${plural(messages, 'message')} and ${plural(calls, 'call')} in all.`
}

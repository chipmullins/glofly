import { useEffect, useState, type JSX } from 'react'
import {
  api,
  type BigConstellations,
  type Insights as InsightsData,
  type PeopleInsights
} from '../lib/api'
import { Chip } from '../components/common'
import { ago, plural } from '../lib/format'

// Insights (Oct 28, 2026): who's using Glofly and coming back, how calls are going, which features
// people use, and how far new people get. Read-only; the numbers come from GET /admin/insights.

const RANGES = [7, 30, 90] as const
type Range = (typeof RANGES)[number]

const FEATURE_LABELS: Record<string, string> = {
  messages: 'Messages (chats and groups)',
  nebula_messages: 'Messages in Constellations',
  replies: 'Replies',
  reactions: 'Reactions',
  photos: 'Photos',
  videos: 'Videos',
  voice: 'Voice messages',
  files: 'Files',
  stickers: 'Stickers',
  gifs: 'GIFs',
  links: 'Link previews',
  polls: 'Polls',
  games: 'Games in chat',
  lanterns: 'Lanterns',
  pins: 'Pinned messages',
  voice_calls: 'Voice calls',
  video_calls: 'Video calls',
  group_calls: 'Group calls',
  watch: 'Watch Together',
  voice_rooms: 'Voice nebulas',
  constellation_joins: 'Joined a constellation',
  constellations_made: 'New constellations',
  friends: 'New friendships'
}

const APP_COLORS = {
  desktop: 'var(--c-purple)',
  web: '#2f9e8f',
  ios: '#e08a00',
  android: '#5b8def'
}
const APP_NAMES = { desktop: 'Desktop', web: 'Web', ios: 'iPhone', android: 'Android' }
const APP_LABEL: Record<string, string> = APP_NAMES

const pct = (n: number, of: number): string => (of > 0 ? `${Math.round((n / of) * 100)}%` : '—')
const num = (n: number): string => n.toLocaleString('en-US')
const shortDay = (day: string): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function Insights(): JSX.Element {
  // Communities round 2 (board 4b): the Big constellations view
  const [view, setView] = useState<'overview' | 'big'>('overview')
  const [days, setDays] = useState<Range>(30)
  const [data, setData] = useState<InsightsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void api.insights(days).then((r) => {
      if (!live) return
      if (r.ok) setData(r.data)
      else setError(r.message)
    })
    return () => {
      live = false
    }
  }, [days])

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Insights</h1>
          <p className="sub">How people use Glofly. Counts only, never what anyone wrote.</p>
        </div>
        <div className="tools filters" role="group" aria-label="What to show">
          <button
            type="button"
            className="filter"
            aria-pressed={view === 'overview'}
            onClick={() => setView('overview')}
          >
            Overview
          </button>
          <button
            type="button"
            className="filter"
            aria-pressed={view === 'big'}
            onClick={() => setView('big')}
          >
            Big constellations
          </button>
        </div>
        {view === 'overview' && (
          <div className="tools filters" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                className="filter"
                aria-pressed={days === r}
                onClick={() => {
                  setError(null)
                  setDays(r)
                }}
              >
                Last {r} days
              </button>
            ))}
          </div>
        )}
      </header>
      {view === 'big' && <BigView />}
      {view === 'overview' && error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {view === 'overview' && !data && !error && <p className="loading">Loading…</p>}
      {view === 'overview' && data && (
        <>
          <People people={data.people} />
          <div className="grid-2">
            <Funnel data={data} />
            <Calls data={data} />
          </div>
          <Features data={data} />
        </>
      )}
    </>
  )
}

function People({ people }: { people: PeopleInsights }): JSX.Element {
  const max = Math.max(1, ...people.daily.map((d) => d.people))
  const appTotal = people.apps.desktop + people.apps.web + people.apps.ios + people.apps.android
  return (
    <>
      <section aria-label="Active people" className="stats">
        <div className="card stat">
          <span className="label">Today</span>
          <span className="value">{num(people.today)}</span>
          <span className="note note--quiet">people used Glofly</span>
        </div>
        <div className="card stat">
          <span className="label">This week</span>
          <span className="value">{num(people.week)}</span>
          <span className="note note--quiet">last 7 days</span>
        </div>
        <div className="card stat">
          <span className="label">This month</span>
          <span className="value">{num(people.month)}</span>
          <span className="note note--quiet">
            {pct(people.month, people.accounts)} of {plural(people.accounts, 'account')}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Stickiness</span>
          <span className="value">{pct(people.today, people.month)}</span>
          <span className="note note--quiet">of this month&apos;s people came today</span>
        </div>
      </section>

      <section className="card card-pad" aria-labelledby="daily-people-title">
        <div className="card-title">
          <h2 id="daily-people-title">People each day · last 30 days</h2>
          <div className="legend">
            {(Object.keys(APP_NAMES) as (keyof typeof APP_NAMES)[]).map((k) => (
              <span key={k}>
                <i style={{ background: APP_COLORS[k] }} />
                {APP_NAMES[k]}
                {appTotal > 0 ? ` ${pct(people.apps[k], appTotal)}` : ''}
              </span>
            ))}
          </div>
        </div>
        <div className="activity" role="img" aria-label="People who used Glofly each day">
          {people.daily.map((d) => {
            const known = d.desktop + d.web + d.ios + d.android
            const unknown = Math.max(0, d.people - known)
            return (
              <div
                key={d.day}
                className="day"
                title={`${shortDay(d.day)}: ${plural(d.people, 'person', 'people')}`}
              >
                <div
                  className="bars"
                  style={{ flexDirection: 'column', justifyContent: 'flex-end', gap: 0 }}
                >
                  {(['android', 'ios', 'web', 'desktop'] as const).map((k) =>
                    d[k] ? (
                      <span
                        key={k}
                        style={{
                          display: 'block',
                          width: '100%',
                          height: `${(d[k] / max) * 100}%`,
                          background: APP_COLORS[k]
                        }}
                      />
                    ) : null
                  )}
                  {unknown > 0 && (
                    <span
                      style={{
                        display: 'block',
                        width: '100%',
                        height: `${(unknown / max) * 100}%`,
                        background: 'var(--c-row-line)'
                      }}
                    />
                  )}
                </div>
                <span className="label">{new Date(`${d.day}T12:00:00`).getDate()}</span>
              </div>
            )
          })}
        </div>
        {people.countingSince && (
          <p className="hint" style={{ margin: '10px 0 0', fontSize: 12.5 }}>
            Counted from {shortDay(people.countingSince)}. Earlier days (gray) only count people who
            sent a message.
          </p>
        )}
      </section>

      <section className="card card-pad" aria-labelledby="cohorts-title">
        <div className="card-title">
          <h2 id="cohorts-title">Do new people come back?</h2>
        </div>
        <p className="hint" style={{ margin: '0 0 10px', fontSize: 13 }}>
          People grouped by the week they joined. A box stays empty until enough time has passed to
          know.
        </p>
        {people.cohorts.length === 0 ? (
          <p className="empty">Nobody joined in the past 8 weeks.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Joined the week of</th>
                  <th scope="col">People</th>
                  <th scope="col">Next day</th>
                  <th scope="col">First week</th>
                  <th scope="col">A month later</th>
                </tr>
              </thead>
              <tbody>
                {people.cohorts.map((c) => (
                  <tr key={c.week}>
                    <td>{shortDay(c.week)}</td>
                    <td>{num(c.joined)}</td>
                    <td>{c.d1_of ? `${pct(c.d1, c.d1_of)} (${c.d1}/${c.d1_of})` : '—'}</td>
                    <td>{c.w1_of ? `${pct(c.w1, c.w1_of)} (${c.w1}/${c.w1_of})` : '—'}</td>
                    <td>{c.m1_of ? `${pct(c.m1, c.m1_of)} (${c.m1}/${c.m1_of})` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function Funnel({ data }: { data: InsightsData }): JSX.Element {
  const f = data.funnel
  const first = f.steps[0]?.people ?? 0
  return (
    <section className="card card-pad" aria-labelledby="funnel-title">
      <div className="card-title">
        <h2 id="funnel-title">New people · last {f.days} days</h2>
      </div>
      {first === 0 ? (
        <p className="empty">Nobody made an account in this time.</p>
      ) : (
        <>
          <div className="versions">
            {f.steps.map((s) => (
              <div key={s.key} className="version-row">
                <span className="v" style={{ width: 170, fontWeight: 500 }}>
                  {s.label}
                </span>
                <span className="bar" aria-hidden="true">
                  <span style={{ width: `${(s.people / first) * 100}%` }} />
                </span>
                <span className="n">
                  {num(s.people)} · {pct(s.people, first)}
                </span>
              </div>
            ))}
          </div>
          <p className="hint" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
            {f.medianMinutesToFirstMessage !== null
              ? `Half send their first message within ${duration(Math.round(f.medianMinutesToFirstMessage * 60))} of joining. `
              : ''}
            {plural(f.joinedConstellation, 'person', 'people')} joined a constellation.
          </p>
        </>
      )}
    </section>
  )
}

function Calls({ data }: { data: InsightsData }): JSX.Element {
  const c = data.calls
  const max = Math.max(1, ...c.daily.map((d) => d.started))
  // 90 days of bars is too many to read: show the last 30.
  const daily = c.daily.slice(-30)
  return (
    <section className="card card-pad" aria-labelledby="calls-title">
      <div className="card-title">
        <h2 id="calls-title">Calls · last {c.days} days</h2>
        <div className="legend">
          <span>
            <i style={{ background: 'var(--c-purple)' }} />
            Answered
          </span>
          <span>
            <i style={{ background: '#e08a00' }} />
            Missed or declined
          </span>
        </div>
      </div>
      <div
        className="mini-stats"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginBottom: 8 }}
      >
        <span>
          <strong>{num(c.started)}</strong> started
        </span>
        <span>
          <strong>{pct(c.answered, c.started)}</strong> answered
        </span>
        <span>
          <strong>{duration(c.avgSeconds)}</strong> average
        </span>
        <span>
          <strong>{c.avgPeople || '—'}</strong> people per call
        </span>
        <span>
          <strong>{pct(c.video, c.started)}</strong> video
        </span>
      </div>
      <div className="activity" style={{ height: 110 }} role="img" aria-label="Calls each day">
        {daily.map((d) => (
          <div
            key={d.day}
            className="day"
            title={`${shortDay(d.day)}: ${plural(d.started, 'call')}, ${d.answered} answered, ${d.missed} missed or declined`}
          >
            <div className="bars">
              <span
                className="bar bar--messages"
                style={{ height: `${(d.answered / max) * 100}%` }}
              />
              <span className="bar bar--calls" style={{ height: `${(d.missed / max) * 100}%` }} />
            </div>
            <span className="label">{new Date(`${d.day}T12:00:00`).getDate()}</span>
          </div>
        ))}
      </div>
      <div className="health-row">
        <span className="name">Over in under 20 seconds</span>
        <span className="state">
          {num(c.short)} {c.answered ? `(${pct(c.short, c.answered)} of answered)` : ''}
        </span>
      </div>
      <div className="health-row">
        <span className="name">Voice nebulas</span>
        <span className="state">
          {plural(c.voiceRooms.rooms, 'room')} · {plural(c.voiceRooms.people, 'person', 'people')} ·{' '}
          {num(c.voiceRooms.minutes)} min
        </span>
      </div>
      <h3 style={{ margin: '14px 0 6px', fontSize: 14, fontWeight: 600 }}>
        Call problems the apps reported
      </h3>
      {c.problems.length === 0 ? (
        <p className="empty" style={{ margin: 0 }}>
          None in this time.
        </p>
      ) : (
        c.problems.map((p) => (
          <div key={p.id} className="health-row" style={{ alignItems: 'flex-start' }}>
            <span
              className="name"
              style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
            >
              {p.message.replace(/^Call:\s*/, '')}
              <span className="hint" style={{ fontSize: 12.5 }}>
                {[APP_LABEL[p.app] ?? p.app, p.appVersion, p.os].filter(Boolean).join(' · ')} · last{' '}
                {ago(p.lastAt)}
              </span>
            </span>
            <span className="state">
              <Chip small tone={p.resolvedAt ? 'good' : 'warn'}>
                {p.resolvedAt
                  ? 'Resolved'
                  : `${plural(p.count, 'time')} · ${plural(p.people, 'person', 'people')}`}
              </Chip>
            </span>
          </div>
        ))
      )}
    </section>
  )
}

function Features({ data }: { data: InsightsData }): JSX.Element {
  const f = data.features
  const rows = [...f.features].sort((a, b) => b.people - a.people || b.uses - a.uses)
  const most = Math.max(1, f.activePeople, ...rows.map((r) => r.people))
  return (
    <section className="card card-pad" aria-labelledby="features-title">
      <div className="card-title">
        <h2 id="features-title">What people use · last {f.days} days</h2>
        <span className="hint" style={{ fontSize: 13 }}>
          {plural(f.activePeople, 'active person', 'active people')}
        </span>
      </div>
      <div className="versions">
        {rows.map((r) => (
          <div key={r.key} className="version-row">
            <span className="v" style={{ width: 210, fontWeight: 500 }}>
              {FEATURE_LABELS[r.key] ?? r.key}
            </span>
            <span className="bar" aria-hidden="true">
              <span style={{ width: `${(r.people / most) * 100}%`, opacity: r.people ? 1 : 0 }} />
            </span>
            <span className="n" style={{ width: 190 }}>
              {plural(r.people, 'person', 'people')} · {plural(r.uses, 'time')}
            </span>
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '12px 0 0', fontSize: 12.5 }}>
        The bar is how many people used it. Screen sharing and the game overlay aren&apos;t counted
        (nothing about them is stored).
      </p>
    </section>
  )
}

/** Communities round 2 (board 4b): which constellations are big and how hard they push the server. */
function BigView(): JSX.Element {
  const [data, setData] = useState<BigConstellations | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState(0)
  useEffect(() => {
    let live = true
    void api.bigConstellations().then((r) => {
      if (!live) return
      if (r.ok) setData(r.data)
      else setError(r.message)
    })
    return () => {
      live = false
    }
  }, [])
  if (error)
    return (
      <div className="error-box" role="alert">
        {error}
      </div>
    )
  if (!data) return <p className="loading">Loading…</p>
  const c = data.constellations[pick] ?? null
  const max = Math.max(1, ...(c?.weekly ?? [1]))
  return (
    <>
      <section aria-label="Big constellations" className="stats">
        <div className="card stat">
          <span className="label">Over {num(data.threshold)} members</span>
          <span className="value">{num(data.bigCount)}</span>
          <span className="note note--quiet">
            {data.newThisWeek ? `+${data.newThisWeek} this week` : 'none new this week'}
          </span>
        </div>
        <div className="card stat">
          <span className="label">Biggest</span>
          <span className="value">{data.biggest ? num(data.biggest.members) : '—'}</span>
          <span className="note note--quiet">{data.biggest?.name ?? 'no constellations yet'}</span>
        </div>
        <div className="card stat">
          <span className="label">Live events / min</span>
          <span className="value">
            {num(Math.max(data.fanOut.lastMinute, data.fanOut.thisMinute))}
          </span>
          <span className="note note--quiet">comfortable up to {num(data.fanOut.comfort)}</span>
        </div>
        <div className="card stat">
          <span className="label">Voice + stage, 30 days</span>
          <span className="value">${data.minutes.estimate.toFixed(2)} est.</span>
          <span className="note note--quiet">
            {num(data.minutes.voice + data.minutes.stage)} LiveKit minutes × $
            {data.minutes.pricePerMinute}
          </span>
        </div>
      </section>
      {!data.bigCount && (
        <p className="sub">
          No constellation is over {num(data.threshold)} members yet. These are the biggest ones.
        </p>
      )}
      {data.constellations.length > 1 && (
        <div className="tools filters" role="group" aria-label="Constellation">
          {data.constellations.map((x, i) => (
            <button
              key={x.id}
              type="button"
              className="filter"
              aria-pressed={pick === i}
              onClick={() => setPick(i)}
            >
              {x.name} · {num(x.members)}
            </button>
          ))}
        </div>
      )}
      {c && (
        <div className="grid-2">
          <section className="card card-pad" aria-labelledby="big-table-title">
            <div className="card-title">
              <h2 id="big-table-title">{c.name}</h2>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Today</th>
                  <th>7-day avg</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Messages</td>
                  <td>{num(c.messagesToday)}</td>
                  <td>{num(c.messagesWeekAvg)}</td>
                </tr>
                <tr>
                  <td>People who posted</td>
                  <td>{num(c.activeToday)}</td>
                  <td>{num(c.activeWeekAvg)}</td>
                </tr>
                <tr>
                  <td>Online now</td>
                  <td>{num(c.onlineNow)}</td>
                  <td />
                </tr>
                <tr>
                  <td>Biggest voice nebula / stage</td>
                  <td>
                    {num(c.biggestVoiceToday)} / {num(c.biggestStageToday)}
                  </td>
                  <td>
                    {num(c.biggestVoiceWeek)} / {num(c.biggestStageWeek)} (week max)
                  </td>
                </tr>
                <tr>
                  <td>Sends refused (busy)</td>
                  <td>{num(c.busyToday)}</td>
                  <td>{num(c.busyWeekAvg)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="card card-pad" aria-labelledby="big-members-title">
            <div className="card-title">
              <h2 id="big-members-title">Members, last 12 weeks</h2>
            </div>
            <div
              className="activity"
              role="img"
              aria-label={`Members each week, now ${num(c.members)}`}
            >
              {c.weekly.map((n, i) => (
                <div key={i} className="day" title={`${num(n)} members`}>
                  <div
                    className="bars"
                    style={{ flexDirection: 'column', justifyContent: 'flex-end' }}
                  >
                    <span
                      style={{
                        display: 'block',
                        width: '100%',
                        height: `${(n / max) * 100}%`,
                        background: i === c.weekly.length - 1 ? '#f47a1f' : '#3b82f6'
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="sub">
              LiveKit bills every connected minute, speakers and stage listeners alike (listeners
              send nothing): 300 listeners for an hour ≈ 18,000 participant-minutes.
            </p>
          </section>
        </div>
      )}
    </>
  )
}

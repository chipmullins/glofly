import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BAN_DELETE_WINDOWS,
  MENTION_CAP_ACTIONS,
  MENTION_CAP_CHOICES,
  MOD_LOG_DAYS,
  MOD_LOG_FILTERS,
  QUICK_BAN_REASONS,
  RAID_ACCOUNT_DAYS_CHOICES,
  RAID_JOINS_CHOICES,
  RAID_PAUSE_CHOICES,
  RAID_SECONDS_CHOICES,
  VERIFICATION_LEVELS,
  type BanAppeal,
  type BanAppeals,
  type BanDeleteWindow,
  type ConstellationDetail,
  type ModLogEntry,
  type MyBan,
  type NightWatch,
  type PublicUser,
  type QueueItem,
  type SafetySettings
} from '@glofly/shared'
import { AvatarFace } from '../components/Avatar'
import { colorsFor } from '../lib/avatarColors'
import { can } from '../lib/constellations'
import {
  ago,
  actorName,
  at,
  clock,
  handle,
  logLine,
  reasonName,
  watch,
  type ModLogQuery,
  type RaidJoiner
} from '../lib/nightwatch'
import './NightWatch.css'

// Communities round 2 (Nov 11, 2026): Night watch, approved canvas "Glofly communities round 2"
// boards 1a (dashboard), 1b (mod log), 1c (ban reasons + appeals) and 1d (Safety). Everything is
// checked on the server; each button here only shows when your role allows it.

function Face({
  person,
  size = 30
}: {
  person: PublicUser | null
  size?: number
}): React.JSX.Element {
  const [bg, fg] = colorsFor(person?.id ?? 'glofly')
  return (
    <span
      className="nw-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.4)
      }}
    >
      {person ? (
        <AvatarFace id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
      ) : (
        <ShieldIcon size={Math.round(size * 0.55)} />
      )}
    </span>
  )
}

function ShieldIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    </svg>
  )
}
const ICONS: Record<string, string> = {
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  at: 'M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  mail: 'M3 5h18v14H3zM3 7l9 6 9-6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  users:
    'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3'
}
function Icon({
  name,
  size = 16
}: {
  name: keyof typeof ICONS | string
  size?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] ?? ICONS.shield} />
    </svg>
  )
}

// ───────────── 1a · The dashboard ─────────────

export function NightWatchPage({
  c,
  meId,
  onOpen,
  onProblem
}: {
  c: ConstellationDetail
  meId: string
  onOpen: (page: 'modlog' | 'safety' | 'appeals') => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [data, setData] = useState<NightWatch | null>(null)
  const [tab, setTab] = useState<'all' | 'report' | 'held' | 'appeal'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [banning, setBanning] = useState<PublicUser | null>(null)
  const [appeal, setAppeal] = useState<string | null>(null)
  const load = useCallback(() => {
    void watch.dashboard(c.id).then((r) => {
      if (r.ok) setData(r.data)
      else onProblem(r.message)
    })
  }, [c.id, onProblem])
  useEffect(() => {
    load()
    return window.glofly.onEvent((e) => {
      if (
        (e.type === 'nightwatch:changed' || e.type === 'constellation:raid') &&
        e.constellationId === c.id
      )
        load()
    })
  }, [c.id, load])

  async function act(
    key: string,
    task: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>
  ): Promise<void> {
    setBusy(key)
    const r = await task()
    setBusy(null)
    if (!r.ok) onProblem(r.message)
    load()
  }

  if (!data)
    return (
      <div className="cx-settings-body">
        <p className="cx-settings-text">Loading…</p>
      </div>
    )
  const n = data.counts
  const needs = n.reports + n.held + n.appeals
  const look = n.reports + n.held
  const items = data.queue.filter((q) => tab === 'all' || q.kind === tab)
  const paused = data.raid.pausedUntil
  return (
    <div className="cx-settings-body nw">
      <div className="nw-stats">
        <Stat
          n={look}
          label="Need a look"
          sub={`${n.reports} report${n.reports === 1 ? '' : 's'}, ${n.held} held`}
          tone="red"
          icon="flag"
        />
        <Stat
          n={n.appeals}
          label={n.appeals === 1 ? 'Appeal waiting' : 'Appeals waiting'}
          sub={data.can.ban ? 'from banned people' : 'people with Ban decide'}
          tone="blue"
          icon="mail"
        />
        <Stat
          n={n.timedOut}
          label="Timed out now"
          sub="they can read, not post"
          tone="brown"
          icon="clock"
        />
        <Stat
          n={n.actionsWeek}
          label="Actions this week"
          sub={`by ${n.moderatorsWeek} moderator${n.moderatorsWeek === 1 ? '' : 's'}`}
          tone="green"
          icon="shield"
        />
      </div>
      {paused ? (
        <RaidStrip c={c} data={data} onChanged={load} onProblem={onProblem} />
      ) : (
        <div className="nw-calm">
          <ShieldIcon size={20} />
          <span>
            <b>All calm.</b> Joins open · Verification:{' '}
            {VERIFICATION_LEVELS.find((l) => l.id === data.safety.verification)?.name} · Raid
            protection {data.safety.raidOn ? 'on' : 'off'} · {data.joinsToday} join
            {data.joinsToday === 1 ? '' : 's'} today
            {data.joinsUsual > 0 ? ` (normal is ~${data.joinsUsual})` : ''}
          </span>
          <button type="button" className="nw-link" onClick={() => onOpen('safety')}>
            Safety settings ›
          </button>
        </div>
      )}
      <div className="nw-tabs" role="tablist" aria-label="What to look at">
        {(
          [
            ['all', `Needs a look · ${needs}`],
            ['report', `Reports · ${n.reports}`],
            ['held', `Held by AutoMod · ${n.held}`],
            ...(data.can.ban ? [['appeal', `Appeals · ${n.appeals}`]] : [])
          ] as [typeof tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="nw-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="nw-cols">
        <div className="nw-queue">
          {items.length === 0 && (
            <p className="nw-empty">
              Nothing waiting. Reports from members and messages AutoMod holds show up here.
            </p>
          )}
          {items.map((q) => (
            <QueueCard
              key={`${q.kind}:${q.id}`}
              q={q}
              c={c}
              data={data}
              busy={busy}
              act={act}
              onBan={setBanning}
              onAppeal={() => (data.can.ban ? setAppeal(q.id) : undefined)}
            />
          ))}
        </div>
        <aside className="nw-latest" aria-label="Latest in the mod log">
          <div className="nw-latest-head">
            <b>Latest in the mod log</b>
            <button type="button" className="nw-link" onClick={() => onOpen('modlog')}>
              See all ›
            </button>
          </div>
          {data.latest.length === 0 && <p className="nw-empty">Nothing yet.</p>}
          {data.latest.map((e) => {
            const l = logLine(e)
            return (
              <div key={e.id} className="nw-latest-line">
                <Face person={e.actor} size={28} />
                <div>
                  <b>{actorName(e, meId)}</b> {l.verb}
                  {l.target}
                  {l.extra}
                  {l.reason ? ` · “${l.reason}”` : ''}
                  <div className="nw-when">{ago(e.createdAt)}</div>
                </div>
              </div>
            )
          })}
        </aside>
      </div>
      {banning && (
        <BanDialog
          c={c}
          person={banning}
          onClose={() => setBanning(null)}
          onDone={() => {
            setBanning(null)
            load()
          }}
          onProblem={onProblem}
        />
      )}
      {appeal && (
        <AppealDialog
          c={c}
          appealId={appeal}
          onClose={() => setAppeal(null)}
          onDone={() => {
            setAppeal(null)
            load()
          }}
          onProblem={onProblem}
        />
      )}
    </div>
  )
}

function Stat({
  n,
  label,
  sub,
  tone,
  icon
}: {
  n: number
  label: string
  sub: string
  tone: string
  icon: string
}): React.JSX.Element {
  return (
    <div className="nw-stat">
      <div className="nw-stat-top">
        <span className={`nw-stat-icon nw-tone-${tone}`}>
          <Icon name={icon} size={16} />
        </span>
        <b className="nw-stat-n">{n}</b>
      </div>
      <b className="nw-stat-label">{label}</b>
      <span className="nw-stat-sub">{sub}</span>
    </div>
  )
}

function QueueCard({
  q,
  c,
  data,
  busy,
  act,
  onBan,
  onAppeal
}: {
  q: QueueItem
  c: ConstellationDetail
  data: NightWatch
  busy: string | null
  act: (
    key: string,
    task: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>
  ) => Promise<void>
  onBan: (p: PublicUser) => void
  onAppeal: () => void
}): React.JSX.Element {
  const key = `${q.kind}:${q.id}`
  const off = busy !== null
  if (q.kind === 'report') {
    const others = q.reportCount - q.reporters.length
    const by =
      q.reporters.map((r) => r.displayName.split(/\s+/)[0]).join(', ') +
      (others > 0 ? ` and ${others} other${others === 1 ? '' : 's'}` : '')
    return (
      <article className="nw-item">
        <div className="nw-item-head">
          <span className="nw-item-icon nw-tone-red">
            <Icon name="flag" size={14} />
          </span>
          <b>Report: {reasonName(q.reason).toLowerCase()}</b>
          {q.assignedTo && (
            <span className="nw-chip">Assigned: {q.assignedTo.displayName.split(/\s+/)[0]}</span>
          )}
          <span className="nw-when">{ago(q.createdAt)}</span>
        </div>
        <span className="nw-item-meta">
          Reported by {by || 'a member'} · {handle(q.target)}
          {q.nebula ? ` in #${q.nebula.name}` : ''}
          {!q.messageLive && ' · already deleted'}
        </span>
        <blockquote className="nw-quote">{q.excerpt}</blockquote>
        <div className="nw-actions">
          {data.can.delete && data.can.timeout && q.messageLive && (
            <button
              type="button"
              className="nw-btn nw-btn--dark"
              disabled={off}
              onClick={() => void act(key, () => watch.resolve(c.id, q.id, 'delete_timeout', '1h'))}
            >
              Delete + time out 1 h
            </button>
          )}
          {data.can.delete && q.messageLive && (
            <button
              type="button"
              className="nw-btn"
              disabled={off}
              onClick={() => void act(key, () => watch.resolve(c.id, q.id, 'delete'))}
            >
              Delete only
            </button>
          )}
          {data.can.ban && q.target && (
            <button
              type="button"
              className="nw-btn"
              disabled={off}
              onClick={() => onBan(q.target!)}
            >
              Ban…
            </button>
          )}
          <button
            type="button"
            className="nw-btn"
            disabled={off}
            onClick={() => void act(key, () => watch.resolve(c.id, q.id, 'dismiss'))}
          >
            Dismiss
          </button>
          <span className="nw-spacer" />
          {!q.assignedTo && (
            <button
              type="button"
              className="nw-link"
              disabled={off}
              onClick={() => void act(key, () => watch.assign(c.id, q.id))}
            >
              Assign to me
            </button>
          )}
        </div>
      </article>
    )
  }
  if (q.kind === 'held') {
    const title =
      q.reason === 'mentions'
        ? `Mention cap: ${q.detail ?? 'many'} people in one message`
        : q.reason === 'raid'
          ? 'Held: joined during a raid'
          : q.reason === 'links'
            ? 'Link spam held for review'
            : 'AutoMod held a message'
    return (
      <article className="nw-item">
        <div className="nw-item-head">
          <span
            className={`nw-item-icon ${q.reason === 'mentions' ? 'nw-tone-purple' : 'nw-tone-rust'}`}
          >
            <Icon name={q.reason === 'mentions' ? 'at' : 'shield'} size={14} />
          </span>
          <b>{title}</b>
          <span className="nw-when">{ago(q.createdAt)}</span>
        </div>
        <span className="nw-item-meta">
          {handle(q.target)}
          {q.nebula ? ` in #${q.nebula.name}` : ''}
          {q.reason === 'word' && q.detail ? ` · blocked word “${q.detail}”` : ''} · nobody else saw
          it
        </span>
        <blockquote className="nw-quote">{q.excerpt}</blockquote>
        {data.can.delete && (
          <div className="nw-actions">
            {data.can.ban && q.target && (
              <button
                type="button"
                className="nw-btn nw-btn--dark"
                disabled={off}
                onClick={() => onBan(q.target!)}
              >
                Keep hidden + ban…
              </button>
            )}
            <button
              type="button"
              className="nw-btn"
              disabled={off}
              onClick={() => void act(key, () => watch.keepHidden(c.id, q.id))}
            >
              Keep hidden
            </button>
            <button
              type="button"
              className="nw-btn"
              disabled={off}
              onClick={() => void act(key, () => watch.letThrough(c.id, q.id))}
            >
              Let it through
            </button>
          </div>
        )}
      </article>
    )
  }
  return (
    <article className="nw-item">
      <div className="nw-item-head">
        <span className="nw-item-icon nw-tone-blue">
          <Icon name="mail" size={14} />
        </span>
        <b>Appeal from {handle(q.target)}</b>
        <span className="nw-when">{ago(q.createdAt)}</span>
      </div>
      <span className="nw-item-meta">
        Banned {ago(q.bannedAt)}
        {q.banReason ? ` · reason “${q.banReason}”` : ''}
      </span>
      <blockquote className="nw-quote nw-quote--blue">{q.excerpt}</blockquote>
      <div className="nw-actions">
        <button type="button" className="nw-btn nw-btn--dark" disabled={off} onClick={onAppeal}>
          Read + decide
        </button>
      </div>
    </article>
  )
}

function RaidStrip({
  c,
  data,
  onChanged,
  onProblem
}: {
  c: ConstellationDetail
  data: NightWatch
  onChanged: () => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [joiners, setJoiners] = useState<RaidJoiner[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [now] = useState(() => Date.now())
  const canReopen = can(c, 'manageConstellation') || can(c, 'ban')
  async function run(
    task: () => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>
  ): Promise<void> {
    setBusy(true)
    const r = await task()
    setBusy(false)
    if (!r.ok) onProblem(r.message)
    else {
      setJoiners(null)
      onChanged()
    }
  }
  return (
    <div className="nw-raid" role="status">
      <div className="nw-raid-row">
        <Icon name="lock" size={22} />
        <span>
          <b>
            Joins paused
            {data.raid.raidAt && Date.parse(data.raid.raidAt) > now - 6 * 3600_000
              ? ': possible raid'
              : ''}
          </b>
          <br />
          Joins reopen at {clock(data.raid.pausedUntil!)}.
          {data.raid.heldJoiners > 0 &&
            ` ${data.raid.heldJoiners} people who joined during it are waiting for a look.`}
        </span>
        {data.raid.heldJoiners > 0 && can(c, 'timeoutKick') && (
          <button
            type="button"
            className="nw-btn nw-btn--gold"
            disabled={busy}
            onClick={() =>
              void watch
                .raidJoiners(c.id)
                .then((r) => (r.ok ? setJoiners(r.data.joiners) : onProblem(r.message)))
            }
          >
            Review joiners
          </button>
        )}
        {canReopen && (
          <button
            type="button"
            className="nw-btn nw-btn--ghostdark"
            disabled={busy}
            onClick={() => void run(() => watch.reopenJoins(c.id))}
          >
            Reopen
          </button>
        )}
      </div>
      {joiners && (
        <div className="nw-joiners">
          {joiners.map((j) => (
            <div key={j.user.id} className="nw-joiner">
              <Face person={j.user} size={26} />
              <span>
                <b>{j.user.displayName}</b> {handle(j.user)} · account{' '}
                {ago(j.accountCreatedAt).replace(' ago', ' old')} · joined {clock(j.joinedAt)}
              </span>
            </div>
          ))}
          <div className="nw-actions">
            <button
              type="button"
              className="nw-btn nw-btn--gold"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  watch.raidKick(
                    c.id,
                    joiners.map((j) => j.user.id)
                  )
                )
              }
            >
              Kick all {joiners.length}
            </button>
            <button
              type="button"
              className="nw-btn nw-btn--ghostdark"
              disabled={busy}
              onClick={() => void run(() => watch.raidClear(c.id))}
            >
              Let them all talk
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────── 1b · Mod log ─────────────

export function ModLogPage({
  c,
  meId,
  onProblem
}: {
  c: ConstellationDetail
  meId: string
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [q, setQ] = useState<ModLogQuery>({ filter: 'all', actor: null, q: '', days: 30 })
  const [typed, setTyped] = useState('')
  const [entries, setEntries] = useState<ModLogEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    let stale = false
    void watch.log(c.id, q).then((r) => {
      if (stale) return
      if (r.ok) {
        setEntries(r.data.entries)
        setHasMore(r.data.hasMore)
      } else onProblem(r.message)
    })
    return () => {
      stale = true
    }
  }, [c.id, q, onProblem])
  const mods = c.members.filter(
    (m) =>
      m.user.id === c.ownerId ||
      (m.roleIds ?? []).some((id) =>
        c.roles.find(
          (r) =>
            r.id === id &&
            r.permissions.some((p) => ['deleteMessages', 'timeoutKick', 'ban'].includes(p))
        )
      )
  )
  async function exportCsv(): Promise<void> {
    setBusy(true)
    const r = await watch.exportLog(c.id, q)
    setBusy(false)
    if (!r.ok) return onProblem(r.message)
    const url = URL.createObjectURL(new Blob([r.data.csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${c.name.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'constellation'} mod log.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  return (
    <div className="cx-settings-body nw">
      <div className="nw-filters">
        <label className="nw-search">
          <span className="nw-sr">Search the mod log</span>
          <input
            type="search"
            placeholder="Search by member, moderator or reason"
            value={typed}
            onChange={(e) => {
              const v = e.target.value
              setTyped(v)
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(() => setQ((x) => ({ ...x, q: v })), 300)
            }}
          />
        </label>
        <select
          aria-label="Which actions"
          value={q.filter}
          onChange={(e) => setQ({ ...q, filter: e.target.value as ModLogQuery['filter'] })}
        >
          {MOD_LOG_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Who did it"
          value={q.actor ?? ''}
          onChange={(e) => setQ({ ...q, actor: e.target.value || null })}
        >
          <option value="">Every moderator</option>
          <option value="automod">AutoMod</option>
          <option value="safety">Safety</option>
          {mods.map((m) => (
            <option key={m.user.id} value={m.user.id}>
              {m.user.displayName}
            </option>
          ))}
        </select>
        <select
          aria-label="How far back"
          value={q.days}
          onChange={(e) => setQ({ ...q, days: Number(e.target.value) })}
        >
          {MOD_LOG_DAYS.map((d) => (
            <option key={d.d} value={d.d}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="nw-spacer" />
        <button
          type="button"
          className="nw-btn"
          disabled={busy || !entries?.length}
          onClick={() => void exportCsv()}
        >
          Export CSV
        </button>
      </div>
      <div className="nw-log">
        {entries === null && <p className="nw-empty">Loading…</p>}
        {entries?.length === 0 && <p className="nw-empty">Nothing matches.</p>}
        {entries?.map((e) => {
          const l = logLine(e)
          return (
            <div key={e.id} className="nw-log-row">
              <Face person={e.actor} />
              <div className="nw-log-text">
                <b>{actorName(e, meId)}</b> {l.verb}
                <b>{l.target}</b>
                {l.extra}
                {l.reason && <div className="nw-log-reason">Reason: “{l.reason}”</div>}
              </div>
              <div className="nw-log-side">
                <span className="nw-when">{at(e.createdAt)}</span>
                {e.canUndo && (
                  <button
                    type="button"
                    className="nw-btn nw-btn--small"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      const r = await watch.undo(c.id, e.id)
                      setBusy(false)
                      if (!r.ok) return onProblem(r.message)
                      setQ((x) => ({ ...x }))
                    }}
                  >
                    <Icon name="undo" size={13} /> Undo
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {hasMore && entries && (
          <button
            type="button"
            className="nw-btn nw-more"
            onClick={async () => {
              const r = await watch.log(c.id, {
                ...q,
                before: entries[entries.length - 1].createdAt
              })
              if (r.ok) {
                setEntries([...entries, ...r.data.entries])
                setHasMore(r.data.hasMore)
              }
            }}
          >
            Show older
          </button>
        )}
      </div>
      <p className="nw-note">
        Kept for 180 days. Never shows message text except what AutoMod held or a deleted message’s
        first words (only to moderators). Undo is offered when it’s still possible and you outrank
        the person.
      </p>
    </div>
  )
}

// ───────────── 1c · Bans + appeals ─────────────

export function BanFields({
  reason,
  setReason,
  appeals,
  setAppeals,
  deleteWindow,
  setDeleteWindow
}: {
  reason: string
  setReason: (r: string) => void
  appeals: BanAppeals
  setAppeals: (a: BanAppeals) => void
  deleteWindow: BanDeleteWindow
  setDeleteWindow: (w: BanDeleteWindow) => void
}): React.JSX.Element {
  return (
    <div className="nw-ban-fields">
      <label className="nw-label" htmlFor="nw-ban-reason">
        REASON (THEY SEE THIS)
      </label>
      <textarea
        id="nw-ban-reason"
        maxLength={200}
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="nw-chips">
        {QUICK_BAN_REASONS.map((r) => (
          <button key={r} type="button" className="nw-chip-btn" onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <span className="nw-label">DELETE THEIR MESSAGES FROM</span>
      <div className="nw-seg" role="radiogroup" aria-label="Delete their messages from">
        {BAN_DELETE_WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={deleteWindow === w.id}
            onClick={() => setDeleteWindow(w.id)}
          >
            {w.name}
          </button>
        ))}
      </div>
      <span className="nw-label">APPEALS</span>
      {(
        [
          ['now', 'Can appeal right away'],
          ['later', 'Can appeal after 7 days'],
          ['never', 'No appeals']
        ] as [BanAppeals, string][]
      ).map(([id, label]) => (
        <label key={id} className="nw-radio">
          <input
            type="radio"
            name="nw-appeals"
            checked={appeals === id}
            onChange={() => setAppeals(id)}
          />
          {label}
        </label>
      ))}
    </div>
  )
}

export function BanDialog({
  c,
  person,
  onClose,
  onDone,
  onProblem
}: {
  c: ConstellationDetail
  person: PublicUser
  onClose: () => void
  onDone: (detail: ConstellationDetail) => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [reason, setReason] = useState('')
  const [appeals, setAppeals] = useState<BanAppeals>('later')
  const [deleteWindow, setDeleteWindow] = useState<BanDeleteWindow>('24h')
  const [busy, setBusy] = useState(false)
  return (
    <div className="nw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="nw-ban-title" className="nw-dialog">
        <div className="nw-dialog-head">
          <Face person={person} size={40} />
          <div>
            <h2 id="nw-ban-title">Ban {person.displayName}?</h2>
            <span className="nw-item-meta">
              {handle(person)} can’t come back until they’re unbanned.
            </span>
          </div>
        </div>
        <BanFields
          reason={reason}
          setReason={setReason}
          appeals={appeals}
          setAppeals={setAppeals}
          deleteWindow={deleteWindow}
          setDeleteWindow={setDeleteWindow}
        />
        <div className="nw-actions nw-actions--end">
          <button type="button" className="nw-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nw-btn nw-btn--danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await watch.ban(c.id, person.id, {
                reason: reason.trim() || undefined,
                appeals,
                deleteWindow
              })
              setBusy(false)
              if (!r.ok) onProblem(r.message)
              else onDone(r.data.constellation)
            }}
          >
            Ban
          </button>
        </div>
      </div>
    </div>
  )
}

function AppealDialog({
  c,
  appealId,
  onClose,
  onDone,
  onProblem
}: {
  c: ConstellationDetail
  appealId: string
  onClose: () => void
  onDone: () => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [a, setA] = useState<BanAppeal | null>(null)
  useEffect(() => {
    void watch.appeals(c.id, 'open').then((r) => {
      if (!r.ok) return onProblem(r.message)
      const found = r.data.appeals.find((x) => x.id === appealId)
      if (found) setA(found)
      else onClose()
    })
  }, [c.id, appealId, onClose, onProblem])
  return (
    <div className="nw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Appeal" className="nw-dialog">
        {a ? (
          <AppealCard c={c} a={a} onDone={onDone} onProblem={onProblem} />
        ) : (
          <p className="nw-empty">Loading…</p>
        )}
      </div>
    </div>
  )
}

function AppealCard({
  c,
  a,
  onDone,
  onProblem
}: {
  c: ConstellationDetail
  a: BanAppeal
  onDone: () => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const h = a.history
  async function decide(d: 'accept' | 'deny'): Promise<void> {
    setBusy(true)
    const r = await watch.decide(c.id, a.id, d, reply)
    setBusy(false)
    if (!r.ok) onProblem(r.message)
    else onDone()
  }
  const ordinal = ['1st', '2nd', '3rd'][a.number - 1] ?? `${a.number}th`
  return (
    <div className="nw-appeal">
      <h2>Appeal from {a.user.displayName}</h2>
      <div className="nw-chips">
        <span className="nw-chip">Banned {ago(a.ban.createdAt)}</span>
        {a.ban.by && (
          <span className="nw-chip nw-chip--plain">by {a.ban.by.displayName.split(/\s+/)[0]}</span>
        )}
        <span className="nw-chip nw-chip--plain">{ordinal} appeal</span>
      </div>
      <span className="nw-item-meta">
        Ban reason: {a.ban.reason ? `“${a.ban.reason}”` : 'none given'}
      </span>
      <blockquote className="nw-quote nw-quote--blue">{a.body}</blockquote>
      <span className="nw-item-meta">
        Before the ban: {h.timeouts} time-out{h.timeouts === 1 ? '' : 's'}, {h.deleted} deleted
        message{h.deleted === 1 ? '' : 's'}, {h.held} held by AutoMod
      </span>
      {a.status === 'open' ? (
        <>
          <label className="nw-label" htmlFor={`nw-reply-${a.id}`}>
            REPLY (OPTIONAL, THEY SEE IT)
          </label>
          <textarea
            id={`nw-reply-${a.id}`}
            rows={2}
            maxLength={500}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Welcome back, spoiler tags please."
          />
          <div className="nw-actions">
            <button
              type="button"
              className="nw-btn nw-btn--primary"
              disabled={busy}
              onClick={() => void decide('accept')}
            >
              Unban
            </button>
            <button
              type="button"
              className="nw-btn"
              disabled={busy}
              onClick={() => void decide('deny')}
            >
              Keep the ban
            </button>
          </div>
          <span className="nw-note">Unban doesn’t re-add them: they get an invite to rejoin.</span>
        </>
      ) : (
        <span className="nw-chip nw-chip--plain">
          {a.status === 'accepted' ? 'Unbanned' : 'Kept the ban'}
          {a.decidedBy ? ` by ${a.decidedBy.displayName.split(/\s+/)[0]}` : ''}
          {a.reply ? ` · “${a.reply}”` : ''}
        </span>
      )}
    </div>
  )
}

export function AppealsPage({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [status, setStatus] = useState<'open' | 'all'>('open')
  const [list, setList] = useState<BanAppeal[] | null>(null)
  const load = useCallback(() => {
    void watch
      .appeals(c.id, status)
      .then((r) => (r.ok ? setList(r.data.appeals) : onProblem(r.message)))
  }, [c.id, status, onProblem])
  useEffect(load, [load])
  return (
    <div className="cx-settings-body nw">
      <div className="nw-tabs" role="tablist" aria-label="Which appeals">
        <button
          type="button"
          role="tab"
          className="nw-tab"
          aria-selected={status === 'open'}
          onClick={() => setStatus('open')}
        >
          Waiting
        </button>
        <button
          type="button"
          role="tab"
          className="nw-tab"
          aria-selected={status === 'all'}
          onClick={() => setStatus('all')}
        >
          All
        </button>
      </div>
      {list?.length === 0 && (
        <p className="nw-empty">No appeals {status === 'open' ? 'waiting' : 'yet'}.</p>
      )}
      <div className="nw-appeals">
        {list?.map((a) => (
          <div key={a.id} className="nw-item">
            <AppealCard c={c} a={a} onDone={load} onProblem={onProblem} />
          </div>
        ))}
      </div>
      <p className="nw-note">
        Banned people can appeal from the Constellations dashboard, once per ban (again 30 days
        after a “no”). You see their name and their message only.
      </p>
    </div>
  )
}

// ───────────── 1d · Safety ─────────────

export function SafetyPage({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [s, setS] = useState<SafetySettings | null>(null)
  const [canChange, setCanChange] = useState(false)
  useEffect(() => {
    void watch.safety(c.id).then((r) => {
      if (!r.ok) return onProblem(r.message)
      setS(r.data.safety)
      setCanChange(r.data.canChange)
    })
  }, [c.id, onProblem])
  async function save(changes: Partial<SafetySettings>): Promise<void> {
    if (!s) return
    setS({ ...s, ...changes })
    const r = await watch.setSafety(c.id, changes)
    if (!r.ok) onProblem(r.message)
    else setS(r.data.safety)
  }
  if (!s)
    return (
      <div className="cx-settings-body">
        <p className="cx-settings-text">Loading…</p>
      </div>
    )
  const off = !canChange
  const pickable = c.roles.filter((r) => r.kind !== 'owner' && r.kind !== 'member')
  return (
    <div className="cx-settings-body nw">
      {!canChange && (
        <p className="nw-note">Only people who can edit constellation settings can change these.</p>
      )}
      <div className="nw-safety">
        <section className="nw-card">
          <div className="nw-card-head">
            <b>Verification level</b>
            <span className="nw-item-meta">Who can post or react</span>
          </div>
          {VERIFICATION_LEVELS.map((l) => (
            <label
              key={l.id}
              className={`nw-level${s.verification === l.id ? ' nw-level--on' : ''}`}
            >
              <input
                type="radio"
                name="nw-level"
                checked={s.verification === l.id}
                disabled={off}
                onChange={() => void save({ verification: l.id })}
              />
              <span>
                <b>{l.name}</b>
                <span>{l.what}</span>
              </span>
            </label>
          ))}
          {pickable.length > 0 && (
            <fieldset className="nw-skip" disabled={off}>
              <legend>Roles that skip it</legend>
              {pickable.map((r) => (
                <label key={r.id} className="nw-check">
                  <input
                    type="checkbox"
                    checked={s.verificationSkipRoles.includes(r.id)}
                    onChange={(e) =>
                      void save({
                        verificationSkipRoles: e.target.checked
                          ? [...s.verificationSkipRoles, r.id]
                          : s.verificationSkipRoles.filter((x) => x !== r.id)
                      })
                    }
                  />
                  {r.name}
                </label>
              ))}
            </fieldset>
          )}
          <span className="nw-note">
            People who don’t meet it can read, and see “Confirm your email to chat” or when they
            can. Moderators always can.
          </span>
        </section>
        <div className="nw-safety-right">
          <section className="nw-card">
            <div className="nw-card-head">
              <b>Raid protection</b>
              <Toggle
                on={s.raidOn}
                label="Raid protection"
                disabled={off}
                onChange={(v) => void save({ raidOn: v })}
              />
            </div>
            <span className="nw-item-meta">
              When many new accounts join at once, Glofly pauses joins and tells moderators.
            </span>
            <div className="nw-sentence">
              Pause joins after
              <select
                aria-label="Joins"
                disabled={off || !s.raidOn}
                value={s.raidJoins}
                onChange={(e) => void save({ raidJoins: Number(e.target.value) })}
              >
                {RAID_JOINS_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n} joins
                  </option>
                ))}
              </select>
              in
              <select
                aria-label="Within"
                disabled={off || !s.raidOn}
                value={s.raidSeconds}
                onChange={(e) => void save({ raidSeconds: Number(e.target.value) })}
              >
                {RAID_SECONDS_CHOICES.map((o) => (
                  <option key={o.s} value={o.s}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="nw-sentence">
              counting only accounts younger than
              <select
                aria-label="Account age"
                disabled={off || !s.raidOn}
                value={s.raidAccountDays}
                onChange={(e) => void save({ raidAccountDays: Number(e.target.value) })}
              >
                {RAID_ACCOUNT_DAYS_CHOICES.map((o) => (
                  <option key={o.d} value={o.d}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="nw-sentence">
              Keep joins paused for
              <select
                aria-label="Pause length"
                disabled={off || !s.raidOn}
                value={s.raidPauseMinutes}
                onChange={(e) => void save({ raidPauseMinutes: Number(e.target.value) })}
              >
                {RAID_PAUSE_CHOICES.map((o) => (
                  <option key={o.m} value={o.m}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="nw-switch-row">
              <Toggle
                on={s.raidHold}
                label="Hold raid joiners' messages"
                disabled={off || !s.raidOn}
                onChange={(v) => void save({ raidHold: v })}
              />
              Hold messages from people who joined during the raid until a moderator looks
            </div>
            <div className="nw-switch-row">
              <Toggle
                on={s.raidAlert}
                label="Push alert to moderators"
                disabled={off || !s.raidOn}
                onChange={(v) => void save({ raidAlert: v })}
              />
              Push alert to moderators
            </div>
            <PauseNow c={c} onProblem={onProblem} />
          </section>
          <section className="nw-card">
            <div className="nw-card-head">
              <b>Mention cap (AutoMod)</b>
              <Toggle
                on={s.mentionCapOn}
                label="Mention cap"
                disabled={off}
                onChange={(v) => void save({ mentionCapOn: v })}
              />
            </div>
            <div className="nw-sentence">
              Block messages that mention more than
              <select
                aria-label="Most mentions"
                disabled={off || !s.mentionCapOn}
                value={s.mentionCap}
                onChange={(e) => void save({ mentionCap: Number(e.target.value) })}
              >
                {MENTION_CAP_CHOICES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              people or roles
            </div>
            <div className="nw-sentence">
              and then
              <select
                aria-label="Then"
                disabled={off || !s.mentionCapOn}
                value={s.mentionCapAction}
                onChange={(e) =>
                  void save({
                    mentionCapAction: e.target.value as SafetySettings['mentionCapAction']
                  })
                }
              >
                {MENTION_CAP_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <span className="nw-note">
              @everyone and @here count as one. Moderators and up are never capped.
            </span>
          </section>
        </div>
      </div>
    </div>
  )
}

function PauseNow({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (m: string) => void
}): React.JSX.Element | null {
  const [minutes, setMinutes] = useState(30)
  const [busy, setBusy] = useState(false)
  if (!can(c, 'manageConstellation') && !can(c, 'ban')) return null
  const paused = c.watch?.pausedUntil
  return (
    <div className="nw-sentence nw-pause">
      {paused ? (
        <>
          Joins are paused until {clock(paused)}.
          <button
            type="button"
            className="nw-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await watch.reopenJoins(c.id)
              setBusy(false)
              if (!r.ok) onProblem(r.message)
            }}
          >
            Reopen now
          </button>
        </>
      ) : (
        <>
          Pause joins myself for
          <select
            aria-label="Pause for"
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            {RAID_PAUSE_CHOICES.map((o) => (
              <option key={o.m} value={o.m}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="nw-btn"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              const r = await watch.pauseJoins(c.id, minutes)
              setBusy(false)
              if (!r.ok) onProblem(r.message)
            }}
          >
            Pause
          </button>
        </>
      )}
    </div>
  )
}

function Toggle({
  on,
  label,
  disabled,
  onChange
}: {
  on: boolean
  label: string
  disabled?: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={on ? 'am-switch am-switch--on' : 'am-switch'}
      onClick={() => onChange(!on)}
    >
      <span className="am-knob" />
    </button>
  )
}

// ───────────── In the constellation: the joins-paused banner (moderators) ─────────────

export function RaidBanner({
  c,
  onOpen
}: {
  c: ConstellationDetail
  onOpen: () => void
}): React.JSX.Element | null {
  const until = c.watch?.pausedUntil
  const [ended, setEnded] = useState<string | null>(null)
  useEffect(() => {
    if (!until) return
    const t = setTimeout(
      () => setEnded(until),
      Math.max(1000, Date.parse(until) - Date.now() + 500)
    )
    return () => clearTimeout(t)
  }, [until])
  if (!until || ended === until) return null
  return (
    <div className="nw-banner" role="status">
      <Icon name="lock" size={18} />
      <span>
        <b>Joins paused.</b> They reopen at {clock(until)}.
      </span>
      <button type="button" className="nw-btn nw-btn--gold nw-btn--small" onClick={onOpen}>
        Night watch
      </button>
    </div>
  )
}

// ───────────── Constellations dashboard: Your bans + appeal (board 1c, middle) ─────────────

export function YourBans(): React.JSX.Element | null {
  const [bans, setBans] = useState<MyBan[]>([])
  const [now, setNow] = useState(0)
  const [writing, setWriting] = useState<MyBan | null>(null)
  const load = useCallback(() => {
    void watch.myBans().then((r) => {
      if (!r.ok) return
      setBans(r.data.bans)
      setNow(Date.now())
    })
  }, [])
  useEffect(() => {
    load()
    return window.glofly.onEvent((e) => {
      if (
        e.type === 'constellation:appeal' ||
        (e.type === 'constellation:removed' && e.reason === 'banned')
      )
        load()
    })
  }, [load])
  if (!bans.length) return null
  return (
    <section className="nw-bans" aria-label="Your bans">
      <h2>Your bans</h2>
      {bans.map((b) => {
        const can = b.appealFrom && Date.parse(b.appealFrom) <= now && b.appeal?.status !== 'open'
        return (
          <div key={b.constellation.id} className="nw-ban">
            <div>
              <b>You were banned from {b.constellation.name}</b>
              <span>
                {ago(b.createdAt)}
                {b.reason ? ` · Reason: “${b.reason}”` : ''}
              </span>
              <span>
                {b.appeal?.status === 'open'
                  ? 'Your appeal is with the moderators.'
                  : b.appeal?.status === 'denied'
                    ? `They kept the ban${b.appeal.reply ? `: “${b.appeal.reply}”` : '.'}`
                    : b.appealFrom === null
                      ? 'This ban can’t be appealed.'
                      : can
                        ? 'You can ask the moderators to reconsider.'
                        : `You can ask the moderators to reconsider from ${new Date(b.appealFrom).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`}
              </span>
            </div>
            {can && (
              <button type="button" className="nw-btn nw-btn--gold" onClick={() => setWriting(b)}>
                Appeal
              </button>
            )}
          </div>
        )
      })}
      {writing && (
        <WriteAppeal
          ban={writing}
          onClose={() => setWriting(null)}
          onSent={() => {
            setWriting(null)
            load()
          }}
        />
      )}
    </section>
  )
}

function WriteAppeal({
  ban,
  onClose,
  onSent
}: {
  ban: MyBan
  onClose: () => void
  onSent: () => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="nw-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="nw-appeal-title"
        className="nw-dialog nw-dialog--night"
      >
        <h2 id="nw-appeal-title">Appeal your ban from {ban.constellation.name}</h2>
        {ban.reason && <p className="nw-night-quote">Reason: “{ban.reason}”</p>}
        <label className="nw-label" htmlFor="nw-appeal-text">
          YOUR APPEAL
        </label>
        <textarea
          id="nw-appeal-text"
          rows={4}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span className="nw-note">
          One appeal per ban (another 30 days after a “no”). Moderators see your name and this
          message only.
        </span>
        {error && <p className="cx-error">{error}</p>}
        <div className="nw-actions nw-actions--end">
          <button type="button" className="nw-btn nw-btn--ghostdark" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nw-btn nw-btn--gold"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true)
              const r = await watch.appeal(ban.constellation.id, text)
              setBusy(false)
              if (!r.ok) setError(r.message)
              else onSent()
            }}
          >
            Send appeal
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────── Reporting a nebula message (moderators + the Glofly team) ─────────────

export const REPORT_TO_MODS_NOTE =
  'The moderators of this constellation and the Glofly team will see it.'

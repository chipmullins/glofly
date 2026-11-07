import { useEffect, useState } from 'react'
import type {
  ConstellationDetail,
  MuteDuration,
  Nebula,
  NotifyLevel
} from '../../../preload/api-types'
import { MUTE_CHOICES, mutedLabel } from '../lib/mentions'
import { api } from '../lib/constellations'
import { ConstellationIcon } from './bits'
import './Integrations.css'
import './NotifySettings.css'

// Communities round 4.2 (approved board 23): a constellation's notification window. Only you see
// these. Opened from the constellation's menu and from a nebula's bell.

const LEVELS: { level: NotifyLevel; name: string; what: string }[] = [
  { level: 'all', name: 'All messages', what: 'Every message in nebulas you can see' },
  {
    level: 'mentions',
    name: 'Only @mentions',
    what: 'When someone mentions you, @everyone or a role you have (recommended for big constellations)'
  },
  { level: 'none', name: 'Nothing', what: 'Only badges you open yourself' }
]
export const LEVEL_NAMES: Record<NotifyLevel, string> = {
  all: 'All messages',
  mentions: 'Only @mentions',
  none: 'Nothing'
}

function Switch({
  on,
  label,
  onChange
}: {
  on: boolean
  label: string
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? 'am-switch am-switch--on' : 'am-switch'}
      onClick={() => onChange(!on)}
    >
      <span className="am-knob" />
    </button>
  )
}

/** A nebula's name with its kind's mark (star charts get the speech bubbles). */
function NebulaName({ n }: { n: Nebula }): React.JSX.Element {
  return (
    <span className="nf-nebula-name">
      <span
        className={n.kind === 'forum' ? 'nf-mark nf-mark--chart' : 'nf-mark'}
        aria-hidden="true"
      >
        {n.kind === 'forum' ? '💬' : n.kind === 'voice' ? '🔊' : '✦'}
      </span>
      {n.name}
      {n.kind === 'forum' && <span className="nf-kind"> (star chart)</span>}
    </span>
  )
}

export default function NotifySettings({
  c,
  onClose,
  onChanged,
  onProblem
}: {
  c: ConstellationDetail
  onClose: () => void
  /** Something was saved: reload the constellation */
  onChanged: () => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const saved = c.me.notifications ?? {
    mutedUntil: null,
    ignoreEveryone: false,
    ignoreRoles: false,
    followAlerts: true
  }
  // Shown right away; the server's copy follows (onChanged reloads it).
  const [level, setLevel] = useState<NotifyLevel>(c.me.notify)
  const [mutedUntil, setMutedUntil] = useState<string | null>(saved.mutedUntil)
  const [ignoreEveryone, setIgnoreEveryone] = useState(saved.ignoreEveryone)
  const [ignoreRoles, setIgnoreRoles] = useState(saved.ignoreRoles)
  const [followAlerts, setFollowAlerts] = useState(saved.followAlerts)
  const [overrides, setOverrides] = useState<Record<string, NotifyLevel | null>>(() =>
    Object.fromEntries(c.nebulas.map((n) => [n.id, n.notify]))
  )
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])

  async function save(
    body: Parameters<typeof api.notifySettings>[1],
    undo: () => void
  ): Promise<void> {
    const r = await api.notifySettings(c.id, body)
    if (!r.ok) {
      undo()
      onProblem(r.message)
    } else onChanged()
  }

  async function setNebula(n: Nebula, next: NotifyLevel | null): Promise<void> {
    const before = overrides[n.id] ?? null
    setOverrides((o) => ({ ...o, [n.id]: next }))
    const r = await api.nebulaNotify(c.id, n.id, next)
    if (!r.ok) {
      setOverrides((o) => ({ ...o, [n.id]: before }))
      onProblem(r.message)
    } else onChanged()
  }

  const differing = c.nebulas.filter((n) => n.kind !== 'voice' && overrides[n.id])
  const others = c.nebulas.filter((n) => n.kind !== 'voice' && !overrides[n.id])
  const muted = !!mutedUntil && new Date(mutedUntil).getTime() > Date.now()

  return (
    <div className="ix-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="nf-title" className="ix-sheet nf-sheet">
        <header className="nf-head">
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color}
            iconVersion={c.iconVersion}
            className="nf-icon"
          />
          <div className="nf-head-text">
            <h2 id="nf-title">Notifications</h2>
            <p>{c.name} · only you see these</p>
          </div>
          <button type="button" className="nf-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className={muted ? 'nf-mute nf-mute--on' : 'nf-mute'}>
          <span className="nf-mute-icon" aria-hidden="true">
            🔕
          </span>
          <div className="nf-mute-text">
            <b>Mute {c.name}</b>
            <span>
              {muted
                ? `${mutedLabel(mutedUntil!)}. @mentions of you still get through.`
                : 'No sounds, pop-ups or badges. @mentions of you still get through.'}
            </span>
          </div>
          <label className="nf-select">
            <span className="sr-only">Mute {c.name}</span>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value as MuteDuration | 'off' | ''
                if (!v) return
                const before = mutedUntil
                if (v === 'off') {
                  setMutedUntil(null)
                  void save({ mute: null }, () => setMutedUntil(before))
                } else {
                  setMutedUntil(
                    v === 'forever'
                      ? '2100-01-01T00:00:00.000Z'
                      : new Date(
                          Date.now() + { '1h': 1, '8h': 8, '24h': 24 }[v] * 3_600_000
                        ).toISOString()
                  )
                  void save({ mute: v }, () => setMutedUntil(before))
                }
              }}
            >
              <option value="" disabled hidden>
                {muted ? 'Muted' : 'Not muted'}
              </option>
              {muted && <option value="off">Unmute</option>}
              {MUTE_CHOICES.map((m) => (
                <option key={m.duration} value={m.duration}>
                  {m.duration === 'forever' ? 'Until I turn it on' : m.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <h3 className="nf-sub">Notify me about</h3>
        <div className="nf-levels" role="radiogroup" aria-label="Notify me about">
          {LEVELS.map((l) => (
            <button
              key={l.level}
              type="button"
              role="radio"
              aria-checked={level === l.level}
              className={level === l.level ? 'nf-level nf-level--on' : 'nf-level'}
              onClick={() => {
                if (level === l.level) return
                const before = level
                setLevel(l.level)
                void save({ level: l.level }, () => setLevel(before))
              }}
            >
              <span className="nf-radio" aria-hidden="true" />
              <span>
                <b>{l.name}</b>
                <span>{l.what}</span>
              </span>
            </button>
          ))}
        </div>

        <h3 className="nf-sub">Mentions</h3>
        <div className="nf-row">
          <span>
            <b>Ignore @everyone and @here</b>
            <span>They show in the chat but don’t notify you</span>
          </span>
          <Switch
            on={ignoreEveryone}
            label="Ignore @everyone and @here"
            onChange={(on) => {
              setIgnoreEveryone(on)
              void save({ ignoreEveryone: on }, () => setIgnoreEveryone(!on))
            }}
          />
        </div>
        <div className="nf-row">
          <span>
            <b>Ignore role mentions</b>
            <span>
              {(() => {
                const names = c.roles
                  .filter((r) => r.kind !== 'member' && r.mentionable)
                  .slice(0, 2)
                  .map((r) => `@${r.name}`)
                return names.length
                  ? `${names.join(', ')}… don’t notify you`
                  : 'Mentions of your roles don’t notify you'
              })()}
            </span>
          </span>
          <Switch
            on={ignoreRoles}
            label="Ignore role mentions"
            onChange={(on) => {
              setIgnoreRoles(on)
              void save({ ignoreRoles: on }, () => setIgnoreRoles(!on))
            }}
          />
        </div>
        <div className="nf-row">
          <span>
            <b>Trails and signals I follow</b>
            <span>New replies notify me (by the setting above)</span>
          </span>
          <Switch
            on={followAlerts}
            label="Trails and signals I follow"
            onChange={(on) => {
              setFollowAlerts(on)
              void save({ followAlerts: on }, () => setFollowAlerts(!on))
            }}
          />
        </div>

        <h3 className="nf-sub">Nebulas that differ</h3>
        <ul className="nf-nebulas">
          {differing.map((n) => (
            <li key={n.id}>
              <NebulaName n={n} />
              <label className="nf-select">
                <span className="sr-only">{n.name}</span>
                <select
                  value={overrides[n.id] ?? ''}
                  onChange={(e) => void setNebula(n, e.target.value as NotifyLevel)}
                >
                  {LEVELS.map((l) => (
                    <option key={l.level} value={l.level}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="nf-remove"
                aria-label={`Use ${c.name}’s setting for ${n.name}`}
                title={`Use ${c.name}’s setting`}
                onClick={() => void setNebula(n, null)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {!differing.length && <p className="nf-empty">Every nebula follows the setting above.</p>}
        {others.length > 0 &&
          (picking ? (
            <label className="nf-select nf-pick">
              <span className="sr-only">Pick a nebula</span>
              <select
                autoFocus
                value=""
                onBlur={() => setPicking(false)}
                onChange={(e) => {
                  const n = c.nebulas.find((x) => x.id === e.target.value)
                  setPicking(false)
                  // Starts as the opposite of the constellation's choice (most people pick a
                  // nebula to hear more, or less, of it).
                  if (n) void setNebula(n, level === 'all' ? 'mentions' : 'all')
                }}
              >
                <option value="" disabled>
                  Pick a nebula…
                </option>
                {others.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.kind === 'forum' ? `${n.name} (star chart)` : n.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <button type="button" className="nf-add" onClick={() => setPicking(true)}>
              + Pick a nebula
            </button>
          ))}

        <div className="nf-foot">
          <button type="button" className="ix-btn ix-btn--gold nf-done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

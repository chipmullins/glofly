import { useCallback, useEffect, useState } from 'react'
import {
  alertSiteName,
  DEFAULT_LIVE_MESSAGE,
  DEFAULT_VIDEO_MESSAGE,
  LIVE_ALERT_MESSAGE_MAX,
  type AlertSite,
  type ApiResult,
  type ConstellationDetail,
  type LiveAlert
} from '@glofly/shared'
import ConfirmDialog from '../components/ConfirmDialog'
import { Sheet } from './IntegrationsPage'
import { can } from '../lib/constellations'
import './Integrations.css'
import './LiveAlerts.css'

// 0.9.3 Constellation settings → Live alerts (approved board 4): post in a nebula when a Twitch or
// Kick channel goes live or a YouTube channel posts. No bot needed. The server checks everything
// again (this constellation's nebulas and roles; only pings you're allowed to make).

type Sites = { twitch: boolean; kick: boolean; youtube: boolean; youtubeHandles: boolean }
type Members = { nebulaId: string; ping: string | null; message: string } | null
type View = { alerts: LiveAlert[]; members: Members; sites: Sites; canPingEveryone: boolean }

const call = <T,>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

const LOOK: Record<AlertSite, { short: string; color: string }> = {
  twitch: { short: 'TW', color: '#6f3fd1' },
  kick: { short: 'KI', color: '#1f7a3a' },
  youtube: { short: 'YT', color: '#c4302b' }
}

function agoText(iso: string | null): string {
  if (!iso) return 'no alerts yet'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 3600) return `last alert ${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86_400) return `last alert ${Math.floor(s / 3600)} h ago`
  const d = Math.floor(s / 86_400)
  return d === 1 ? 'last alert yesterday' : `last alert ${d} days ago`
}

function PingSelect({
  c,
  value,
  onChange,
  canEveryone
}: {
  c: ConstellationDetail
  value: string | null
  onChange: (v: string | null) => void
  canEveryone: boolean
}): React.JSX.Element {
  const roles = c.roles.filter(
    (r) => r.kind !== 'owner' && r.kind !== 'member' && (canEveryone || r.mentionable)
  )
  return (
    <label className="ix-field">
      Ping
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">No ping</option>
        {canEveryone && <option value="everyone">@everyone</option>}
        {canEveryone && <option value="here">@here</option>}
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            @{r.name}
          </option>
        ))}
        {/* A ping set up by someone else that this person couldn't pick themselves stays shown. */}
        {value &&
          value !== 'everyone' &&
          value !== 'here' &&
          !roles.some((r) => r.id === value) && (
            <option value={value}>@{c.roles.find((r) => r.id === value)?.name ?? 'a role'}</option>
          )}
        {(value === 'everyone' || value === 'here') && !canEveryone && (
          <option value={value}>@{value}</option>
        )}
      </select>
    </label>
  )
}

function NebulaPick({
  c,
  value,
  onChange,
  kind,
  label,
  none
}: {
  c: ConstellationDetail
  value: string | null
  onChange: (v: string | null) => void
  kind: 'text' | 'voice'
  label: string
  none?: string
}): React.JSX.Element {
  return (
    <label className="ix-field">
      {label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        {none && <option value="">{none}</option>}
        {c.nebulas
          .filter((n) => n.kind === kind)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {kind === 'text' ? `#${n.name}` : n.name}
            </option>
          ))}
      </select>
    </label>
  )
}

/** Add a channel, or edit one. */
function AlertSheet({
  c,
  view,
  editing,
  onClose,
  onSaved
}: {
  c: ConstellationDetail
  view: View
  editing: LiveAlert | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const firstText = c.nebulas.find((n) => n.kind === 'text')?.id ?? ''
  const firstVoice = c.nebulas.find((n) => n.kind === 'voice')?.id ?? null
  const [site, setSite] = useState<AlertSite>(
    editing?.site ?? (view.sites.twitch ? 'twitch' : view.sites.kick ? 'kick' : 'youtube')
  )
  const [channel, setChannel] = useState('')
  const [nebulaId, setNebulaId] = useState(editing?.nebulaId ?? firstText)
  const [ping, setPing] = useState<string | null>(editing?.ping ?? null)
  const [message, setMessage] = useState(editing?.message ?? '')
  const [watchNebulaId, setWatch] = useState<string | null>(
    editing ? editing.watchNebulaId : firstVoice
  )
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const isVideo = site === 'youtube'
  const placeholder =
    site === 'twitch'
      ? 'twitch.tv/mayaplays'
      : site === 'kick'
        ? 'kick.com/mayaplays'
        : view.sites.youtubeHandles
          ? 'youtube.com/@NightRaidersTV'
          : 'youtube.com/channel/UC…'

  const save = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    const r = editing
      ? await call('PATCH', `/constellations/${c.id}/live-alerts/${editing.id}`, {
          nebulaId,
          ping,
          message,
          ...(isVideo ? {} : { watchNebulaId })
        })
      : await call('POST', `/constellations/${c.id}/live-alerts`, {
          site,
          channel,
          nebulaId,
          ping,
          message,
          watchNebulaId: isVideo ? null : watchNebulaId
        })
    setBusy(false)
    if (r.ok) onSaved()
    else setProblem(r.message)
  }

  return (
    <Sheet
      title={editing ? `${editing.channelName} on ${alertSiteName(editing.site)}` : 'Add a channel'}
      onClose={onClose}
    >
      {!editing && (
        <div className="la-sites" role="radiogroup" aria-label="Site">
          {(['twitch', 'kick', 'youtube'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={site === s}
              disabled={!view.sites[s]}
              title={
                view.sites[s] ? undefined : `${alertSiteName(s)} isn't set up on this server yet`
              }
              className={site === s ? 'la-site la-site--on' : 'la-site'}
              onClick={() => setSite(s)}
            >
              {alertSiteName(s)}
            </button>
          ))}
        </div>
      )}
      {!editing && (
        <label className="ix-field">
          {alertSiteName(site)} channel
          <input
            autoFocus
            value={channel}
            placeholder={placeholder}
            maxLength={200}
            spellCheck={false}
            onChange={(e) => setChannel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && channel.trim() && void save()}
          />
        </label>
      )}
      <div className="ix-grid2">
        <NebulaPick
          c={c}
          kind="text"
          label="Post in"
          value={nebulaId}
          onChange={(v) => setNebulaId(v ?? firstText)}
        />
        <PingSelect c={c} value={ping} onChange={setPing} canEveryone={view.canPingEveryone} />
      </div>
      <label className="ix-field">
        Message
        <input
          value={message}
          maxLength={LIVE_ALERT_MESSAGE_MAX}
          placeholder={isVideo ? DEFAULT_VIDEO_MESSAGE : DEFAULT_LIVE_MESSAGE}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <span className="ix-muted">
        {'{streamer}'}, {'{title}'} and {'{game}'} are filled in. The link always comes last.
      </span>
      {!isVideo && (
        <NebulaPick
          c={c}
          kind="voice"
          label={'Offer "Watch together" in'}
          none="Don't offer it"
          value={watchNebulaId}
          onChange={setWatch}
        />
      )}
      {problem && <p className="cx-error">{problem}</p>}
      <div className="ix-actions">
        <button type="button" className="ix-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ix-btn ix-btn--gold"
          disabled={busy || !nebulaId || (!editing && channel.trim().length < 2)}
          onClick={() => void save()}
        >
          {editing ? 'Save' : busy ? 'Finding it…' : 'Add'}
        </button>
      </div>
    </Sheet>
  )
}

function MembersSheet({
  c,
  view,
  onClose,
  onSaved
}: {
  c: ConstellationDetail
  view: View
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const firstText = c.nebulas.find((n) => n.kind === 'text')?.id ?? ''
  const [nebulaId, setNebulaId] = useState(view.members?.nebulaId ?? firstText)
  const [ping, setPing] = useState<string | null>(view.members?.ping ?? null)
  const [message, setMessage] = useState(view.members?.message ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const save = async (body: unknown): Promise<void> => {
    setBusy(true)
    const r = await call('PUT', `/constellations/${c.id}/live-alerts/members`, body)
    setBusy(false)
    if (r.ok) onSaved()
    else setProblem(r.message)
  }
  return (
    <Sheet title="Members' streams" onClose={onClose}>
      <p className="ix-text">
        Members who linked Twitch or Kick in Settings → Connections and turned on &quot;Also post in
        my constellations&quot; get an alert here when they go live.
      </p>
      <div className="ix-grid2">
        <NebulaPick
          c={c}
          kind="text"
          label="Post in"
          value={nebulaId}
          onChange={(v) => setNebulaId(v ?? firstText)}
        />
        <PingSelect c={c} value={ping} onChange={setPing} canEveryone={view.canPingEveryone} />
      </div>
      <label className="ix-field">
        Message
        <input
          value={message}
          maxLength={LIVE_ALERT_MESSAGE_MAX}
          placeholder={DEFAULT_LIVE_MESSAGE}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      {problem && <p className="cx-error">{problem}</p>}
      <div className="ix-actions">
        {view.members && (
          <button
            type="button"
            className="ix-btn ix-btn--danger"
            disabled={busy}
            onClick={() => void save({ off: true })}
          >
            Turn off
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="ix-btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="ix-btn ix-btn--gold"
          disabled={busy || !nebulaId}
          onClick={() => void save({ nebulaId, ping, message })}
        >
          {view.members ? 'Save' : 'Turn on'}
        </button>
      </div>
    </Sheet>
  )
}

export default function LiveAlertsPage({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [view, setView] = useState<View | null>(null)
  const [sheet, setSheet] = useState<'add' | 'members' | LiveAlert | null>(null)
  const [removing, setRemoving] = useState<LiveAlert | null>(null)
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => {
    void call<View>('GET', `/constellations/${c.id}/live-alerts`).then((r) => {
      if (r.ok) setView(r.data)
      else onProblem(r.message)
    })
  }, [c.id, onProblem])
  useEffect(load, [load])
  const nebulaName = (id: string): string => c.nebulas.find((n) => n.id === id)?.name ?? 'a nebula'
  const pingName = (p: string | null): string =>
    !p
      ? 'no ping'
      : p === 'everyone' || p === 'here'
        ? `pings @${p}`
        : `pings @${c.roles.find((r) => r.id === p)?.name ?? 'a role'}`
  const manage = can(c, 'manageConstellation')

  return (
    <div className="cx-settings-body la">
      <div className="la-top">
        <p className="ix-text">
          Post in a nebula when a streamer goes live on Twitch or Kick, or a channel posts on
          YouTube. No bot needed.
        </p>
        {manage && (
          <button
            type="button"
            className="ix-btn ix-btn--gold"
            disabled={!view || !c.nebulas.some((n) => n.kind === 'text')}
            onClick={() => setSheet('add')}
          >
            + Add a channel
          </button>
        )}
      </div>
      {!view && <p className="ix-muted">Loading…</p>}
      {view && view.alerts.length === 0 && (
        <p className="ix-empty">
          No channels yet. Add a Twitch, Kick or YouTube channel and its alerts show up in the
          nebula you pick.
        </p>
      )}
      {view?.alerts.map((a) => (
        <div key={a.id} className="ix-card la-card">
          <span className="la-badge" style={{ background: LOOK[a.site].color }} aria-hidden="true">
            {LOOK[a.site].short}
          </span>
          <span className="la-card-main">
            <b>
              {a.channelName} on {alertSiteName(a.site)}
            </b>
            <span className="ix-muted">
              {a.site === 'youtube' ? 'New videos and premieres' : 'Goes live'} ·{' '}
              {agoText(a.lastAlertAt)}
            </span>
          </span>
          <span className="la-card-where">
            <b>#{nebulaName(a.nebulaId)}</b>
            <span className="ix-muted">{pingName(a.ping)}</span>
          </span>
          <button type="button" className="ix-btn ix-btn--small" onClick={() => setSheet(a)}>
            Edit
          </button>
          <button
            type="button"
            className="ix-btn ix-btn--small ix-btn--danger"
            onClick={() => setRemoving(a)}
          >
            Remove
          </button>
        </div>
      ))}
      {view && (
        <div className="ix-card la-card">
          <span className="la-badge la-badge--members" aria-hidden="true">
            ★
          </span>
          <span className="la-card-main">
            <b>Members&apos; streams</b>
            <span className="ix-muted">
              {view.members
                ? `On · in #${nebulaName(view.members.nebulaId)} · ${pingName(view.members.ping)}`
                : 'Off · members who link Twitch or Kick can post their own alerts here'}
            </span>
          </span>
          <button
            type="button"
            className="ix-btn ix-btn--small"
            onClick={() => setSheet('members')}
          >
            {view.members ? 'Edit' : 'Set up'}
          </button>
        </div>
      )}
      {view && sheet === 'members' && (
        <MembersSheet
          c={c}
          view={view}
          onClose={() => setSheet(null)}
          onSaved={() => (setSheet(null), load())}
        />
      )}
      {view && sheet && sheet !== 'members' && (
        <AlertSheet
          c={c}
          view={view}
          editing={sheet === 'add' ? null : sheet}
          onClose={() => setSheet(null)}
          onSaved={() => (setSheet(null), load())}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Stop following ${removing.channelName}?`}
          message={`No more ${alertSiteName(removing.site)} alerts for this channel. Alerts already posted stay.`}
          confirmLabel="Remove"
          danger
          busy={busy}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            setBusy(true)
            void call('DELETE', `/constellations/${c.id}/live-alerts/${removing.id}`).then((r) => {
              setBusy(false)
              setRemoving(null)
              if (r.ok) load()
              else onProblem(r.message)
            })
          }}
        />
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DISCORD_PAIRS_MAX,
  DISCORD_VOICE_PAIRS_MAX,
  newNebulaName,
  type DiscordBridgeInfo,
  type DiscordBridgeSettings
} from '@glofly/shared/discord'
import type { ApiResult, ConstellationDetail } from '../../../preload/api-types'
import { can } from '../lib/constellations'
import DiscordSetup from './DiscordSetup'
import './DiscordBridge.css'

// Constellation settings → Discord bridge. Owner or "Edit constellation settings" (like Integrations).
// Communities round 2 (board 5a) made the bot, the pairs and the switches. Nov 28 (approved canvas
// "Glofly Discord bridge setup"): after the bot is added, a setup dialog pairs channels (DiscordSetup);
// this page shows Discord's channels beside Glofly's nebulas, with "+ New #name" right on a row
// (an ordinary nebula in the matching category), and voice channels (who's in voice, no sound).

const call = <T,>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

const TOGGLES: { key: keyof DiscordBridgeSettings; label: string }[] = [
  { key: 'edits', label: 'Edits and deletes' },
  { key: 'files', label: 'Pictures and files (up to 25 MB)' },
  { key: 'names', label: 'Discord nicknames + avatars in Glofly' },
  { key: 'everyone', label: '@everyone / @here pings from Discord' }
]

type Channel = { id: string; name: string; parent: string | null }

export default function DiscordBridgePage({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<DiscordBridgeInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [setup, setSetup] = useState(false)
  const base = `/constellations/${c.id}/discord`
  const load = useCallback(
    () =>
      void call<DiscordBridgeInfo>('GET', base).then((r) => {
        if (r.ok) setInfo(r.data)
        else onProblem(r.message)
      }),
    [base, onProblem]
  )
  useEffect(load, [load])
  // After "Add to Discord" opens Discord, look again every few seconds for a while.
  useEffect(() => {
    if (!waiting || info?.bridge) return
    const t = setInterval(load, 4000)
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000)
    return () => {
      clearInterval(t)
      clearTimeout(stop)
    }
  }, [waiting, info?.bridge, load])
  // The bot just joined: open the setup dialog so channels get paired (nothing crosses until then).
  const opened = useRef(false)
  useEffect(() => {
    const b = info?.bridge
    if (waiting && b && !b.pairs.length && !(b.voicePairs ?? []).length && !opened.current) {
      opened.current = true
      setWaiting(false)
      setSetup(true)
    }
  }, [waiting, info])

  const run = async (fn: () => Promise<ApiResult<DiscordBridgeInfo>>): Promise<boolean> => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (!r.ok) {
      onProblem(r.message)
      return false
    }
    setInfo(r.data)
    return true
  }

  if (!info) return <p className="cx-settings-text">Loading…</p>
  if (!info.available)
    return (
      <div className="cx-settings-body">
        <p className="cx-settings-text">
          The Discord bridge isn’t switched on for Glofly yet. It needs Glofly’s Discord app, which
          the Glofly team is setting up.
        </p>
      </div>
    )
  const b = info.bridge

  if (!b)
    return (
      <div className="cx-settings-body dc-bridge">
        <div className="dc-steps">
          <div className="dc-step">
            <span className="dc-step-n" aria-hidden="true">
              1
            </span>
            <div className="dc-step-body">
              <b>Add the Glofly Bridge bot to your Discord server</b>
              <span>
                Opens Discord. You need “Manage Server” there. Glofly learns which server you
                picked, nothing else about your account.
              </span>
              <button
                type="button"
                className="cx-button cx-button--primary"
                disabled={busy}
                onClick={async () => {
                  const r = await call<{ url: string }>('POST', `${base}/connect`)
                  if (!r.ok) return onProblem(r.message)
                  window.open(r.data.url, '_blank', 'noopener')
                  setWaiting(true)
                }}
              >
                Add to Discord
              </button>
              {waiting && (
                <span className="dc-wait">
                  Waiting for Discord… finish in your browser, then come back.
                </span>
              )}
            </div>
          </div>
          <div className="dc-step dc-step--later">
            <span className="dc-step-n" aria-hidden="true">
              2
            </span>
            <div className="dc-step-body">
              <b>Pair channels with nebulas</b>
              <span>Right after, Glofly asks which Discord channels go with which nebulas.</span>
            </div>
          </div>
          <span className="cx-settings-text" style={{ fontSize: 12.5 }}>
            Owner or “Edit constellation settings” only.
          </span>
        </div>
      </div>
    )

  const voicePairs = b.voicePairs ?? []
  const nothingPaired = !b.pairs.length && !voicePairs.length
  const initials = b.guildName
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="cx-settings-body dc-page">
      <div className="dc-server">
        <span className="dc-server-icon" aria-hidden="true">
          {initials}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{b.guildName} (Discord)</b>
          <div className="dc-sub">
            Connected{' '}
            {new Date(b.connectedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric'
            })}
            {b.connectedBy ? ` by ${b.connectedBy.displayName}` : ''} · {b.pairs.length} of{' '}
            {DISCORD_PAIRS_MAX} channels bridged
          </div>
        </div>
        <button type="button" className="cx-button" disabled={busy} onClick={() => setSetup(true)}>
          Set up channels
        </button>
        <button
          type="button"
          className="cx-button"
          disabled={busy}
          onClick={() => void run(() => call<DiscordBridgeInfo>('DELETE', base))}
        >
          Turn off
        </button>
      </div>
      {b.lost && (
        <p className="dc-lost" role="alert">
          Glofly Bridge isn’t in {b.guildName} any more (someone removed it). Add it again to keep
          bridging.
        </p>
      )}
      {nothingPaired && !b.lost && (
        <div className="dc-nudge" role="status">
          <span>No channels are bridged yet, so nothing crosses over. Pair one below.</span>
          <button
            type="button"
            className="cx-button cx-button--primary"
            onClick={() => setSetup(true)}
          >
            Bridge channels
          </button>
        </div>
      )}

      <PairTable
        title="Channels"
        kind="text"
        c={c}
        info={info}
        busy={busy}
        base={base}
        run={run}
        onRefresh={load}
      />
      <PairTable
        title="Voice channels"
        kind="voice"
        c={c}
        info={info}
        busy={busy}
        base={base}
        run={run}
        onRefresh={load}
      />

      <section className="dc-section" aria-labelledby="dc-across">
        <h3 id="dc-across" className="dc-h">
          What goes across
        </h3>
        <label className="dc-toggle">
          <input type="checkbox" role="switch" checked disabled />
          <span className="dc-switch" aria-hidden="true" />
          <span>Messages and replies</span>
        </label>
        {TOGGLES.map((t) => (
          <label key={t.key} className="dc-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={b.settings[t.key]}
              disabled={busy}
              onChange={(e) =>
                void run(() =>
                  call<DiscordBridgeInfo>('PUT', `${base}/settings`, { [t.key]: e.target.checked })
                )
              }
            />
            <span className="dc-switch" aria-hidden="true" />
            <span>{t.label}</span>
          </label>
        ))}
      </section>

      {b.pairs.length > 0 && (
        <section className="dc-section" aria-labelledby="dc-tell">
          <h3 id="dc-tell" className="dc-h">
            Tell members
          </h3>
          <span className="cx-settings-text" style={{ fontSize: 13 }}>
            Both sides already see “Messages here are also shared with …”. A post makes sure
            nobody’s surprised.
          </span>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(['discord', 'glofly'] as const).map((where) => (
              <button
                key={where}
                type="button"
                className="cx-button"
                disabled={busy}
                onClick={async () => {
                  const r = await call<{ posted: number }>('POST', `${base}/note`, { where })
                  if (!r.ok) onProblem(r.message)
                }}
              >
                {where === 'discord' ? 'Post the note in Discord' : 'Post in Glofly'}
              </button>
            ))}
          </span>
        </section>
      )}

      {setup && (
        <DiscordSetup
          c={c}
          info={info}
          onProblem={onProblem}
          onChanged={setInfo}
          onClose={() => {
            setSetup(false)
            load()
          }}
        />
      )}
    </div>
  )
}

/** Discord's channels beside Glofly's nebulas: pairs on one row, then each side's unpaired ones. */
function PairTable({
  title,
  kind,
  c,
  info,
  busy,
  base,
  run,
  onRefresh
}: {
  title: string
  kind: 'text' | 'voice'
  c: ConstellationDetail
  info: DiscordBridgeInfo
  busy: boolean
  base: string
  run: (fn: () => Promise<ApiResult<DiscordBridgeInfo>>) => Promise<boolean>
  onRefresh: () => void
}): React.JSX.Element | null {
  const b = info.bridge!
  const voice = kind === 'voice'
  const channels: Channel[] = (voice ? info.voiceChannels : info.channels) ?? []
  const pairs = voice ? (b.voicePairs ?? []).map((p) => ({ ...p, paused: false })) : b.pairs
  const max = voice ? DISCORD_VOICE_PAIRS_MAX : DISCORD_PAIRS_MAX
  const eligible = useMemo(
    () =>
      c.nebulas.filter(
        (n) =>
          (voice ? n.kind === 'voice' : n.kind === 'text' || n.kind === 'announcement') &&
          (n.visibility ?? 'everyone') === 'everyone' &&
          !n.optional
      ),
    [c.nebulas, voice]
  )
  if (voice && !channels.length && !pairs.length) return null
  const pairedNebulas = new Set(pairs.map((p) => p.nebulaId))
  const freeNebulas = eligible.filter((n) => !pairedNebulas.has(n.id))
  const nebulaName = (id: string): string => c.nebulas.find((n) => n.id === id)?.name ?? 'nebula'
  const canMake = can(c, 'manageNebulas')
  const full = pairs.length >= max

  // Discord's channels in its order, grouped by its categories; pairs whose channel Discord no longer
  // lists stay at the end so they can be removed.
  const groups: { head: string; rows: Channel[] }[] = []
  for (const ch of channels) {
    const head = ch.parent ?? (voice ? 'Voice channels' : 'Text channels')
    const g = groups.find((x) => x.head === head) ?? groups[groups.push({ head, rows: [] }) - 1]
    g.rows.push(ch)
  }
  const gone = pairs.filter((p) => !channels.some((ch) => ch.id === p.discordChannelId))

  const pairWith = (channelId: string, target: { nebulaId: string } | { newNebula: true }): void =>
    void run(() =>
      call<DiscordBridgeInfo>('POST', `${base}/pairs`, { discordChannelId: channelId, ...target })
    )
  const unpair = (id: string): void =>
    void run(() =>
      call<DiscordBridgeInfo>('DELETE', voice ? `${base}/voice/${id}` : `${base}/pairs/${id}`)
    )

  const row = (ch: Channel): React.JSX.Element => {
    const p = pairs.find((x) => x.discordChannelId === ch.id)
    return (
      <div key={ch.id} className={p ? 'dc-row dc-row--paired' : 'dc-row'}>
        <span className="dc-chip dc-chip--discord">
          {voice ? <SpeakerGlyph /> : '#'} {ch.name}
        </span>
        <span className={p ? 'dc-arrow dc-arrow--on' : 'dc-arrow'} aria-hidden="true">
          {p ? '⇄' : '→'}
        </span>
        <div className="dc-row-glofly">
          {p ? (
            <span className="dc-chip dc-chip--glofly">
              {voice ? <SpeakerGlyph /> : '#'} {nebulaName(p.nebulaId)}
            </span>
          ) : full ? (
            <span className="dc-quiet">Up to {max} pairs</span>
          ) : (
            <span className="dc-pick">
              {canMake && (
                <button
                  type="button"
                  className="dc-new"
                  disabled={busy}
                  onClick={() => pairWith(ch.id, { newNebula: true })}
                  title="Makes an ordinary nebula with this name, in the matching category"
                >
                  + New {voice ? '' : '#'}
                  {newNebulaName(ch.name, kind)}
                </button>
              )}
              <select
                aria-label={`Pair Discord ${voice ? '' : '#'}${ch.name} with a nebula`}
                value=""
                disabled={busy || !freeNebulas.length}
                onChange={(e) => e.target.value && pairWith(ch.id, { nebulaId: e.target.value })}
              >
                <option value="">
                  {freeNebulas.length
                    ? canMake
                      ? 'or pick a nebula…'
                      : 'Pick a nebula…'
                    : 'No free nebulas'}
                </option>
                {freeNebulas.map((n) => (
                  <option key={n.id} value={n.id}>
                    {voice ? '' : '#'}
                    {n.name}
                  </option>
                ))}
              </select>
            </span>
          )}
        </div>
        <div className="dc-row-end">
          {p ? (
            <>
              {!voice && (
                <span className={p.paused ? 'dc-state dc-state--paused' : 'dc-state'}>
                  {p.paused ? 'Paused' : 'Live'}
                </span>
              )}
              {!voice && (
                <button
                  type="button"
                  className="cx-link-button"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      call<DiscordBridgeInfo>('PATCH', `${base}/pairs/${p.id}`, {
                        paused: !p.paused
                      })
                    )
                  }
                >
                  {p.paused ? 'Resume' : 'Pause'}
                </button>
              )}
              <button
                type="button"
                className="cx-link-button"
                disabled={busy}
                onClick={() => unpair(p.id)}
              >
                Unpair
              </button>
            </>
          ) : (
            <span className="dc-quiet">Discord only</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <section className="dc-section" aria-labelledby={`dc-${kind}`}>
      <div className="dc-section-top">
        <h3 id={`dc-${kind}`} className="dc-h">
          {title}
        </h3>
        <span className="dc-count">
          {pairs.length} of {max}
        </span>
        <button type="button" className="dc-add-link" onClick={onRefresh}>
          Refresh Discord channels
        </button>
      </div>
      <div className="dc-table">
        <div className="dc-row dc-row--head" aria-hidden="true">
          <span>{b.guildName.toUpperCase()} · DISCORD</span>
          <span />
          <span>{c.name.toUpperCase()} · GLOFLY</span>
          <span />
        </div>
        {groups.map((g) => (
          <div key={g.head} className="dc-group">
            <span className="dc-group-head">{g.head.toUpperCase()}</span>
            {g.rows.map(row)}
          </div>
        ))}
        {gone.length > 0 && (
          <div className="dc-group">
            <span className="dc-group-head">NOT IN DISCORD ANY MORE</span>
            {gone.map((p) =>
              row({ id: p.discordChannelId, name: p.discordChannelName, parent: null })
            )}
          </div>
        )}
        {freeNebulas.length > 0 && (
          <div className="dc-group">
            <span className="dc-group-head">ONLY ON GLOFLY</span>
            {freeNebulas.map((n) => (
              <div key={n.id} className="dc-row dc-row--glofly">
                <span className="dc-quiet">Not in Discord</span>
                <span aria-hidden="true" />
                <span className="dc-chip dc-chip--glofly">
                  {voice ? <SpeakerGlyph /> : '#'} {n.name}
                </span>
                <span className="dc-row-end">
                  <span className="dc-quiet">Glofly only</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span className="cx-settings-text" style={{ fontSize: 12.5 }}>
        {voice
          ? 'Voice pairs show who’s in each room on the other side. No sound crosses over.'
          : 'New nebulas are ordinary nebulas in the category with the same name as their Discord one (or your first category). Unpairing keeps the nebula and its messages. Role-only nebulas can’t be bridged.'}
      </span>
    </section>
  )
}

export function SpeakerGlyph(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ marginRight: 2 }}
    >
      <path d="M11 5L6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 010 7" />
    </svg>
  )
}

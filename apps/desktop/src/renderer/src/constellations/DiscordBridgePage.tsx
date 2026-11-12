import { useCallback, useEffect, useState } from 'react'
import {
  DISCORD_PAIRS_MAX,
  type DiscordBridgeInfo,
  type DiscordBridgeSettings
} from '@glofly/shared/discord'
import type { ApiResult, ConstellationDetail } from '../../../preload/api-types'
import './DiscordBridge.css'

// Communities round 2, board 5a (approved): Constellation settings → Discord bridge. Three steps
// (add the bot, pick channels, tell members), the connected server with its channel pairs, and
// what goes across. Owner or "Edit constellation settings" (like Integrations).

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

export default function DiscordBridgePage({
  c,
  onProblem
}: {
  c: ConstellationDetail
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [info, setInfo] = useState<DiscordBridgeInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [channel, setChannel] = useState('')
  const [nebula, setNebula] = useState('')
  const [waiting, setWaiting] = useState(false)
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
  // After "Add the Glofly Bridge bot" opens Discord, look again every few seconds for a while.
  useEffect(() => {
    if (!waiting || info?.bridge) return
    const t = setInterval(load, 4000)
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000)
    return () => {
      clearInterval(t)
      clearTimeout(stop)
    }
  }, [waiting, info?.bridge, load])

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
  const textNebulas = c.nebulas.filter(
    (n) =>
      (n.kind === 'text' || n.kind === 'announcement') &&
      (n.visibility ?? 'everyone') === 'everyone' &&
      !n.optional
  )
  const free = textNebulas.filter((n) => !b?.pairs.some((p) => p.nebulaId === n.id))
  const freeChannels = info.channels.filter(
    (ch) => !b?.pairs.some((p) => p.discordChannelId === ch.id)
  )
  const nebulaName = (id: string): string =>
    `#${c.nebulas.find((n) => n.id === id)?.name ?? 'nebula'}`

  return (
    <div className="cx-settings-body dc-bridge">
      <div className="dc-steps">
        <Step n={1} done={!!b} title="Add the Glofly Bridge bot to your Discord server">
          <span>
            Opens Discord. You need “Manage Server” there. Glofly learns which server you picked,
            nothing else about your account.
          </span>
          {!b && (
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
          )}
          {waiting && !b && (
            <span className="dc-wait">
              Waiting for Discord… finish in your browser, then come back.
            </span>
          )}
        </Step>
        <Step n={2} done={!!b && b.pairs.length > 0} title="Pick channels to bridge">
          <span>Up to {DISCORD_PAIRS_MAX} pairs. Each Discord channel pairs with one nebula.</span>
        </Step>
        <Step n={3} done={false} title="Tell members">
          <span>Both sides see a note: “Messages here are also shared with Discord / Glofly.”</span>
          {b && b.pairs.length > 0 && (
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
          )}
        </Step>
        <span className="cx-settings-text" style={{ fontSize: 12.5 }}>
          Owner or “Edit constellation settings” only. Turning the bridge off keeps everything
          already copied.
        </span>
      </div>

      {b && (
        <div className="dc-side">
          <div className="dc-server">
            <span className="dc-server-icon" aria-hidden="true">
              {b.guildName
                .split(/\s+/)
                .map((w) => w[0] ?? '')
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{b.guildName} (Discord)</b>
              <div className="dc-sub">
                Connected{' '}
                {new Date(b.connectedAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
                {b.connectedBy ? ` by ${b.connectedBy.displayName}` : ''} · {b.pairs.length}{' '}
                {b.pairs.length === 1 ? 'channel' : 'channels'}
              </div>
            </div>
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
              Glofly Bridge isn’t in {b.guildName} any more (someone removed it). Add it again to
              keep bridging.
            </p>
          )}
          {b.pairs.map((p) => (
            <div key={p.id} className="dc-pair">
              <span className="dc-chip dc-chip--discord">Discord #{p.discordChannelName}</span>
              <span aria-hidden="true">⇄</span>
              <span className="dc-chip dc-chip--glofly">{nebulaName(p.nebulaId)}</span>
              <span style={{ flex: 1 }} />
              <span className={p.paused ? 'dc-state dc-state--paused' : 'dc-state'}>
                {p.paused ? 'Paused' : 'Live'}
              </span>
              <button
                type="button"
                className="cx-link-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    call<DiscordBridgeInfo>('PATCH', `${base}/pairs/${p.id}`, { paused: !p.paused })
                  )
                }
              >
                {p.paused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                className="cx-link-button"
                disabled={busy}
                onClick={() =>
                  void run(() => call<DiscordBridgeInfo>('DELETE', `${base}/pairs/${p.id}`))
                }
              >
                Remove
              </button>
            </div>
          ))}
          {b.pairs.length < DISCORD_PAIRS_MAX &&
            (adding ? (
              <form
                className="dc-add"
                onSubmit={async (e) => {
                  e.preventDefault()
                  const ok = await run(() =>
                    call<DiscordBridgeInfo>('POST', `${base}/pairs`, {
                      discordChannelId: channel || freeChannels[0]?.id,
                      nebulaId: nebula || free[0]?.id
                    })
                  )
                  if (ok) {
                    setAdding(false)
                    setChannel('')
                    setNebula('')
                  }
                }}
              >
                <select
                  aria-label="Discord channel"
                  value={channel || freeChannels[0]?.id || ''}
                  onChange={(e) => setChannel(e.target.value)}
                >
                  {freeChannels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      Discord #{ch.name}
                      {ch.parent ? ` (${ch.parent})` : ''}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">⇄</span>
                <select
                  aria-label="Nebula"
                  value={nebula || free[0]?.id || ''}
                  onChange={(e) => setNebula(e.target.value)}
                >
                  {free.map((n) => (
                    <option key={n.id} value={n.id}>
                      #{n.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="cx-button cx-button--primary"
                  disabled={busy || !freeChannels.length || !free.length}
                >
                  Bridge
                </button>
                <button type="button" className="cx-button" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="dc-add-link" onClick={() => setAdding(true)}>
                + Bridge another channel
              </button>
            ))}
          <b className="dc-label">WHAT GOES ACROSS</b>
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
                    call<DiscordBridgeInfo>('PUT', `${base}/settings`, {
                      [t.key]: e.target.checked
                    })
                  )
                }
              />
              <span className="dc-switch" aria-hidden="true" />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function Step({
  n,
  done,
  title,
  children
}: {
  n: number
  done: boolean
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={done ? 'dc-step dc-step--done' : 'dc-step'}>
      <span className="dc-step-n" aria-hidden="true">
        {done ? '✓' : n}
      </span>
      <div className="dc-step-body">
        <b>{title}</b>
        {children}
      </div>
    </div>
  )
}

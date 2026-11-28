import { useMemo, useState } from 'react'
import {
  DISCORD_PAIRS_MAX,
  DISCORD_VOICE_PAIRS_MAX,
  newNebulaName,
  suggestNebula,
  type DiscordBridgeInfo
} from '@glofly/shared/discord'
import type { ApiResult, ConstellationDetail } from '../../../preload/api-types'
import { can } from '../lib/constellations'
import { SpeakerGlyph } from './DiscordBridgePage'

// Nov 28 (approved canvas "Glofly Discord bridge setup", board 1): right after the Glofly Bridge bot
// joins a Discord server (and from "Set up channels"), pair Discord channels with nebulas. Same-name
// ones come pre-picked ("Matched"); any row can make a new nebula ("+ New nebula #name", an ordinary
// nebula in the category named like the Discord one). Then "Tell members".

const call = <T,>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

type Row = { id: string; name: string; group: string; voice: boolean }
const OFF = 'off'
const NEW = 'new'

export default function DiscordSetup({
  c,
  info,
  onProblem,
  onChanged,
  onClose
}: {
  c: ConstellationDetail
  info: DiscordBridgeInfo
  onProblem: (message: string) => void
  onChanged: (info: DiscordBridgeInfo) => void
  onClose: () => void
}): React.JSX.Element {
  const b = info.bridge!
  const canMake = can(c, 'manageNebulas')
  const taken = useMemo(
    () =>
      new Set([...b.pairs.map((p) => p.nebulaId), ...(b.voicePairs ?? []).map((p) => p.nebulaId)]),
    [b]
  )
  const textNebulas = useMemo(
    () =>
      c.nebulas.filter(
        (n) =>
          (n.kind === 'text' || n.kind === 'announcement') &&
          (n.visibility ?? 'everyone') === 'everyone' &&
          !n.optional &&
          !taken.has(n.id)
      ),
    [c.nebulas, taken]
  )
  const voiceNebulas = useMemo(
    () =>
      c.nebulas.filter(
        (n) =>
          n.kind === 'voice' &&
          (n.visibility ?? 'everyone') === 'everyone' &&
          !n.optional &&
          !taken.has(n.id)
      ),
    [c.nebulas, taken]
  )
  const rows: Row[] = useMemo(() => {
    const pairedChannels = new Set([
      ...b.pairs.map((p) => p.discordChannelId),
      ...(b.voicePairs ?? []).map((p) => p.discordChannelId)
    ])
    return [
      ...info.channels.map((ch) => ({ ...ch, group: ch.parent ?? 'Text channels', voice: false })),
      ...(info.voiceChannels ?? []).map((ch) => ({
        ...ch,
        group: `${ch.parent ?? 'Voice channels'} · voice`,
        voice: true
      }))
    ]
      .filter((ch) => !pairedChannels.has(ch.id))
      .map(({ id, name, group, voice }) => ({ id, name, group, voice }))
  }, [info, b])

  // Same-name channels come pre-picked; everything else starts as "Don't bridge".
  const [picks, setPicks] = useState<Record<string, string>>(() => {
    const used = new Set<string>()
    const out: Record<string, string> = {}
    for (const r of rows) {
      const hit = suggestNebula(r.name, r.voice ? voiceNebulas : textNebulas, used)
      out[r.id] = hit ? hit.id : OFF
      if (hit) used.add(hit.id)
    }
    return out
  })
  const matched = useMemo(() => {
    const m = new Set<string>()
    for (const r of rows) {
      const hit = suggestNebula(r.name, r.voice ? voiceNebulas : textNebulas)
      if (hit && picks[r.id] === hit.id) m.add(r.id)
    }
    return m
  }, [rows, picks, textNebulas, voiceNebulas])

  const [step, setStep] = useState<'pair' | 'tell'>('pair')
  const [busy, setBusy] = useState(false)
  const [tellDiscord, setTellDiscord] = useState(true)
  const [tellGlofly, setTellGlofly] = useState(true)
  const [made, setMade] = useState(0)

  const chosen = rows.filter((r) => picks[r.id] !== OFF)
  const textCount = b.pairs.length + chosen.filter((r) => !r.voice).length
  const voiceCount = (b.voicePairs ?? []).length + chosen.filter((r) => r.voice).length
  const tooMany = textCount > DISCORD_PAIRS_MAX || voiceCount > DISCORD_VOICE_PAIRS_MAX
  const offRows = rows.filter((r) => picks[r.id] === OFF)

  const groups: { head: string; rows: Row[] }[] = []
  for (const r of rows) {
    const g =
      groups.find((x) => x.head === r.group) ?? groups[groups.push({ head: r.group, rows: [] }) - 1]
    g.rows.push(r)
  }

  const optionsFor = (r: Row): { v: string; label: string }[] => {
    const usedElsewhere = new Set(
      Object.entries(picks)
        .filter(([id]) => id !== r.id)
        .map(([, v]) => v)
    )
    const pool = (r.voice ? voiceNebulas : textNebulas).filter((n) => !usedElsewhere.has(n.id))
    return [
      { v: OFF, label: 'Don’t bridge' },
      ...pool.map((n) => ({ v: n.id, label: `${r.voice ? '' : '# '}${n.name}` })),
      ...(canMake
        ? [
            {
              v: NEW,
              label: `+ New nebula  ${r.voice ? '' : '# '}${newNebulaName(r.name, r.voice ? 'voice' : 'text')}`
            }
          ]
        : [])
    ]
  }

  // The constellation's nebulas as they'll be: bridged ones marked, new ones tagged.
  const preview = [
    ...c.nebulas
      .filter((n) => n.kind === 'text' || n.kind === 'announcement' || n.kind === 'voice')
      .map((n) => ({
        key: n.id,
        name: n.name,
        voice: n.kind === 'voice',
        isNew: false,
        bridged: taken.has(n.id) || Object.values(picks).includes(n.id)
      })),
    ...rows
      .filter((r) => picks[r.id] === NEW)
      .map((r) => ({
        key: `new:${r.id}`,
        name: newNebulaName(r.name, r.voice ? 'voice' : 'text'),
        voice: r.voice,
        isNew: true,
        bridged: true
      }))
  ]

  const bridge = async (): Promise<void> => {
    setBusy(true)
    let latest: DiscordBridgeInfo | null = null
    let ok = 0
    for (const r of chosen) {
      const v = picks[r.id]
      const res = await call<DiscordBridgeInfo>(
        'POST',
        `/constellations/${c.id}/discord/pairs`,
        v === NEW
          ? { discordChannelId: r.id, newNebula: true }
          : { discordChannelId: r.id, nebulaId: v }
      )
      if (res.ok) {
        latest = res.data
        ok++
      } else onProblem(`Discord ${r.voice ? '' : '#'}${r.name}: ${res.message}`)
    }
    setBusy(false)
    if (latest) onChanged(latest)
    setMade(ok)
    if (latest?.bridge?.pairs.length) setStep('tell')
    else if (ok) onClose()
  }

  const tell = async (): Promise<void> => {
    setBusy(true)
    for (const where of [tellDiscord && 'discord', tellGlofly && 'glofly'].filter(Boolean)) {
      const r = await call<{ posted: number }>('POST', `/constellations/${c.id}/discord/note`, {
        where
      })
      if (!r.ok) onProblem(r.message)
    }
    setBusy(false)
    onClose()
  }

  const initials = b.guildName
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div
      className="cx-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="dcs-title" className="dcs">
        <div className="dcs-top">
          <span className="dc-server-icon" aria-hidden="true">
            {initials}
          </span>
          <div className="dcs-top-text">
            <h2 id="dcs-title">Glofly Bridge joined {b.guildName}</h2>
            <span>
              Linked to {c.name}
              {step === 'pair' ? ' · one more step before messages cross over' : ''}
            </span>
          </div>
          <button
            type="button"
            className="dcs-close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <ol className="dcs-steps">
          <li className="dcs-s dcs-s--done">
            <span aria-hidden="true">✓</span>Bot added
          </li>
          <li className={step === 'pair' ? 'dcs-s dcs-s--now' : 'dcs-s dcs-s--done'}>
            <span aria-hidden="true">{step === 'pair' ? '2' : '✓'}</span>Bridge channels
          </li>
          <li className={step === 'tell' ? 'dcs-s dcs-s--now' : 'dcs-s'}>
            <span aria-hidden="true">3</span>Tell members
          </li>
        </ol>

        {step === 'pair' ? (
          <>
            <div className="dcs-body">
              <div className="dcs-main">
                <div className="dcs-note">
                  Nothing crosses over until a Discord channel is paired with a nebula. Same-name
                  ones are already matched. Pick a nebula for the rest
                  {canMake ? ', or make a new one right here' : ''}.
                </div>
                {rows.length === 0 ? (
                  <p className="cx-settings-text">
                    Every channel Glofly Bridge can see is already paired. Check its permissions in
                    Discord if a channel is missing.
                  </p>
                ) : (
                  <>
                    <div className="dcs-cols" aria-hidden="true">
                      <span>DISCORD CHANNEL</span>
                      <span />
                      <span>GLOFLY NEBULA</span>
                    </div>
                    {groups.map((g) => (
                      <div key={g.head} className="dcs-group">
                        <span className="dc-group-head">{g.head.toUpperCase()}</span>
                        {g.rows.map((r) => {
                          const v = picks[r.id]
                          const on = v !== OFF
                          return (
                            <div key={r.id} className={on ? 'dcs-row dcs-row--on' : 'dcs-row'}>
                              <span className="dc-chip dc-chip--discord">
                                {r.voice ? <SpeakerGlyph /> : '#'} {r.name}
                              </span>
                              <span
                                className={on ? 'dc-arrow dc-arrow--on' : 'dc-arrow'}
                                aria-hidden="true"
                              >
                                ⇄
                              </span>
                              <span className="dcs-pick">
                                <select
                                  aria-label={`Nebula for Discord ${r.voice ? '' : '#'}${r.name}`}
                                  value={v}
                                  disabled={busy}
                                  onChange={(e) =>
                                    setPicks((p) => ({ ...p, [r.id]: e.target.value }))
                                  }
                                >
                                  {optionsFor(r).map((o) => (
                                    <option key={o.v} value={o.v}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                                {v === NEW ? (
                                  <span className="dcs-tag dcs-tag--new">New nebula</span>
                                ) : matched.has(r.id) ? (
                                  <span className="dcs-tag">Matched</span>
                                ) : null}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {canMake && offRows.length > 0 && (
                      <button
                        type="button"
                        className="dc-add-link"
                        disabled={busy}
                        onClick={() =>
                          setPicks((p) => {
                            const next = { ...p }
                            for (const r of offRows) next[r.id] = NEW
                            return next
                          })
                        }
                      >
                        + Make new nebulas for the {offRows.length} unpaired
                      </button>
                    )}
                  </>
                )}
              </div>
              <aside className="dcs-preview" aria-label={`${c.name} after this`}>
                <span className="dc-group-head">{c.name.toUpperCase()} AFTER THIS</span>
                {preview.map((n) => (
                  <div key={n.key} className={n.bridged ? 'dcs-neb dcs-neb--on' : 'dcs-neb'}>
                    <span className="dcs-neb-mark" aria-hidden="true">
                      {n.voice ? <SpeakerGlyph /> : '#'}
                    </span>
                    <span className="dcs-neb-name">{n.name}</span>
                    {n.isNew && <span className="dcs-neb-new">NEW</span>}
                    {n.bridged && (
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#5865f2"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        role="img"
                        aria-label="Bridged with Discord"
                      >
                        <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
                      </svg>
                    )}
                  </div>
                ))}
                <span className="dcs-preview-note">
                  New nebulas are ordinary nebulas in the matching category. Move, rename or unpair
                  them any time.
                </span>
              </aside>
            </div>
            <div className="dcs-foot">
              <span className="dcs-count">
                <b>
                  {textCount} of {DISCORD_PAIRS_MAX}
                </b>{' '}
                pairs
                {voiceCount ? ` · ${voiceCount} voice` : ''} · Discord’s other channels stay
                Discord-only
                {tooMany && <span className="dcs-over"> · Too many: unpick some</span>}
              </span>
              <button type="button" className="cx-button" disabled={busy} onClick={onClose}>
                Skip for now
              </button>
              <button
                type="button"
                className="cx-button cx-button--primary"
                disabled={busy || !chosen.length || tooMany}
                onClick={() => void bridge()}
              >
                {busy
                  ? 'Bridging…'
                  : chosen.length
                    ? `Bridge ${chosen.length} ${chosen.length === 1 ? 'channel' : 'channels'}`
                    : 'Pick at least one'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="dcs-body">
              <div className="dcs-main">
                <h3 className="dcs-h">
                  {made} {made === 1 ? 'channel is' : 'channels are'} bridged. Let people know.
                </h3>
                <span className="cx-settings-text">
                  Both sides already show “Messages here are also shared with …” at the top of each
                  bridged channel. A post makes sure nobody’s surprised.
                </span>
                <label className="dcs-check">
                  <input
                    type="checkbox"
                    checked={tellDiscord}
                    onChange={(e) => setTellDiscord(e.target.checked)}
                  />
                  Post the note in each bridged Discord channel
                </label>
                <label className="dcs-check">
                  <input
                    type="checkbox"
                    checked={tellGlofly}
                    onChange={(e) => setTellGlofly(e.target.checked)}
                  />
                  Post the note in each bridged nebula
                </label>
              </div>
            </div>
            <div className="dcs-foot">
              <span className="dcs-count" />
              <button type="button" className="cx-button" disabled={busy} onClick={onClose}>
                Skip
              </button>
              <button
                type="button"
                className="cx-button cx-button--primary"
                disabled={busy || (!tellDiscord && !tellGlofly)}
                onClick={() => void tell()}
              >
                Post and finish
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

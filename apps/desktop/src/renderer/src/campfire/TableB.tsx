import { useEffect, useMemo, useRef, useState } from 'react'
import type { Room } from 'livekit-client'
import {
  ABILITIES,
  ABILITY_NAMES,
  isFullCharacter,
  type Ability,
  type Character,
  type SrdMonsterSummary,
  type TableState,
  type Token
} from '@glofly/shared/campfire/types'
import {
  abilityMod,
  CONDITIONS,
  crLabel,
  saveBonus,
  totalLevel,
  xpForCr
} from '@glofly/shared/campfire/rules5e'
import {
  BUILTIN_SOUNDS,
  CONDITION_ROUNDS,
  encounterDifficulty,
  legendaryInfo,
  moveBudget,
  reachOf,
  speedFor
} from '@glofly/shared/campfire/roundB'
import { rulesOf } from '@glofly/shared/campfire/rulesData'
import { cf, fileUrl, pickFile, uploadFile, AUDIO_ACCEPT } from './api'
import { useCf } from './ctx'
import { usePlace } from './place'
import type { LiveFx } from './useTable'
import bellFile from '../assets/sounds/campfire-bell.ogg'
import chimeFile from '../assets/sounds/campfire-chime.ogg'
import thunderFile from '../assets/sounds/campfire-thunder.ogg'
import heartbeatFile from '../assets/sounds/campfire-heartbeat.ogg'
import coinsFile from '../assets/sounds/campfire-coins.ogg'
import drumFile from '../assets/sounds/campfire-drum.ogg'
import gongFile from '../assets/sounds/campfire-gong.ogg'
import whooshFile from '../assets/sounds/campfire-whoosh.ogg'
import doorFile from '../assets/sounds/campfire-door.ogg'
import './roundB.css'

// Campfire Round B on desktop/web (approved boards MoveDesktop, GmScreen, Voice, Terrain):
// the movement bar on your turn, group actions on several tokens, the paused / spotlight /
// whisper banners, the game master screen, and the sound board.

const SOUND_FILES: Record<string, string> = {
  bell: bellFile,
  chime: chimeFile,
  thunder: thunderFile,
  heartbeat: heartbeatFile,
  coins: coinsFile,
  drum: drumFile,
  gong: gongFile,
  whoosh: whooshFile,
  door: doorFile
}

// ───────────── Movement ─────────────

/** How far the token taking its turn may still go (for the ring and the bar). */
export function useMovement(
  t: TableState,
  meId: string,
  isGm: boolean
): {
  tokenId: string
  speed: number
  moved: number
  left: number
  dashed: boolean
  dashExtra: number
  canAct: boolean
} | null {
  return useMemo(() => {
    const c = t.combat
    const e = c?.entries[c.turn]
    if (!c || !e || c.current !== e.tokenId) return null
    const tk = t.tokens.find((x) => x.id === e.tokenId)
    if (!tk) return null
    const ch = tk.characterId ? t.characters.find((x) => x.id === tk.characterId) : undefined
    const mine = tk.controlledBy.includes(meId) || (!!ch && ch.ownerId === meId)
    if (!isGm && !mine) return null
    const speed = speedFor(ch && isFullCharacter(ch) ? ch.sheet : null, tk.conditions)
    const moved = e.moved ?? 0
    const dashed = !!e.dashed
    const left = moveBudget(speed, dashed) - moved
    return {
      tokenId: tk.id,
      speed,
      moved,
      left,
      dashed,
      dashExtra: dashed ? 0 : speed,
      canAct: true
    }
  }, [t.combat, t.tokens, t.characters, isGm, meId])
}

export function MovementBar(): React.JSX.Element | null {
  const { t, say, ctl, me, isGm } = useCf()
  const mv = useMovement(t, me.id, isGm)
  const [heightOpen, setHeightOpen] = useState(false)
  if (!mv) return null
  const tk = t.tokens.find((x) => x.id === mv.tokenId)
  if (!tk) return null
  const budget = moveBudget(mv.speed, mv.dashed)
  const pct = budget ? Math.min(100, (mv.moved / budget) * 100) : 100
  const op = async (body: Record<string, unknown>): Promise<void> => {
    const r = await cf.post<{ combat: typeof t.combat }>(
      `/campfire/campaigns/${t.campaign.id}/combat`,
      body
    )
    if (!r.ok) return say(r.message)
    ctl.update((s) => ({ ...s, combat: r.data.combat }))
  }
  const elevation = tk.elevation ?? 0
  const lastMove = t.combat?.entries[t.combat.turn]?.lastMove
  return (
    <div className="cfb-move" role="group" aria-label={`${tk.name}'s movement`}>
      <div className="cfb-move-meter">
        <div className="cfb-row">
          <b>Movement</b>
          <span className="cf-sub">
            {mv.speed ? `${mv.speed} ft speed` : 'Can’t move (a condition holds it)'}
          </span>
        </div>
        <div className="cfb-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <span className="cf-sub">
          {Math.max(0, mv.left)} of {budget} ft left
          {mv.dashed ? ' · dashing' : mv.speed ? ` · Dash adds ${mv.speed} more` : ''}
        </span>
      </div>
      <button
        type="button"
        className="cf-ghost cfb-amber"
        disabled={mv.dashed || !mv.speed}
        onClick={() => void op({ op: 'dash' })}
      >
        Dash
      </button>
      <div className="cfb-pop-wrap">
        <button
          type="button"
          className="cf-ghost"
          aria-expanded={heightOpen}
          onClick={() => setHeightOpen((v) => !v)}
        >
          Height: {elevation ? `${elevation} ft` : 'ground'}
        </button>
        {heightOpen && (
          <div className="cfb-pop" role="group" aria-label="Height">
            {[0, 5, 10, 20, 30, 60].map((ft) => (
              <button
                key={ft}
                type="button"
                className={ft === elevation ? 'cf-chip cf-chip--on' : 'cf-chip'}
                onClick={async () => {
                  setHeightOpen(false)
                  const r = await cf.patch<Token>(`/campfire/tokens/${tk.id}`, { elevation: ft })
                  if (!r.ok) say(r.message)
                  else ctl.upsertToken(r.data)
                }}
              >
                {ft ? `${ft} ft` : 'Ground'}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        className="cf-ghost"
        disabled={!lastMove}
        onClick={() => void op({ op: 'undoMove' })}
      >
        Undo last move
      </button>
      <span className="cfb-grow" />
      <span className="cf-sub cfb-tip">Drag to move · Space adds a turn · Esc cancels</span>
    </div>
  )
}

// ───────────── Group actions (game masters) ─────────────

export function GroupBar({
  ids,
  onClear
}: {
  ids: string[]
  onClear: () => void
}): React.JSX.Element | null {
  const { t, say, ctl, roll } = useCf()
  const [amount, setAmount] = useState(5)
  const [cond, setCond] = useState<string>('')
  const [rounds, setRounds] = useState(0)
  const [save, setSave] = useState<Ability | ''>('')
  const tokens = ids.map((id) => t.tokens.find((x) => x.id === id)).filter((x): x is Token => !!x)
  if (tokens.length < 2) return null
  const each = async (
    fn: (tk: Token) => Promise<{ ok: boolean; message?: string }>
  ): Promise<void> => {
    for (const tk of tokens) {
      const r = await fn(tk)
      if (!r.ok) return say(r.message ?? 'That didn’t work.')
    }
  }
  const patch = (tk: Token, body: Record<string, unknown>) =>
    cf.patch<Token>(`/campfire/tokens/${tk.id}`, body).then((r) => {
      if (r.ok) ctl.upsertToken(r.data)
      return r
    })
  const allHidden = tokens.every((x) => x.layer === 'gm')
  const allLocked = tokens.every((x) => x.locked)
  return (
    <div className="cfb-group" role="toolbar" aria-label={`${tokens.length} tokens selected`}>
      <b>{tokens.length} selected</b>
      <label className="cfb-inline">
        <span className="cf-sr">Amount</span>
        <input
          type="number"
          min={0}
          max={999}
          value={amount}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
        />
      </label>
      <button
        type="button"
        className="cf-ghost cf-small"
        onClick={() => void each((tk) => cf.post(`/campfire/tokens/${tk.id}/damage`, { amount }))}
      >
        Damage all
      </button>
      <button
        type="button"
        className="cf-ghost cf-small"
        onClick={() => void each((tk) => cf.post(`/campfire/tokens/${tk.id}/heal`, { amount }))}
      >
        Heal
      </button>
      <select
        aria-label="Roll a save for each"
        value={save}
        onChange={async (e) => {
          const a = e.target.value as Ability
          setSave('')
          for (const tk of tokens) {
            const ch = tk.characterId
              ? t.characters.find((x) => x.id === tk.characterId)
              : undefined
            const bonus = ch && isFullCharacter(ch) ? saveBonus(ch.sheet, a) : 0
            await roll(`1d20${bonus >= 0 ? '+' : ''}${bonus}`, {
              label: `${tk.name}: ${ABILITY_NAMES[a]} save`,
              characterId: ch?.id ?? null
            })
          }
        }}
      >
        <option value="">Roll a save…</option>
        {ABILITIES.map((a) => (
          <option key={a} value={a}>
            {ABILITY_NAMES[a]}
          </option>
        ))}
      </select>
      <select aria-label="Add a condition" value={cond} onChange={(e) => setCond(e.target.value)}>
        <option value="">Add condition…</option>
        {CONDITIONS.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      {cond && (
        <>
          <select
            aria-label="For how long"
            value={rounds}
            onChange={(e) => setRounds(Number(e.target.value))}
          >
            <option value={0}>Until removed</option>
            {CONDITION_ROUNDS.map((n) => (
              <option key={n} value={n}>
                {n} round{n === 1 ? '' : 's'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cf-primary cf-small"
            onClick={async () => {
              await each((tk) =>
                patch(tk, {
                  conditions: [...new Set([...tk.conditions, cond])],
                  conditionTimers: rounds
                    ? { ...(tk.conditionTimers ?? {}), [cond]: rounds }
                    : (tk.conditionTimers ?? {})
                })
              )
              setCond('')
            }}
          >
            Add
          </button>
        </>
      )}
      <button
        type="button"
        className="cf-ghost cf-small"
        onClick={() => void each((tk) => patch(tk, { layer: allHidden ? 'tokens' : 'gm' }))}
      >
        {allHidden ? 'Show' : 'Hide'}
      </button>
      <button
        type="button"
        className="cf-ghost cf-small"
        onClick={() => void each((tk) => patch(tk, { locked: !allLocked }))}
      >
        {allLocked ? 'Unlock' : 'Lock'}
      </button>
      <button type="button" className="cf-x" aria-label="Clear the selection" onClick={onClear}>
        ×
      </button>
    </div>
  )
}

// ───────────── Paused, spotlight, whisper, notices ─────────────

export function TableBanners({
  fx,
  onResume
}: {
  fx: LiveFx
  onResume: () => void
}): React.JSX.Element {
  const { t, isGm, me, nameOf } = useCf()
  const live = t.campaign.live
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!fx.notice) return
    setNotice(fx.notice.text)
    const id = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(id)
  }, [fx.notice])
  const whisperToMe = fx.whisper && fx.whisper.to === me.id
  return (
    <>
      {live?.paused && !isGm && (
        <div className="cfb-paused" role="status">
          <span className="cfb-paused-icon" aria-hidden="true">
            ❚❚
          </span>
          <b>The table is paused</b>
          <span>
            {nameOf(live.paused.by)} paused the game
            {live.paused.message ? `: “${live.paused.message}”` : '.'} Tokens and rolls wait until
            it starts again. You can still look at your sheet.
          </span>
        </div>
      )}
      <div className="cfb-banners">
        {live?.paused && isGm && (
          <div className="cfb-banner cfb-banner--amber" role="status">
            <b>Paused for everyone</b>
            {live.paused.message && <span>“{live.paused.message}”</span>}
            <button type="button" className="cf-primary cf-small" onClick={onResume}>
              Resume
            </button>
          </div>
        )}
        {live?.spotlight && (
          <div className="cfb-banner cfb-banner--violet" role="status">
            <b>
              {live.spotlight === me.id
                ? 'The spotlight is on you'
                : `Spotlight on ${nameOf(live.spotlight)}`}
            </b>
            <span>
              {live.spotlight === me.id
                ? 'The game master is giving you the scene.'
                : 'The game master is giving them the scene.'}
            </span>
          </div>
        )}
        {whisperToMe && (
          <div className="cfb-banner cfb-banner--violet" role="status">
            <b>{nameOf(fx.whisper!.from)} is whispering to you</b>
            <span>Only you hear them right now.</span>
          </div>
        )}
        {notice && (
          <div className="cfb-banner" role="status">
            {notice}
          </div>
        )}
      </div>
    </>
  )
}

// ───────────── Sound playback and the speaking glow ─────────────

export function useSoundPlayer(fx: LiveFx['sound']): void {
  useEffect(() => {
    if (!fx) return
    const src = fx.builtin ? SOUND_FILES[fx.builtin] : fx.fileId ? fileUrl(fx.fileId) : null
    if (!src) return
    let vol = 0.7
    try {
      vol = Number(localStorage.getItem('campfire.soundVolume') ?? '0.7')
    } catch {
      /* default */
    }
    const a = new Audio(src)
    a.volume = Math.max(0, Math.min(1, fx.volume * (Number.isFinite(vol) ? vol / 0.7 : 1)))
    void a.play().catch(() => undefined)
    const stop = window.setTimeout(() => a.pause(), 16_000)
    return () => window.clearTimeout(stop)
  }, [fx])
}

const GLOW_KEY = 'campfire.speakingGlow'
export const speakingGlowOn = (): boolean => {
  try {
    return localStorage.getItem(GLOW_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Token ids whose player is talking in the call (their own PCs' tokens and tokens they control). */
export function useSpeakingTokens(
  t: TableState,
  room: Room | null,
  tick: number,
  on: boolean
): Set<string> {
  return useMemo(() => {
    const out = new Set<string>()
    if (!room || !on) return out
    const talking = new Set<string>()
    for (const p of room.remoteParticipants.values()) if (p.isSpeaking) talking.add(p.identity)
    if (room.localParticipant.isSpeaking) talking.add(room.localParticipant.identity)
    if (!talking.size) return out
    for (const tk of t.tokens) {
      const ch = tk.characterId ? t.characters.find((c) => c.id === tk.characterId) : undefined
      if (
        (ch?.kind === 'pc' && ch.ownerId && talking.has(ch.ownerId)) ||
        tk.controlledBy.some((u) => talking.has(u))
      )
        out.add(tk.id)
    }
    return out
    // `tick` changes when who's talking changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, tick, on, t.tokens, t.characters])
}

/** Reach (for the hover square): from the sheet when we have it, 5 ft otherwise. */
export function reachFor(t: TableState): (tk: Token) => number | null {
  return (tk) => {
    if (tk.layer === 'map') return null
    const ch = tk.characterId ? t.characters.find((c) => c.id === tk.characterId) : undefined
    return reachOf(ch && isFullCharacter(ch) ? ch.sheet : null)
  }
}

// ───────────── The game master screen ─────────────

export function GmScreenPanel({
  onWhere
}: {
  onWhere: () => { x: number; y: number }
}): React.JSX.Element {
  const { t, say, ctl, me } = useCf()
  const place = usePlace()
  const live = t.campaign.live
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SrdMonsterSummary[]>([])
  const [npcName, setNpcName] = useState('')
  const [npcKind, setNpcKind] = useState('commoner')
  const rules = rulesOf(t.campaign.settings)

  useEffect(() => {
    if (!q.trim()) return setFound([])
    const id = window.setTimeout(async () => {
      const r = await cf.get<{ monsters: SrdMonsterSummary[] }>(
        `/campfire/srd/monsters?q=${encodeURIComponent(q.trim())}&rules=${rules}`
      )
      if (r.ok) setFound(r.data.monsters.slice(0, 8))
    }, 200)
    return () => window.clearTimeout(id)
  }, [q, rules])

  // The party: player characters' levels. The fight: monsters on the map (hidden ones too).
  const pcs = t.characters.filter((c): c is Character => c.kind === 'pc' && isFullCharacter(c))
  const levels = pcs.map((c) => Math.max(1, totalLevel(c.sheet)))
  const monsters = t.tokens
    .filter((tk) => tk.layer !== 'map' && tk.characterId)
    .map((tk) => ({ tk, ch: t.characters.find((c) => c.id === tk.characterId) }))
    .filter(
      (x): x is { tk: Token; ch: Character } =>
        !!x.ch && x.ch.kind === 'npc' && isFullCharacter(x.ch) && !!x.ch.sheet.monster
    )
  const diff = encounterDifficulty(
    levels.length ? levels : [1],
    monsters.map((m) => m.ch.sheet.monster!.xp || xpForCr(m.ch.sheet.monster!.cr))
  )
  const top = diff.thresholds[diff.thresholds.length - 1].xp
  const legendary = monsters
    .map((m) => ({ ...m, info: legendaryInfo(m.ch.sheet.monster) }))
    .filter((m) => m.info && t.combat?.entries.some((e) => e.tokenId === m.tk.id))

  const post = async (path: string, body: unknown): Promise<boolean> => {
    const r = await cf.post(path, body)
    if (!r.ok) say(r.message)
    return r.ok
  }
  const members = t.members.filter((m) => m.userId !== me.id)
  const diffClass =
    diff.label === 'Low'
      ? 'cfb-good'
      : diff.label === 'Moderate'
        ? 'cfb-warn'
        : diff.label === 'Nothing yet'
          ? ''
          : 'cfb-bad'

  return (
    <section className="cf-panel cfb-gm" aria-label="Game master screen">
      <div className="cfb-card">
        <div className="cfb-row">
          <h3 className="cf-h3 cfb-grow">Encounter builder</h3>
          <span className="cf-sub">
            {levels.length || 'No'} player{levels.length === 1 ? '' : 's'}
            {levels.length
              ? ` · level ${Math.round(levels.reduce((a, b) => a + b, 0) / levels.length)}`
              : ''}
          </span>
        </div>
        {monsters.length ? (
          <ul className="cfb-list">
            {Object.values(
              monsters.reduce<Record<string, { name: string; n: number; xp: number; cr: number }>>(
                (acc, m) => {
                  const k = m.ch.name
                  const xp = m.ch.sheet.monster!.xp || xpForCr(m.ch.sheet.monster!.cr)
                  acc[k] = {
                    name: k,
                    n: (acc[k]?.n ?? 0) + 1,
                    xp: (acc[k]?.xp ?? 0) + xp,
                    cr: m.ch.sheet.monster!.cr
                  }
                  return acc
                },
                {}
              )
            ).map((m) => (
              <li key={m.name} className="cfb-row">
                <span className="cfb-grow">
                  {m.n} {m.name} <span className="cf-sub">(CR {crLabel(m.cr)})</span>
                </span>
                <span className="cf-sub">{m.xp.toLocaleString()} XP</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="cf-sub">No monsters on the map yet. Add some below or from the Add tab.</p>
        )}
        <div className="cfb-bar cfb-bar--big" aria-hidden="true">
          <span
            className={diffClass}
            style={{ width: `${Math.min(100, top ? (diff.xp / top) * 100 : 0)}%` }}
          />
        </div>
        <div className="cfb-row cf-sub">
          {diff.thresholds.map((th) => (
            <span key={th.label} className="cfb-grow">
              {th.label} {th.xp.toLocaleString()}
            </span>
          ))}
        </div>
        <div className="cfb-row">
          <span className={`cfb-pill ${diffClass}`}>{diff.label}</span>
          <span className="cf-sub cfb-grow">
            {diff.xp.toLocaleString()} XP of monsters (System Reference Document 5.2 budget)
          </span>
        </div>
        <input
          className="cf-search"
          aria-label="Add a monster"
          placeholder="Add a monster (goblin, ogre…)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {found.map((m) => (
          <div key={m.slug} className="cfb-row">
            <span className="cfb-grow">
              {m.name}{' '}
              <span className="cf-sub">
                CR {crLabel(m.cr)} · {xpForCr(m.cr).toLocaleString()} XP
              </span>
            </span>
            <button
              type="button"
              className="cf-ghost cf-small"
              onClick={() => void place({ srdMonster: m.slug }, { hidden: true })}
            >
              Place hidden
            </button>
          </div>
        ))}
      </div>

      <div className="cfb-card">
        <h3 className="cf-h3">Quick NPC</h3>
        <div className="cfb-row">
          <input
            className="cfb-grow"
            aria-label="NPC name"
            placeholder="Mira, tavern keeper"
            value={npcName}
            maxLength={60}
            onChange={(e) => setNpcName(e.target.value)}
          />
          <select
            aria-label="Stat block"
            value={npcKind}
            onChange={(e) => setNpcKind(e.target.value)}
          >
            {[
              'commoner',
              'guard',
              'bandit',
              'noble',
              'acolyte',
              'scout',
              'thug',
              'veteran',
              'mage',
              'priest'
            ].map((k) => (
              <option key={k} value={k}>
                {k[0].toUpperCase() + k.slice(1)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="cf-primary cf-small"
            onClick={async () => {
              const tk = await place({
                srdMonster: npcKind,
                ...(npcName.trim() ? { name: npcName.trim() } : {})
              })
              if (tk) {
                setNpcName('')
                say(`${tk.name} is on the map.`)
              }
            }}
          >
            Make
          </button>
        </div>
        <span className="cf-sub">
          A name and a stat block in one click; edit the copy any time from its stat block.
        </span>
      </div>

      {legendary.length > 0 && (
        <div className="cfb-card cfb-card--hot">
          <h3 className="cf-h3">Legendary actions</h3>
          {legendary.map(({ tk, info }) => {
            const used = t.combat?.entries.find((e) => e.tokenId === tk.id)?.legendaryUsed ?? 0
            return (
              <div key={tk.id} className="cfb-legend">
                <div className="cfb-row">
                  <b className="cfb-grow">{tk.name}</b>
                  <span className="cfb-pill">
                    {info!.perRound - used} of {info!.perRound} left
                  </span>
                </div>
                <div className="cfb-row cfb-wrap">
                  {info!.options.map((o) => (
                    <button
                      key={o.name}
                      type="button"
                      className="cf-ghost cf-small"
                      disabled={used + o.cost > info!.perRound}
                      onClick={async () => {
                        const r = await cf.post<{ combat: typeof t.combat }>(
                          `/campfire/campaigns/${t.campaign.id}/combat`,
                          { op: 'legendary', tokenId: tk.id, cost: o.cost }
                        )
                        if (!r.ok) return say(r.message)
                        ctl.update((s) => ({ ...s, combat: r.data.combat }))
                        say(`${tk.name}: ${o.name}`)
                      }}
                    >
                      {o.name}
                      {o.cost > 1 ? ` (${o.cost})` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <span className="cf-sub">
            Use them at the end of another creature’s turn; they come back at the start of its own.
          </span>
        </div>
      )}

      <div className="cfb-card">
        <h3 className="cf-h3">Table controls</h3>
        {live?.paused ? (
          <button
            type="button"
            className="cf-primary"
            onClick={() => void post(`/campfire/campaigns/${t.campaign.id}/pause`, { on: false })}
          >
            Resume the table
          </button>
        ) : (
          <div className="cfb-row">
            <input
              className="cfb-grow"
              aria-label="Pause message"
              placeholder="Back in 10 (optional)"
              maxLength={120}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button
              type="button"
              className="cf-ghost cf-small"
              onClick={() =>
                void post(`/campfire/campaigns/${t.campaign.id}/pause`, {
                  on: true,
                  ...(message.trim() ? { message: message.trim() } : {})
                }).then(() => setMessage(''))
              }
            >
              Pause the table
            </button>
          </div>
        )}
        <div className="cfb-row cfb-wrap">
          <button
            type="button"
            className="cf-ghost cf-small"
            disabled={!t.scene}
            onClick={async () => {
              const c = onWhere()
              if (
                t.scene &&
                (await post(`/campfire/campaigns/${t.campaign.id}/view`, {
                  sceneId: t.scene.id,
                  x: c.x,
                  y: c.y
                }))
              )
                say('Everyone’s view moved to where you’re looking.')
            }}
          >
            Move everyone’s view here
          </button>
          <button
            type="button"
            className={
              t.campaign.settings.tokensLocked
                ? 'cf-ghost cf-small cf-ghost--on'
                : 'cf-ghost cf-small'
            }
            aria-pressed={!!t.campaign.settings.tokensLocked}
            onClick={async () => {
              const r = await cf.patch(`/campfire/campaigns/${t.campaign.id}`, {
                settings: { tokensLocked: !t.campaign.settings.tokensLocked }
              })
              if (!r.ok) say(r.message)
            }}
          >
            {t.campaign.settings.tokensLocked ? 'Unlock all tokens' : 'Lock all tokens'}
          </button>
        </div>
        <label className="cf-field">
          <span>Spotlight a player</span>
          <select
            value={live?.spotlight ?? ''}
            onChange={(e) =>
              void post(`/campfire/campaigns/${t.campaign.id}/spotlight`, {
                userId: e.target.value || null
              })
            }
          >
            <option value="">No spotlight</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.user?.displayName ?? 'Someone'}
              </option>
            ))}
          </select>
        </label>
        <details className="cf-more">
          <summary>Remove someone from the table…</summary>
          {members.filter((m) => m.role !== 'gm').length === 0 && (
            <p className="cf-sub">Only players can be removed.</p>
          )}
          {members
            .filter((m) => m.role !== 'gm')
            .map((m) => (
              <div key={m.userId} className="cfb-row">
                <span className="cfb-grow">{m.user?.displayName ?? 'Someone'}</span>
                <button
                  type="button"
                  className="cf-ghost cf-small cf-danger-text"
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Remove ${m.user?.displayName ?? 'them'} from this table? They can’t open it until you let them back from here.`
                      )
                    )
                      return
                    await post(`/campfire/campaigns/${t.campaign.id}/members/${m.userId}/remove`, {
                      removed: true
                    })
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
        </details>
      </div>
    </section>
  )
}

// ───────────── Sounds (game masters) ─────────────

type Sound = { id: string; name: string; fileId: string }

export function SoundsPanel({
  room,
  whisperTo,
  setWhisperTo
}: {
  room: Room | null
  whisperTo: string | null
  setWhisperTo: (id: string | null) => void
}): React.JSX.Element {
  const { t, say, me } = useCf()
  const [sounds, setSounds] = useState<Sound[]>([])
  const [playing, setPlaying] = useState<string | null>(null)
  const [glow, setGlow] = useState(speakingGlowOn())
  const [vol, setVol] = useState(() => {
    try {
      return Number(localStorage.getItem('campfire.soundVolume') ?? '0.7')
    } catch {
      return 0.7
    }
  })
  const timer = useRef<number | null>(null)
  const load = async (): Promise<void> => {
    const r = await cf.get<{ sounds: Sound[] }>(`/campfire/campaigns/${t.campaign.id}/sounds`)
    if (r.ok) setSounds(r.data.sounds)
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.campaign.id])
  const play = async (
    body: { builtin: string } | { soundId: string },
    key: string
  ): Promise<void> => {
    const r = await cf.post(`/campfire/campaigns/${t.campaign.id}/sound`, { ...body, volume: 0.7 })
    if (!r.ok) return say(r.message)
    setPlaying(key)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPlaying(null), 2500)
  }
  const players = t.members.filter((m) => m.userId !== me.id)
  return (
    <section className="cf-panel cfb-gm" aria-label="Sounds">
      <div className="cfb-card">
        <div className="cfb-row">
          <h3 className="cf-h3 cfb-grow">Sound board</h3>
          <button
            type="button"
            className="cf-ghost cf-small"
            onClick={async () => {
              const file = await pickFile(AUDIO_ACCEPT)
              if (!file) return
              say('Uploading the sound…')
              const up = await uploadFile(t.campaign.id, 'audio', file)
              if (!up.ok) return say(up.message)
              const r = await cf.post<Sound>(`/campfire/campaigns/${t.campaign.id}/sounds`, {
                fileId: up.data.id,
                name: file.name.replace(/\.[^.]+$/, '').slice(0, 40)
              })
              if (!r.ok) return say(r.message)
              say('Sound ready.')
              void load()
            }}
          >
            + Upload a sound
          </button>
        </div>
        <div className="cfb-pads">
          {BUILTIN_SOUNDS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cfb-pad${playing === s.id ? ' cfb-pad--on' : ''}`}
              onClick={() => void play({ builtin: s.id }, s.id)}
            >
              <b>{s.name}</b>
              <span>{playing === s.id ? 'playing' : 'built in'}</span>
            </button>
          ))}
          {sounds.map((s) => (
            <div
              key={s.id}
              className={`cfb-pad cfb-pad--own${playing === s.id ? ' cfb-pad--on' : ''}`}
            >
              <button
                type="button"
                className="cf-plain"
                onClick={() => void play({ soundId: s.id }, s.id)}
              >
                <b>{s.name}</b>
                <span>{playing === s.id ? 'playing' : 'yours'}</span>
              </button>
              <button
                type="button"
                className="cf-x"
                aria-label={`Delete ${s.name}`}
                onClick={async () => {
                  const r = await cf.del(`/campfire/sounds/${s.id}`)
                  if (!r.ok) return say(r.message)
                  void load()
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="cfb-row">
          <span className="cf-sub cfb-grow">
            Built-in sounds are made by Glofly; yours are uploads you have the rights to. Up to 15
            seconds; everyone hears it over the music.
          </span>
        </div>
        <label className="cfb-row">
          <span className="cf-sub">Sounds volume here</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={vol}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVol(v)
              try {
                localStorage.setItem('campfire.soundVolume', String(v))
              } catch {
                /* this window only */
              }
            }}
          />
        </label>
      </div>
      <div className="cfb-card cfb-card--hot">
        <h3 className="cf-h3">Whisper to a player</h3>
        {!room && <p className="cf-sub">Join the call to whisper.</p>}
        <div className="cfb-row cfb-wrap">
          {players.map((m) => (
            <button
              key={m.userId}
              type="button"
              disabled={!room}
              aria-pressed={whisperTo === m.userId}
              className={whisperTo === m.userId ? 'cf-chip cf-chip--on' : 'cf-chip'}
              onClick={() => setWhisperTo(whisperTo === m.userId ? null : m.userId)}
            >
              {m.user?.displayName ?? 'Someone'}
            </button>
          ))}
        </div>
        <span className="cf-sub">
          {whisperTo
            ? 'Hold V to whisper: only they hear you while you hold it.'
            : 'Pick a player, then hold V to talk only to them.'}
        </span>
      </div>
      <div className="cfb-card">
        <div className="cfb-row">
          <h3 className="cf-h3 cfb-grow">Speaking glow on tokens</h3>
          <button
            type="button"
            role="switch"
            aria-checked={glow}
            aria-label="Speaking glow on tokens"
            className="cfa-switch"
            onClick={() => {
              const next = !glow
              setGlow(next)
              try {
                localStorage.setItem(GLOW_KEY, next ? 'on' : 'off')
              } catch {
                /* this window only */
              }
            }}
          />
        </div>
        <span className="cf-sub">A token glows while its player talks. This is for you only.</span>
      </div>
    </section>
  )
}

/** Holding V whispers: only the chosen player can hear the game master's microphone meanwhile. */
export function useWhisperKey(
  campaignId: string,
  room: Room | null,
  to: string | null,
  say: (m: string) => void
): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!room || !to) return
    let on = false
    const set = async (next: boolean): Promise<void> => {
      if (next === on) return
      on = next
      setHeld(next)
      try {
        await room.localParticipant.setTrackSubscriptionPermissions(
          !next,
          next ? [{ participantIdentity: to, allowAll: true }] : []
        )
      } catch {
        say('The call didn’t allow a whisper.')
      }
      void cf.post(`/campfire/campaigns/${campaignId}/whisper`, { to, on: next })
    }
    const down = (e: KeyboardEvent): void => {
      if (
        e.key.toLowerCase() !== 'v' ||
        e.repeat ||
        (e.target as HTMLElement)?.closest?.('input, textarea, select, [contenteditable]')
      )
        return
      void set(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() === 'v') void set(false)
    }
    const blur = (): void => void set(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      void set(false)
    }
  }, [room, to, campaignId, say])
  return held
}

export { abilityMod }

import { useState } from 'react'
import type { CombatEntry, CombatView, Token } from '@glofly/shared/campfire/types'
import { cf, fileUrl } from './api'
import { useCf } from './ctx'
import { hpColor, ringFor } from './geometry'
import { RollRow } from './Rolls'

// The turn order (Main board: GM; Player board: everyone): roll initiative, next/previous turn,
// drag (or ▲▼) to fix ties, set a number by hand, hide from players, remove, end the fight.

function hpOf(token: Token | undefined): { pct: number; text: string } | null {
  const b = token?.bars[0]
  if (!b) return null
  if (b.value !== null && b.max) {
    const pct = Math.max(0, Math.min(100, (b.value / b.max) * 100))
    return { pct, text: `${b.value} / ${b.max} HP` }
  }
  if (b.state)
    return {
      pct: b.state === 'defeated' ? 0 : b.state === 'bloodied' ? 45 : 100,
      text: b.state === 'healthy' ? 'Healthy' : b.state === 'bloodied' ? 'Bloodied' : 'Defeated'
    }
  return null
}

function useCombat(): {
  combat: CombatView | null
  op: (body: Record<string, unknown>) => Promise<void>
} {
  const { t, ctl, say } = useCf()
  const op = async (body: Record<string, unknown>): Promise<void> => {
    const r = await cf.post<{ combat: CombatView | null }>(
      `/campfire/campaigns/${t.campaign.id}/combat`,
      body
    )
    if (!r.ok) say(r.message)
    else ctl.update((s) => ({ ...s, combat: r.data.combat }))
  }
  return { combat: t.combat, op }
}

/** Whose tokens are these (owned or controlled by me)? */
function useMine(): (e: CombatEntry) => boolean {
  const { t, me } = useCf()
  return (e) => {
    const tk = t.tokens.find((x) => x.id === e.tokenId)
    if (!tk) return false
    if (tk.controlledBy.includes(me.id)) return true
    const ch = tk.characterId ? t.characters.find((c) => c.id === tk.characterId) : null
    return !!ch && ch.ownerId === me.id
  }
}

/**
 * 0.11.4 (Chip: "prompt the players to roll for initiative"): when the game master rolls
 * initiative, monsters roll at once and each player gets this to roll their own. The turn order
 * starts once everyone has.
 */
export function InitiativePrompt(): React.JSX.Element | null {
  const { combat, op } = useCombat()
  const mine = useMine()
  const [busy, setBusy] = useState(false)
  if (!combat?.rolling) return null
  const waiting = combat.entries.filter((e) => e.init === null && mine(e))
  if (!waiting.length) return null
  return (
    <div className="cf-init-prompt" role="alertdialog" aria-label="Roll for initiative">
      <b>Roll for initiative!</b>
      <span>The fight starts once everyone has rolled.</span>
      <div className="cf-row-buttons">
        {waiting.map((e) => (
          <button
            key={e.tokenId}
            type="button"
            className="cf-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await op({ op: 'roll', tokenId: e.tokenId })
              setBusy(false)
            }}
          >
            Roll d20{waiting.length > 1 ? ` for ${e.name}` : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The game master's view while players roll: who's left, and "Roll for the rest". */
export function InitiativeWaiting(): React.JSX.Element | null {
  const { combat, op } = useCombat()
  if (!combat?.rolling) return null
  const left = combat.entries.filter((e) => e.player && e.init === null)
  if (!left.length) return null
  return (
    <div className="cfb-banner cfb-banner--amber cf-init-wait" role="status">
      <b>Waiting for initiative:</b>
      <span>{left.map((e) => e.name).join(', ')}</span>
      <button
        type="button"
        className="cf-soft cf-small"
        onClick={() => void op({ op: 'rollAll', rest: true })}
      >
        Roll for the rest
      </button>
    </div>
  )
}

export function TurnOrder({ withRolls }: { withRolls?: boolean }): React.JSX.Element {
  const { t, isGm, me, selectedId, setSelectedId } = useCf()
  const characters = t.characters
  const { combat, op } = useCombat()
  const [dragId, setDragId] = useState<string | null>(null)
  const tokens = new Map(t.tokens.map((x) => [x.id, x]))
  const mine = (e: CombatEntry): boolean => {
    const tk = tokens.get(e.tokenId)
    if (!tk) return false
    if (tk.controlledBy.includes(me.id)) return true
    const ch = tk.characterId ? characters.find((c) => c.id === tk.characterId) : null
    return !!ch && ch.ownerId === me.id
  }
  const entries = combat?.entries ?? []
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= entries.length || from === to) return
    const ids = entries.map((e) => e.tokenId)
    const [id] = ids.splice(from, 1)
    ids.splice(to, 0, id)
    void op({ op: 'reorder', tokenIds: ids })
  }

  return (
    <section className="cf-panel" aria-label="Turn order">
      <div className="cf-panel-head">
        <h2 className="cf-h2">Turn order</h2>
        {isGm && (
          <button
            type="button"
            className="cf-soft"
            onClick={async () => {
              if (!combat) await op({ op: 'start' })
              await op({ op: 'rollAll' })
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2l9 5v10l-9 5-9-5V7z" />
              <path d="M12 22V12M21 7l-9 5-9-5" />
            </svg>
            Roll initiative
          </button>
        )}
      </div>
      {isGm && (
        <p className="cf-hint">
          {combat?.rolling
            ? 'Monsters have rolled. Players roll their own; the fight starts once they all have (or press Roll for the rest).'
            : combat
              ? `Round ${combat.round}. Monsters roll at once, players roll their own; the order sorts itself. Drag to fix ties.`
              : 'Roll initiative starts a fight with everyone on the tokens layer. Players roll their own.'}
        </p>
      )}
      {!combat && !isGm && (
        <p className="cf-hint">
          No fight right now. When the game master rolls initiative, the order shows here.
        </p>
      )}
      {combat && (
        <ol className="cf-order">
          {entries.map((e, i) => {
            const tk = tokens.get(e.tokenId)
            const active = combat.current === e.tokenId
            const hp = hpOf(tk)
            const party =
              !!tk &&
              (tk.controlledBy.length > 0 ||
                (!!tk.characterId &&
                  characters.some((c) => c.id === tk.characterId && c.kind === 'pc')))
            const { fill, ring } = ringFor(tk?.characterId ?? e.tokenId, party)
            const isMine = mine(e)
            return (
              <li
                key={e.tokenId}
                className={`cf-order-row${active ? ' cf-order-row--active' : ''}${e.hidden ? ' cf-order-row--hidden' : ''}${selectedId === e.tokenId ? ' cf-order-row--selected' : ''}`}
                draggable={isGm}
                onDragStart={() => setDragId(e.tokenId)}
                onDragOver={(ev) => isGm && ev.preventDefault()}
                onDrop={() => {
                  if (!dragId) return
                  move(
                    entries.findIndex((x) => x.tokenId === dragId),
                    i
                  )
                  setDragId(null)
                }}
                aria-current={active ? 'true' : undefined}
              >
                {isGm ? (
                  <input
                    className="cf-order-init"
                    aria-label={`${e.name}'s initiative`}
                    defaultValue={e.init ?? ''}
                    key={`${e.tokenId}:${e.init}`}
                    onBlur={(ev) => {
                      const v = ev.target.value.trim()
                      const n = v === '' ? null : Number(v)
                      if (n !== e.init && (n === null || Number.isFinite(n)))
                        void op({
                          op: 'set',
                          tokenId: e.tokenId,
                          init: n === null ? null : Math.round(n)
                        })
                    }}
                    onKeyDown={(ev) => ev.key === 'Enter' && (ev.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="cf-order-init" aria-label="Initiative">
                    {e.init ?? '–'}
                  </span>
                )}
                <span
                  className="cf-order-face"
                  style={{ background: fill, boxShadow: `0 0 0 2px ${ring}` }}
                  aria-hidden="true"
                >
                  {tk?.imageFileId ? (
                    <img src={fileUrl(tk.imageFileId)} alt="" />
                  ) : (
                    (e.name[0] ?? '?').toUpperCase()
                  )}
                </span>
                <button
                  type="button"
                  className="cf-order-main"
                  onClick={() => setSelectedId(e.tokenId)}
                  aria-label={`Select ${e.name}${hp ? `, ${hp.text}` : ''}`}
                >
                  <span className="cf-order-name">
                    {e.name}
                    {isMine && ' (you)'}
                    {e.hidden && <span className="cf-badge">Hidden</span>}
                  </span>
                  {hp && (
                    <span className="cf-hpbar" aria-hidden="true">
                      <span style={{ width: `${hp.pct}%`, background: hpColor(hp.pct) }} />
                    </span>
                  )}
                </button>
                {!isGm && isMine && e.init === null && (
                  <button
                    type="button"
                    className="cf-soft cf-small"
                    onClick={() => void op({ op: 'roll', tokenId: e.tokenId })}
                  >
                    Roll
                  </button>
                )}
                {isGm && (
                  <span className="cf-order-tools">
                    <button
                      type="button"
                      aria-label={`Move ${e.name} up`}
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${e.name} down`}
                      title="Move down"
                      disabled={i === entries.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      aria-label={
                        e.hidden ? `Show ${e.name} to players` : `Hide ${e.name} from players`
                      }
                      title={e.hidden ? 'Show to players' : 'Hide from players'}
                      onClick={() => void op({ op: 'set', tokenId: e.tokenId, hidden: !e.hidden })}
                    >
                      {e.hidden ? '◌' : '●'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Take ${e.name} out of the turn order`}
                      title="Remove"
                      onClick={() => void op({ op: 'remove', tokenId: e.tokenId })}
                    >
                      ×
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {isGm && combat && (
        <div className="cf-row-buttons">
          <button type="button" className="cf-ghost" onClick={() => void op({ op: 'prev' })}>
            Previous
          </button>
          <button type="button" className="cf-primary" onClick={() => void op({ op: 'next' })}>
            Next turn
          </button>
          {selectedId && !entries.some((e) => e.tokenId === selectedId) && (
            <button
              type="button"
              className="cf-ghost"
              onClick={() => void op({ op: 'add', tokenIds: [selectedId] })}
            >
              Add selected
            </button>
          )}
          <button type="button" className="cf-ghost" onClick={() => void op({ op: 'end' })}>
            End combat
          </button>
        </div>
      )}
      {!isGm && (
        <p className="cf-hint">
          Monsters&apos; health stays hidden unless the game master shows it.
        </p>
      )}
      {withRolls && t.rolls.length > 0 && (
        <>
          <div className="cf-panel-head cf-panel-head--rolls">
            <h2 className="cf-h2">Roll history</h2>
          </div>
          <ol className="cf-rolls">
            {t.rolls.slice(0, 4).map((r) => (
              <RollRow key={r.id} roll={r} />
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

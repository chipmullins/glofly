import { CONDITION_ROUNDS } from '@glofly/shared/campfire/roundB'
import { useEffect, useState } from 'react'
import type { Character, PendingDamage, Token, TokenBar } from '@glofly/shared/campfire/types'
import { isFullCharacter } from '@glofly/shared/campfire/types'
import { CONDITIONS, TOKEN_MARKERS } from '@glofly/shared/campfire/rules5e'
import { cf } from './api'
import { useCf } from './ctx'
import { DieFace, NumBox, TextBox } from './ui'

// Things over the map: the GM's approval box for pending damage (apply / change / skip), the big
// roll card for my rolls ("Natural 20!"), and the selected token's card (bars, conditions, and
// for GMs everything else: name, layer, size, aura, who controls it).

export function ApprovalBox(): React.JSX.Element | null {
  const { t, say, ctl } = useCf()
  const [changing, setChanging] = useState<string | null>(null)
  const [amount, setAmount] = useState(0)
  if (!t.pending.length) return null
  const name = (id: string | null): string =>
    id ? t.tokens.find((x) => x.id === id)?.name || 'a token' : 'someone'
  const act = async (p: PendingDamage, op: 'apply' | 'skip', value?: number): Promise<void> => {
    const r = await cf.post(
      `/campfire/pending/${p.id}/${op}`,
      op === 'apply' && value !== undefined ? { amount: value } : {}
    )
    if (!r.ok) say(r.message)
    ctl.update((s) => ({ ...s, pending: s.pending.filter((x) => x.id !== p.id) }))
    setChanging(null)
  }
  return (
    <section className="cf-approve" aria-label="Damage waiting for you" aria-live="polite">
      <span className="cf-kicker">Game master</span>
      {t.pending.slice(0, 3).map((p) => (
        <div key={p.id} className="cf-approve-row">
          <span>
            {p.crit && <strong>Critical! </strong>}
            Apply {p.amount}
            {p.damageType ? ` ${p.damageType}` : ''} damage to {name(p.targetTokenId)}
            <span className="cf-sub"> from {name(p.attackerTokenId)}</span>?
          </span>
          {changing === p.id ? (
            <form
              className="cf-approve-buttons"
              onSubmit={(e) => {
                e.preventDefault()
                void act(p, 'apply', amount)
              }}
            >
              <NumBox
                label="Damage to apply"
                value={amount}
                min={0}
                max={9999}
                onChange={setAmount}
              />
              <button type="submit" className="cf-primary cf-small">
                Apply {amount}
              </button>
              <button type="button" className="cf-ghost cf-small" onClick={() => setChanging(null)}>
                Back
              </button>
            </form>
          ) : (
            <div className="cf-approve-buttons">
              <button
                type="button"
                className="cf-primary cf-small"
                onClick={() => void act(p, 'apply')}
              >
                Apply
              </button>
              <button
                type="button"
                className="cf-ghost cf-small"
                onClick={() => {
                  setAmount(p.amount)
                  setChanging(p.id)
                }}
              >
                Change amount
              </button>
              <button
                type="button"
                className="cf-ghost cf-small"
                onClick={() => void act(p, 'skip')}
              >
                Skip
              </button>
            </div>
          )}
        </div>
      ))}
      {t.pending.length > 3 && <span className="cf-sub">{t.pending.length - 3} more waiting</span>}
    </section>
  )
}

/** My newest roll, big over the map for a few seconds (Player board's "Natural 20!"). */
export function RollCardOverlay(): React.JSX.Element | null {
  const { t, me, nameOf, ctl } = useCf()
  const [doneId, setDoneId] = useState<string | null>(null)
  const newest = t.rolls[0]
  // Only rolls made while the table is open (not the history it loaded with).
  const [openedAt] = useState(() => Date.now())
  const fresh =
    !!newest &&
    Date.parse(newest.createdAt) - ctl.serverOffset >= openedAt - 2000 &&
    (newest.userId === me.id || newest.result.natural === 20) &&
    newest.id !== doneId
  const shown = fresh ? newest : null
  useEffect(() => {
    if (!shown) return
    const timer = window.setTimeout(() => setDoneId(shown.id), 3800)
    return () => window.clearTimeout(timer)
  }, [shown])
  if (!shown) return null
  const r = shown.result
  const nat20 = r.natural === 20
  const nat1 = r.natural === 1
  const who = shown.characterId
    ? (t.characters.find((c) => c.id === shown.characterId)?.name ?? nameOf(shown.userId))
    : shown.userId === me.id
      ? 'You'
      : nameOf(shown.userId)
  return (
    <div className={`cf-rollcard${nat20 ? ' cf-rollcard--crit' : ''}`} role="status">
      <DieFace value={nat20 || nat1 ? (r.natural ?? shown.total) : shown.total} size={72} />
      <div>
        <strong className="cf-rollcard-title">
          {nat20 ? 'Natural 20!' : nat1 ? 'Natural 1' : shown.total}
        </strong>
        <span className="cf-rollcard-sub">
          {who} · {shown.label ?? r.label ?? shown.expression}
          {nat20 || nat1 ? ` · ${shown.total}` : ''}
        </span>
        <span className="cf-mono cf-rollcard-math">{r.breakdown}</span>
      </div>
    </div>
  )
}

const BAR_NAMES = ['Hit points', 'Bar 2', 'Bar 3']
const BAR_COLORS = ['#e0193a', '#4f8cff', '#f0b429']

export function TokenCard({
  token,
  onClose
}: {
  token: Token
  onClose: () => void
}): React.JSX.Element {
  const { isGm, say, ctl, t, me } = useCf()
  const patch = async (body: Record<string, unknown>): Promise<void> => {
    const r = await cf.patch<Token>(`/campfire/tokens/${token.id}`, body)
    if (!r.ok) say(r.message)
    else ctl.upsertToken(r.data)
  }
  const setBar = (i: number, bar: TokenBar | null): void => {
    const bars = [0, 1, 2].map((j) => (j === i ? bar : (token.bars[j] ?? null)))
    void patch({ bars })
  }
  const hpAct = async (kind: 'damage' | 'heal', amount: number): Promise<void> => {
    if (amount <= 0) return
    const r = await cf.post(`/campfire/tokens/${token.id}/${kind}`, { amount })
    if (!r.ok) say(r.message)
  }
  const [hpAmt, setHpAmt] = useState(5)
  const toggleCond = (c: string): void => {
    const has = token.conditions.includes(c)
    void patch({
      conditions: has ? token.conditions.filter((x) => x !== c) : [...token.conditions, c]
    })
  }
  const markers = [...CONDITIONS.map((c) => c.id as string), ...TOKEN_MARKERS]
  return (
    <section className="cf-tokencard" aria-label={`${token.name || 'Token'}`}>
      <div className="cf-tokencard-head">
        {isGm ? (
          <TextBox
            label="Token name"
            className="cf-name-box"
            value={token.name}
            maxLength={60}
            onChange={(name) => void patch({ name })}
          />
        ) : (
          <h3 className="cf-h3">{token.name || 'Token'}</h3>
        )}
        <button type="button" className="cf-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      {[0, 1, 2].map((i) => {
        const b = token.bars[i]
        if (!b && !isGm) return null
        if (!b)
          return (
            <button
              key={i}
              type="button"
              className="cf-ghost cf-small"
              onClick={() =>
                setBar(i, {
                  value: 10,
                  max: 10,
                  color: BAR_COLORS[i],
                  show: i === 0 ? 'all' : 'gm'
                })
              }
            >
              + {BAR_NAMES[i]}
            </button>
          )
        return (
          <div key={i} className="cf-barrow">
            <span className="cf-bar-dot" style={{ background: b.color }} aria-hidden="true" />
            <span className="cf-sub">{BAR_NAMES[i]}</span>
            {b.value !== null ? (
              <>
                <NumBox
                  label={`${BAR_NAMES[i]} value`}
                  value={b.value}
                  min={-99999}
                  max={99999}
                  onChange={(n) => setBar(i, { ...b, value: n })}
                />
                <span aria-hidden="true">/</span>
                <NumBox
                  label={`${BAR_NAMES[i]} most`}
                  value={b.max ?? 0}
                  min={0}
                  max={99999}
                  disabled={!isGm}
                  onChange={(n) => setBar(i, { ...b, max: n })}
                />
              </>
            ) : (
              <span>{b.state ?? 'hidden'}</span>
            )}
            {isGm && (
              <select
                aria-label={`Who sees ${BAR_NAMES[i]}`}
                value={b.show}
                onChange={(e) => setBar(i, { ...b, show: e.target.value as TokenBar['show'] })}
              >
                <option value="all">Everyone</option>
                <option value="owner">Owner</option>
                <option value="gm">GMs</option>
              </select>
            )}
            {isGm && i > 0 && (
              <button
                type="button"
                className="cf-x"
                aria-label={`Remove ${BAR_NAMES[i]}`}
                onClick={() => setBar(i, null)}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      {token.bars[0] && token.bars[0].value !== null && (
        <div className="cf-barrow">
          <NumBox label="Amount" value={hpAmt} min={0} max={9999} onChange={setHpAmt} />
          <button
            type="button"
            className="cf-ghost cf-small"
            onClick={() => void hpAct('damage', hpAmt)}
          >
            Damage
          </button>
          <button
            type="button"
            className="cf-ghost cf-small"
            onClick={() => void hpAct('heal', hpAmt)}
          >
            Heal
          </button>
        </div>
      )}
      <details className="cf-more">
        <summary>
          Conditions{token.conditions.length ? ` (${token.conditions.length})` : ''}
        </summary>
        <div className="cf-conditions" role="group" aria-label="Conditions">
          {markers.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={token.conditions.includes(c)}
              className={token.conditions.includes(c) ? 'cf-chip cf-chip--on' : 'cf-chip'}
              onClick={() => toggleCond(c)}
            >
              {c}
            </button>
          ))}
        </div>
        {isGm && token.conditions.length > 0 && (
          <div className="cf-cond-timers" role="group" aria-label="How long conditions last">
            {token.conditions.map((c) => (
              <label key={c} className="cf-cond-timer">
                <span>{c}</span>
                <select
                  aria-label={`How long ${c} lasts`}
                  value={token.conditionTimers?.[c] ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    const timers = { ...(token.conditionTimers ?? {}) }
                    if (n > 0) timers[c] = n
                    else delete timers[c]
                    void patch({ conditionTimers: timers })
                  }}
                >
                  <option value={0}>Until removed</option>
                  {CONDITION_ROUNDS.map((n) => (
                    <option key={n} value={n}>
                      {n === 100 ? '10 minutes (100 rounds)' : `${n} round${n === 1 ? '' : 's'}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <span className="cf-sub">
              Rounds count down at the start of its turn, then the condition comes off.
            </span>
          </div>
        )}
      </details>
      {token.layer !== 'map' && (
        <div className="cf-barrow" role="group" aria-label="Height">
          <span className="cf-sub">Height</span>
          <div className="cf-seg">
            {[0, 10, 20, 30].map((ft) => (
              <button
                key={ft}
                type="button"
                aria-pressed={(token.elevation ?? 0) === ft}
                className={(token.elevation ?? 0) === ft ? 'cf-chip cf-chip--on' : 'cf-chip'}
                onClick={() => void patch({ elevation: ft })}
              >
                {ft ? `${ft} ft` : 'Ground'}
              </button>
            ))}
            <NumBox
              label="Height in feet"
              value={token.elevation ?? 0}
              min={-1000}
              max={10000}
              onChange={(n) => void patch({ elevation: n })}
            />
          </div>
        </div>
      )}
      {isGm && token.layer !== 'map' && (
        <label className="cf-check">
          <input
            type="checkbox"
            checked={!!token.locked}
            onChange={(e) => void patch({ locked: e.target.checked })}
          />{' '}
          Locked (players can’t move it)
        </label>
      )}
      {isGm && (
        <details className="cf-more">
          <summary>Token settings</summary>
          <div className="cf-field-grid">
            <label className="cf-field">
              <span>Layer</span>
              <select value={token.layer} onChange={(e) => void patch({ layer: e.target.value })}>
                <option value="tokens">Tokens (everyone)</option>
                <option value="gm">GM layer (hidden)</option>
                <option value="map">Map (background)</option>
              </select>
            </label>
            <label className="cf-field">
              <span>Size (squares)</span>
              <NumBox
                label="Size in squares"
                value={token.w}
                min={1}
                max={20}
                onChange={(n) => void patch({ w: n, h: n })}
              />
            </label>
            <label className="cf-field">
              <span>Aura (ft, 0 = none)</span>
              <NumBox
                label="Aura radius in feet"
                value={token.aura?.radiusFt ?? 0}
                min={0}
                max={1000}
                onChange={(n) =>
                  void patch({
                    aura: n > 0 ? { radiusFt: n, color: token.aura?.color ?? '#ffb347' } : null
                  })
                }
              />
            </label>
            <label className="cf-field">
              <span>Aura color</span>
              <input
                type="color"
                value={token.aura?.color ?? '#ffb347'}
                onChange={(e) =>
                  void patch({
                    aura: { radiusFt: token.aura?.radiusFt || 10, color: e.target.value }
                  })
                }
              />
            </label>
            <label className="cf-check">
              <input
                type="checkbox"
                checked={token.showName}
                onChange={(e) => void patch({ showName: e.target.checked })}
              />
              Show its name to players
            </label>
          </div>
          <fieldset className="cf-fieldset">
            <legend>Who controls it</legend>
            {t.members
              .filter((m) => m.role === 'player' || m.userId !== me.id)
              .map((m) => (
                <label key={m.userId} className="cf-check">
                  <input
                    type="checkbox"
                    checked={token.controlledBy.includes(m.userId)}
                    onChange={(e) =>
                      void patch({
                        controlledBy: e.target.checked
                          ? [...token.controlledBy, m.userId]
                          : token.controlledBy.filter((x) => x !== m.userId)
                      })
                    }
                  />
                  {m.user?.displayName ?? 'Someone'}
                </label>
              ))}
          </fieldset>
          <button
            type="button"
            className="cf-danger-ghost"
            onClick={async () => {
              const r = await cf.del(`/campfire/tokens/${token.id}`)
              if (!r.ok) return say(r.message)
              ctl.update((s) => ({ ...s, tokens: s.tokens.filter((x) => x.id !== token.id) }))
              onClose()
            }}
          >
            Delete token
          </button>
        </details>
      )}
    </section>
  )
}

/**
 * My character is down (0 HP, still dying): a big card over the table with the death saves and
 * one button to roll the next one (the phone's death-save card, for computers). The d20 is rolled
 * on the server; a 20 brings them back with 1 HP, three successes make them stable.
 */
export function DyingCard(): React.JSX.Element | null {
  const { t, say, me } = useCf()
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<string | null>(null)
  const mine = t.characters.find(
    (c) => c.ownerId === me.id && c.kind === 'pc' && isFullCharacter(c)
  ) as Character | undefined
  const s = mine?.sheet
  const dying = !!s && s.hp.current <= 0 && !s.deathSaves.dead && !s.deathSaves.stable
  if (!dying && last !== null) setLast(null)
  if (!mine || !s || !dying) return null
  const roll = async (): Promise<void> => {
    setBusy(true)
    const r = await cf.post<{ outcome: string; roll: { result: { total: number } } }>(
      `/campfire/characters/${mine.id}/death-save`
    )
    setBusy(false)
    if (!r.ok) return say(r.message)
    const words: Record<string, string> = {
      success: 'a success',
      failure: 'a failure',
      stable: `${mine.name} is stable`,
      dead: `${mine.name} has died`,
      revived: `a 20! ${mine.name} is back up with 1 HP`
    }
    const line = `Death save: ${r.data.roll.result.total}, ${words[r.data.outcome] ?? r.data.outcome}.`
    setLast(line)
    if (r.data.outcome === 'stable' || r.data.outcome === 'dead' || r.data.outcome === 'revived')
      say(line)
  }
  const pips = (n: number, tone: 'good' | 'bad', label: string): React.JSX.Element => (
    <span className="cf-dying-pips" role="img" aria-label={`${n} of 3 ${label}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`cf-dying-pip cf-dying-pip--${tone}${i < n ? ' on' : ''}`} />
      ))}
    </span>
  )
  return (
    <section
      className="cf-dying"
      role="alertdialog"
      aria-labelledby="cf-dying-title"
      aria-describedby="cf-dying-how"
    >
      <span className="cf-kicker">0 hit points</span>
      <h2 id="cf-dying-title">{mine.name} is down</h2>
      <p id="cf-dying-how" className="cf-sub">
        Roll a death save on your turn: 10 or higher is a success, three successes and you&apos;re
        stable. Three failures and you die. A 20 brings you back with 1 HP; healing does too.
      </p>
      <div className="cf-dying-sets">
        <span>
          <b className="cf-dying-good">Successes</b>
          {pips(s.deathSaves.successes, 'good', 'successes')}
        </span>
        <span>
          <b className="cf-dying-bad">Failures</b>
          {pips(s.deathSaves.failures, 'bad', 'failures')}
        </span>
      </div>
      {last && (
        <p className="cf-dying-last" aria-live="polite">
          {last}
        </p>
      )}
      <button
        type="button"
        className="cf-primary cf-dying-roll"
        disabled={busy}
        onClick={() => void roll()}
      >
        <DieFace value="20" size={26} /> {busy ? 'Rolling…' : 'Roll a death save'}
      </button>
    </section>
  )
}

import { useEffect, useState } from 'react'
import type { PendingDamage, Token, TokenBar } from '@glofly/shared/campfire/types'
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
      </details>
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

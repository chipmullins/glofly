import { useState } from 'react'
import type { Roll } from '@glofly/shared/campfire/types'
import { parseDice } from '@glofly/shared/campfire/dice'
import { colorsFor } from '../lib/avatarColors'
import { useCf } from './ctx'

// Roll history rows, the Rolls tab, and the dice tray with its /roll box (Main/Player boards).

export function RollRow({ roll }: { roll: Roll }): React.JSX.Element {
  const { nameOf, me, t } = useCf()
  const who = roll.userId ? nameOf(roll.userId) : 'Game master'
  const character = roll.characterId ? t.characters.find((c) => c.id === roll.characterId) : null
  const name = character?.name ?? who
  const [bg, fg] = colorsFor(roll.characterId ?? roll.userId ?? 'gm')
  const badge =
    roll.visibility === 'gm'
      ? roll.userId === me.id
        ? 'Only you + GM'
        : 'GM only'
      : roll.visibility === 'whisper'
        ? `Whisper${roll.whisperTo.length ? ` to ${roll.whisperTo.map(nameOf).join(', ')}` : ''}`
        : null
  const r = roll.result
  const nat = r.natural
  return (
    <li className="cf-roll">
      <span className="cf-roll-face" style={{ background: bg, color: fg }} aria-hidden="true">
        {(name[0] ?? '?').toUpperCase()}
      </span>
      <div className="cf-roll-text">
        <span className="cf-roll-who">
          {name}
          {badge && <span className="cf-badge">{badge}</span>}
        </span>
        {(roll.label || r.label) && <span className="cf-roll-label">{roll.label ?? r.label}</span>}
        <span className="cf-mono">{r.breakdown || roll.expression}</span>
      </div>
      <span
        className={`cf-roll-total${nat === 20 ? ' cf-roll-total--crit' : nat === 1 ? ' cf-roll-total--fumble' : ''}`}
        aria-label={`Total ${roll.total}${nat === 20 ? ', natural 20' : nat === 1 ? ', natural 1' : ''}`}
      >
        {roll.total}
      </span>
    </li>
  )
}

export function RollsPanel(): React.JSX.Element {
  const { t } = useCf()
  return (
    <section className="cf-panel" aria-label="Roll history">
      <h2 className="cf-h2">Roll history</h2>
      {t.rolls.length === 0 ? (
        <p className="cf-hint">No rolls yet. Use the dice below, or type /roll 1d20+5.</p>
      ) : (
        <ol className="cf-rolls" aria-live="polite">
          {t.rolls.map((r) => (
            <RollRow key={r.id} roll={r} />
          ))}
        </ol>
      )}
    </section>
  )
}

const DICE = [4, 6, 8, 10, 12, 20, 100]

export function DiceTray(): React.JSX.Element {
  const { roll, share, setShare, t, me, isGm, say } = useCf()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const others = t.members.filter((m) => m.userId !== me.id)
  const forcedGm = !isGm && t.campaign.settings.diceVisibility === 'gm'

  const send = async (): Promise<void> => {
    const expr = text.trim().replace(/^\/(roll|r)\s+/i, '')
    if (!expr) return
    const p = parseDice(expr)
    if (!p.ok) {
      say(p.error)
      return
    }
    setBusy(true)
    const ok = await roll(expr)
    setBusy(false)
    if (ok) setText('')
  }

  return (
    <div className="cf-tray">
      <div className="cf-dice" role="group" aria-label="Roll dice">
        {DICE.map((d) => (
          <button
            key={d}
            type="button"
            className={d === 20 ? 'cf-die-button cf-die-button--d20' : 'cf-die-button'}
            title={`Roll 1d${d} (Shift: with advantage on a d20)`}
            onClick={(e) => void roll(d === 20 && e.shiftKey ? '2d20kh1' : `1d${d}`)}
          >
            d{d}
          </button>
        ))}
      </div>
      <form
        className="cf-rollbox"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <label className="cf-rollbox-field">
          <svg
            width="16"
            height="16"
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
          <input
            aria-label="Roll: dice like 2d6+3"
            placeholder="/roll 2d6+3"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <button type="submit" className="cf-primary" disabled={busy || !text.trim()}>
          Roll
        </button>
      </form>
      <div className="cf-share">
        <label>
          <span className="cf-sr">Who sees your rolls</span>
          <select
            value={forcedGm ? 'gm' : share.mode}
            disabled={forcedGm}
            onChange={(e) => setShare({ mode: e.target.value as typeof share.mode, to: share.to })}
            aria-label="Who sees your rolls"
          >
            <option value="all">Everyone sees rolls</option>
            <option value="gm">{isGm ? 'Only me (GM)' : 'Only the game master'}</option>
            <option value="whisper">Whisper to…</option>
          </select>
        </label>
        {share.mode === 'whisper' && !forcedGm && (
          <div className="cf-whisper" role="group" aria-label="Whisper to">
            {others.map((m) => (
              <label key={m.userId} className="cf-check">
                <input
                  type="checkbox"
                  checked={share.to.includes(m.userId)}
                  onChange={(e) =>
                    setShare({
                      mode: 'whisper',
                      to: e.target.checked
                        ? [...share.to, m.userId]
                        : share.to.filter((x) => x !== m.userId)
                    })
                  }
                />
                {m.user?.displayName ?? 'Someone'}
              </label>
            ))}
            {others.length === 0 && <span className="cf-hint">Nobody else has joined yet.</span>}
          </div>
        )}
      </div>
    </div>
  )
}

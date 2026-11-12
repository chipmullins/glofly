import { CharacterBuilder } from './CharacterBuilder'
import { withTwoHanded } from '@glofly/shared/campfire/builder'
import { useState } from 'react'
import {
  ABILITIES,
  ABILITY_NAMES,
  isFullCharacter,
  type AttackResult,
  type Character,
  type CharacterView,
  type SheetAttack
} from '@glofly/shared/campfire/types'
import { abilityMod, attackExpressions, hpState } from '@glofly/shared/campfire/rules5e'
import { cf, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { signed, useCf } from './ctx'
import { classesLine, useRollNow, useSheetEditor } from './sheetCore'
import { Portrait, SvgIcon } from './sheetBits'
import './sheet.css'

// The Sheet tab (Player board's right side, the GM's Sheet tab): a short version of the sheet
// (portrait, HP, AC/speed/hit dice, abilities and attacks, tap to roll) and the button that opens
// the whole sheet as a window over the table (SheetWindow). GMs open NPCs' stat blocks from here.

/** Which character the Sheet tab shows. */
export function SheetPanel(): React.JSX.Element {
  const { t, me, isGm, selectedId, say, ctl, openSheet } = useCf()
  const selectedToken = selectedId ? t.tokens.find((x) => x.id === selectedId) : null
  const mine = t.characters.filter((c) => c.ownerId === me.id)
  const [pick, setPick] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [building, setBuilding] = useState(false)
  const fromToken = selectedToken?.characterId ?? null
  const choices = isGm
    ? t.characters
    : t.characters.filter((c) => c.ownerId === me.id || c.kind === 'pc')
  const id =
    (pick && choices.some((c) => c.id === pick) ? pick : null) ??
    fromToken ??
    mine[0]?.id ??
    (isGm ? (t.characters[0]?.id ?? null) : null)
  const ch = id ? (t.characters.find((c) => c.id === id) ?? null) : null

  const create = async (kind: 'pc' | 'npc'): Promise<void> => {
    const name = newName.trim()
    if (!name) return say('Give them a name first.')
    const r = await cf.post<Character>(`/campfire/campaigns/${t.campaign.id}/characters`, {
      kind,
      name
    })
    if (!r.ok) return say(r.message)
    setNewName('')
    setPick(r.data.id)
    ctl.update((s) =>
      s.characters.some((c) => c.id === r.data.id)
        ? s
        : { ...s, characters: [...s.characters, r.data] }
    )
    openSheet(r.data.id)
  }

  return (
    <section className="cf-panel cf-sheet-panel" aria-label="Character sheet">
      {choices.length > 1 && (
        <label className="cf-field cf-field--row">
          <span>Sheet</span>
          <select value={ch?.id ?? ''} onChange={(e) => setPick(e.target.value)}>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.kind === 'npc' ? ' (NPC)' : c.ownerId === me.id ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {ch ? (
        isFullCharacter(ch) ? (
          <ShortSheet key={ch.id} ch={ch} />
        ) : (
          <PublicShort ch={ch} />
        )
      ) : null}
      {!isGm && !mine.length && (
        <div className="cf-new-char">
          <h3 className="cf-h3">Make your character</h3>
          <p className="cf-hint">
            Build one step by step, import a character sheet PDF, or copy the numbers in from
            another sheet.
          </p>
          <button type="button" className="cf-primary" onClick={() => setBuilding(true)}>
            Bring or build your character
          </button>
        </div>
      )}
      {isGm && (
        <form
          className="cf-new-char"
          onSubmit={(e) => {
            e.preventDefault()
            void create('pc')
          }}
        >
          <h3 className="cf-h3">{isGm ? 'New character' : 'Make your character'}</h3>
          <input
            aria-label="Character name"
            placeholder="Name"
            maxLength={60}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className="cf-row-buttons">
            <button type="submit" className="cf-primary">
              {isGm ? 'New player character' : 'Make my character'}
            </button>
            <button type="button" className="cf-ghost" onClick={() => setBuilding(true)}>
              Use the builder
            </button>
            {isGm && (
              <button type="button" className="cf-ghost" onClick={() => void create('npc')}>
                New NPC
              </button>
            )}
          </div>
        </form>
      )}
      {building && (
        <CharacterBuilder
          onClose={() => setBuilding(false)}
          onMade={(c) => {
            setBuilding(false)
            setPick(c.id)
            ctl.update((s) =>
              s.characters.some((x) => x.id === c.id)
                ? s
                : { ...s, characters: [...s.characters, c] }
            )
            openSheet(c.id)
          }}
        />
      )}
    </section>
  )
}

function PublicShort({ ch }: { ch: CharacterView }): React.JSX.Element {
  const { openSheet, nameOf } = useCf()
  const s = ch.summary
  return (
    <div className="cf-sheet">
      <div className="cf-sheet-head">
        <Portrait ch={ch} size={64} />
        <div className="cf-sheet-title">
          <h2 className="cf-h2">{ch.name}</h2>
          <span className="cf-sub">{[s.race, s.classLine].filter(Boolean).join(' · ')}</span>
          {ch.ownerId && <span className="cf-sub">Played by {nameOf(ch.ownerId)}</span>}
        </div>
      </div>
      <ShortHp hp={s.hp} />
      <div className="cf-stat-row">
        <Stat label="Armor class" value={String(s.ac)} />
        <Stat label="Level" value={String(s.level || '—')} />
      </div>
      <button type="button" className="cf-ghost" onClick={() => openSheet(ch.id)}>
        Open {ch.name}&apos;s sheet
      </button>
    </div>
  )
}

function Stat({
  label,
  value,
  onClick,
  aria
}: {
  label: string
  value: string
  onClick?: () => void
  aria?: string
}): React.JSX.Element {
  const inner = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
    </>
  )
  return onClick ? (
    <button type="button" className="cf-stat" onClick={onClick} aria-label={aria}>
      {inner}
    </button>
  ) : (
    <div className="cf-stat">{inner}</div>
  )
}

function ShortHp({
  hp
}: {
  hp: { current: number; max: number; temp: number }
}): React.JSX.Element {
  const max = Math.max(1, hp.max)
  const cur = Math.max(0, Math.min(100, (hp.current / max) * 100))
  const temp = Math.max(0, Math.min(100 - cur, (hp.temp / max) * 100))
  const state = hpState(hp.current, hp.max)
  return (
    <div className="cf-hp">
      <div className="cf-hp-head">
        <span>Hit points</span>
        <span className="cf-hp-nums">
          <strong>
            {hp.current} / {hp.max}
          </strong>
          {hp.temp > 0 && <span className="cfs-pill cfs-pill--temp">+{hp.temp} temp</span>}
        </span>
      </div>
      <span
        className="cfs-hpbar"
        role="img"
        aria-label={`${hp.current} of ${hp.max} hit points${hp.temp ? `, ${hp.temp} temporary` : ''}`}
      >
        <span
          className={`cfs-hpbar-hp cfs-hpbar-hp--${state === 'healthy' ? 'good' : state === 'bloodied' ? 'bloodied' : 'down'}`}
          style={{ width: `${cur}%` }}
        />
        <span className="cfs-hpbar-temp" style={{ width: `${temp}%` }} />
      </span>
    </div>
  )
}

function ShortSheet({ ch }: { ch: Character }): React.JSX.Element {
  const { t, isGm, say, targetId, tokenOf, selectedId, openSheet, openStatBlock, attackWith } =
    useCf()
  const ed = useSheetEditor(ch)
  const { sheet, canEdit } = ed
  const rollNow = useRollNow()
  const myToken =
    tokenOf(ch.id) ??
    (isGm && selectedId ? (t.tokens.find((x) => x.id === selectedId) ?? null) : null)
  const target = targetId ? t.tokens.find((x) => x.id === targetId) : null
  const npcRolls = ch.kind === 'npc'
  const rollCheck = (bonus: number, label: string): void =>
    void rollNow(bonus ? `1d20${bonus > 0 ? '+' : '-'}${Math.abs(bonus)}` : '1d20', {
      label: `${ch.name}: ${label}`,
      characterId: ch.id,
      gmOnly: npcRolls
    })

  // 0.11.3: pick the weapon, then click the token to attack (rolls only if it's in range).
  const attack = async (a: SheetAttack): Promise<void> => {
    const ex = attackExpressions(sheet, a)
    await attackWith(
      myToken,
      a,
      async (target, dis) => {
        const r = await cf.post<AttackResult>(`/campfire/campaigns/${t.campaign.id}/attack`, {
          attackerTokenId: myToken!.id,
          targetTokenId: target.id,
          attack: {
            id: a.id,
            name: a.name,
            toHit: ex.toHit,
            damage: ex.damage,
            damageType: a.damageType,
            kind: a.kind
          },
          ...(dis ? { advantage: 'dis' } : {}),
          ...(npcRolls ? { visibility: 'gm' } : {})
        })
        if (!r.ok) say(r.message)
        else if (!r.data.hit)
          say(`${a.name} misses ${target.name || 'the target'}${dis ? ' (long range)' : ''}.`)
        else if (r.data.pending === null && r.data.applied === null && !isGm)
          say(`${r.data.crit ? 'Critical hit! ' : 'Hit! '}The game master applies the damage.`)
      },
      async () => {
        await rollNow(ex.toHit, {
          label: `${ch.name}: ${a.name} to hit`,
          characterId: ch.id,
          gmOnly: npcRolls
        })
        await rollNow(ex.damage, {
          label: `${ch.name}: ${a.name} damage`,
          characterId: ch.id,
          gmOnly: npcRolls
        })
      }
    )
  }

  const line =
    [sheet.race, classesLine(sheet)].filter(Boolean).join(' · ') ||
    (ch.kind === 'npc' ? 'NPC' : 'Player character')

  return (
    <div className="cf-sheet">
      <div className="cf-sheet-head">
        <span className="cf-portrait-wrap">
          <Portrait ch={ch} size={64} ring={ch.kind === 'npc' ? 'danger' : 'good'} />
          {canEdit && (
            <button
              type="button"
              className="cf-portrait-change"
              aria-label={`Change ${ch.name}'s portrait`}
              onClick={async () => {
                const file = await pickFile(IMAGE_ACCEPT)
                if (!file) return
                const up = await uploadFile(t.campaign.id, 'portrait', file)
                if (!up.ok) return say(up.message)
                await ed.patchChar({ portraitFileId: up.data.id })
                if (isGm)
                  for (const tk of t.tokens.filter(
                    (x) => x.characterId === ch.id && !x.imageFileId
                  ))
                    void cf.patch(`/campfire/tokens/${tk.id}`, { imageFileId: up.data.id })
              }}
            >
              <SvgIcon name="picture" size={14} />
            </button>
          )}
        </span>
        <div className="cf-sheet-title">
          <h2 className="cf-h2">{ch.name}</h2>
          <span className="cf-sub">{line}</span>
          {ch.ddbUrl && (
            <a className="cf-link" href={ch.ddbUrl} target="_blank" rel="noopener noreferrer">
              Open the D&amp;D Beyond sheet ↗
            </a>
          )}
        </div>
      </div>
      <div className="cf-row-buttons">
        <button type="button" className="cf-primary" onClick={() => openSheet(ch.id)}>
          Open the full sheet
        </button>
        {isGm && sheet.monster && (
          <button
            type="button"
            className="cf-ghost"
            onClick={() => openStatBlock({ characterId: ch.id })}
          >
            Stat block
          </button>
        )}
      </div>
      {ch.kind === 'pc' && (
        <p className="cf-hint">
          Your portrait shows on your token, in the turn order and on your rolls.
        </p>
      )}

      <ShortHp hp={sheet.hp} />
      <div className="cf-stat-row">
        <Stat label="Armor class" value={String(sheet.ac)} />
        <Stat label="Speed" value={`${sheet.speed} ft`} />
        <Stat
          label="Hit dice"
          value={`${sheet.hitDice.reduce((n, h) => n + h.max - h.used, 0)}/${sheet.hitDice.reduce((n, h) => n + h.max, 0)}`}
        />
      </div>

      <div className="cf-abilities">
        {ABILITIES.map((a) => {
          const m = abilityMod(sheet.abilities[a])
          return (
            <div key={a} className="cf-ability">
              <button
                type="button"
                className="cf-ability-roll"
                onClick={() => rollCheck(m, `${ABILITY_NAMES[a]} check`)}
                aria-label={`Roll a ${ABILITY_NAMES[a]} check (${signed(m)})`}
              >
                <span className="cf-ability-name">{a.toUpperCase()}</span>
                <strong>{signed(m)}</strong>
              </button>
              <span className="cf-sub">{sheet.abilities[a]}</span>
            </div>
          )
        })}
      </div>

      <h3 className="cf-h3">Actions</h3>
      <p className="cf-hint">
        {target && myToken
          ? `Attacking ${target.name || 'the target'} (double-click another token to change).`
          : 'Click a weapon, then the token to attack: it rolls if they’re in range. Double-click your own token for its card.'}
      </p>
      <ul className="cf-actions">
        {withTwoHanded(sheet.attacks).map((a) => {
          const ex = attackExpressions(sheet, a)
          return (
            <li key={a.id} className="cf-action">
              <button type="button" className="cf-action-roll" onClick={() => void attack(a)}>
                <span className="cf-action-name">{a.name}</span>
                <span className="cf-action-hit">{ex.toHit.replace(/^1d20/, '') || '+0'}</span>
                <span className="cf-mono">{ex.damage}</span>
                <SvgIcon name="die" />
              </button>
            </li>
          )
        })}
      </ul>
      {sheet.attacks.length === 0 && (
        <p className="cf-hint">No attacks yet: add them in the full sheet (Actions).</p>
      )}
      {sheet.concentration && <p className="cf-hint">Concentrating on {sheet.concentration}.</p>}
      <p className="cf-hint">Tap an action or a stat to roll it.</p>
    </div>
  )
}

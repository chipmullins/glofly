import { useEffect, useRef, useState } from 'react'
import {
  ABILITIES,
  ABILITY_NAMES,
  DAMAGE_TYPES,
  isFullCharacter,
  type Ability,
  type AttackResult,
  type Character,
  type CharacterView,
  type DamageType,
  type Sheet5e,
  type SheetAttack,
  type SkillId,
  type SrdSpellSummary
} from '@glofly/shared/campfire/types'
import {
  abilityMod,
  attackExpressions,
  classLine,
  CONDITIONS,
  initiativeBonus,
  passivePerception,
  saveBonus,
  sheetProf,
  skillBonus,
  SKILL_IDS,
  SKILLS,
  slotsForClasses,
  spellAttackBonus,
  spellSaveDc,
  totalLevel,
  withBonus
} from '@glofly/shared/campfire/rules5e'
import { cf, fileUrl, IMAGE_ACCEPT, pickFile, pieceId, uploadFile } from './api'
import { signed, useCf } from './ctx'
import { NumBox, TextBox } from './ui'
import { colorsFor } from '../lib/avatarColors'

// A fifth edition character sheet (Player board's right side, the GM's Sheet tab): click a stat
// to roll it, attacks roll against the target you picked on the map, spell slots, resources,
// rests, death saves, conditions, concentration, portrait, and a D&D Beyond link (only opened).

const SAVE_DELAY = 700

/** Which character the Sheet tab shows. */
export function SheetPanel(): React.JSX.Element {
  const { t, me, isGm, selectedId, say, ctl } = useCf()
  const selectedToken = selectedId ? t.tokens.find((x) => x.id === selectedId) : null
  const mine = t.characters.filter((c) => c.ownerId === me.id)
  const [pick, setPick] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
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
          <FullSheet key={ch.id} ch={ch} />
        ) : (
          <PublicSheet ch={ch} />
        )
      ) : null}
      {(!mine.length || isGm) && (
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
            {isGm && (
              <button type="button" className="cf-ghost" onClick={() => void create('npc')}>
                New NPC
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

function Portrait({ ch, size = 64 }: { ch: CharacterView; size?: number }): React.JSX.Element {
  const [bg, fg] = colorsFor(ch.id)
  return (
    <span
      className="cf-portrait"
      style={{ width: size, height: size, background: bg, color: fg }}
      aria-hidden="true"
    >
      {ch.portraitFileId ? (
        <img src={fileUrl(ch.portraitFileId)} alt="" />
      ) : (
        (ch.name[0] ?? '?').toUpperCase()
      )}
    </span>
  )
}

function PublicSheet({ ch }: { ch: CharacterView }): React.JSX.Element {
  const s = ch.summary
  return (
    <div className="cf-sheet">
      <div className="cf-sheet-head">
        <Portrait ch={ch} />
        <div>
          <h2 className="cf-h2">{ch.name}</h2>
          <span className="cf-sub">
            {[s.race, s.classLine, s.level ? `Level ${s.level}` : ''].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>
      <div className="cf-stat-row">
        <Stat label="Armor class" value={String(s.ac)} />
        <Stat label="Hit points" value={`${s.hp.current} / ${s.hp.max}`} />
      </div>
      {s.conditions.length > 0 && <p className="cf-hint">Conditions: {s.conditions.join(', ')}</p>}
    </div>
  )
}

function Stat({
  label,
  value,
  onClick
}: {
  label: string
  value: string
  onClick?: () => void
}): React.JSX.Element {
  const inner = (
    <>
      <strong>{value}</strong>
      <span>{label}</span>
    </>
  )
  return onClick ? (
    <button type="button" className="cf-stat" onClick={onClick} title={`Roll ${label}`}>
      {inner}
    </button>
  ) : (
    <div className="cf-stat">{inner}</div>
  )
}

function FullSheet({ ch }: { ch: Character }): React.JSX.Element {
  const { t, isGm, me, roll, say, ctl, targetId, tokenOf, selectedId } = useCf()
  const [sheet, setSheet] = useState<Sheet5e>(ch.sheet)
  const pending = useRef<number | null>(null)
  const dirty = useRef(false)
  const [adv, setAdv] = useState<'adv' | 'dis' | null>(null)
  const canEdit = isGm || ch.ownerId === me.id
  const lockedField = !isGm && sheet.locked

  // A change from the server (damage, rests, another device) shows unless I'm mid-edit.
  useEffect(() => {
    if (!dirty.current) setSheet(ch.sheet)
  }, [ch.sheet])
  useEffect(
    () => () => {
      if (pending.current) window.clearTimeout(pending.current)
    },
    []
  )

  const save = (next: Sheet5e): void => {
    setSheet(next)
    dirty.current = true
    if (pending.current) window.clearTimeout(pending.current)
    pending.current = window.setTimeout(async () => {
      pending.current = null
      const r = await cf.patch<Character>(`/campfire/characters/${ch.id}`, { sheet: next })
      dirty.current = false
      if (!r.ok) say(r.message)
      else
        ctl.update((s) => ({
          ...s,
          characters: s.characters.map((c) => (c.id === ch.id ? r.data : c))
        }))
    }, SAVE_DELAY)
  }
  const set = <K extends keyof Sheet5e>(k: K, v: Sheet5e[K]): void => save({ ...sheet, [k]: v })
  const patchChar = async (body: Record<string, unknown>): Promise<void> => {
    const r = await cf.patch<Character>(`/campfire/characters/${ch.id}`, body)
    if (!r.ok) say(r.message)
    else
      ctl.update((s) => ({
        ...s,
        characters: s.characters.map((c) => (c.id === ch.id ? r.data : c))
      }))
  }

  const d20 = adv === 'adv' ? '2d20kh1' : adv === 'dis' ? '2d20kl1' : '1d20'
  const rollCheck = (bonus: number, label: string): void =>
    void roll(withBonus(d20, bonus), { label: `${ch.name}: ${label}`, characterId: ch.id })
  const myToken =
    tokenOf(ch.id) ??
    (isGm && selectedId ? (t.tokens.find((x) => x.id === selectedId) ?? null) : null)
  const target = targetId ? t.tokens.find((x) => x.id === targetId) : null

  const attack = async (a: SheetAttack): Promise<void> => {
    const ex = attackExpressions(sheet, a)
    if (myToken && target && target.id !== myToken.id) {
      const r = await cf.post<AttackResult>(`/campfire/campaigns/${t.campaign.id}/attack`, {
        attackerTokenId: myToken.id,
        targetTokenId: target.id,
        attack: {
          id: a.id,
          name: a.name,
          toHit: ex.toHit,
          damage: ex.damage,
          damageType: a.damageType,
          kind: a.kind
        },
        ...(adv ? { advantage: adv } : {})
      })
      if (!r.ok) say(r.message)
      else if (r.data.hit && r.data.pending === null && r.data.applied === null && !isGm)
        say(`${r.data.crit ? 'Critical hit! ' : 'Hit! '}The game master applies the damage.`)
      else if (!r.data.hit) say(`${a.name} misses ${target.name || 'the target'}.`)
      return
    }
    // No target picked: just the rolls (to hit, then damage).
    await roll(adv ? ex.toHit.replace(/^1d20/, d20) : ex.toHit, {
      label: `${a.name}: to hit`,
      characterId: ch.id
    })
    await roll(ex.damage, { label: `${a.name}: damage`, characterId: ch.id })
  }

  const prof = sheetProf(sheet)
  const level = totalLevel(sheet)
  const cls = sheet.classes[0]
  const dying =
    ch.kind === 'pc' && sheet.hp.current <= 0 && !sheet.deathSaves.dead && !sheet.deathSaves.stable

  return (
    <div className="cf-sheet">
      <div className="cf-sheet-head">
        <span className="cf-portrait-wrap">
          <Portrait ch={ch} size={68} />
          {canEdit && (
            <button
              type="button"
              className="cf-portrait-change"
              aria-label={`Change ${ch.name}'s portrait`}
              title="Upload portrait"
              onClick={async () => {
                const file = await pickFile(IMAGE_ACCEPT)
                if (!file) return
                const up = await uploadFile(t.campaign.id, 'portrait', file)
                if (!up.ok) return say(up.message)
                await patchChar({ portraitFileId: up.data.id })
                // Its tokens show the portrait too (GMs: tokens without their own picture).
                if (isGm)
                  for (const tk of t.tokens.filter(
                    (x) => x.characterId === ch.id && !x.imageFileId
                  ))
                    void cf.patch(`/campfire/tokens/${tk.id}`, { imageFileId: up.data.id })
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
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="11" r="2" />
                <path d="M21 17l-5-5-9 8" />
              </svg>
            </button>
          )}
        </span>
        <div className="cf-sheet-title">
          {canEdit ? (
            <TextBox
              className="cf-name-box"
              label="Name"
              value={ch.name}
              maxLength={60}
              onChange={(name) => name.trim() && void patchChar({ name: name.trim() })}
            />
          ) : (
            <h2 className="cf-h2">{ch.name}</h2>
          )}
          <span className="cf-sub">
            {[sheet.race, classLine(sheet), level ? `Level ${level}` : '']
              .filter(Boolean)
              .join(' · ') || (ch.kind === 'npc' ? 'NPC' : 'Player character')}
          </span>
          {ch.ddbUrl && (
            <a className="cf-link" href={ch.ddbUrl} target="_blank" rel="noopener noreferrer">
              Open the D&amp;D Beyond sheet ↗
            </a>
          )}
        </div>
      </div>
      {ch.kind === 'pc' && (
        <p className="cf-hint">
          Your portrait shows on your token, in the turn order and on your rolls.
        </p>
      )}

      <div className="cf-hp">
        <div className="cf-hp-head">
          <span>Hit points</span>
          <span className="cf-hp-nums">
            <NumBox
              label="Current hit points"
              value={sheet.hp.current}
              min={-999}
              max={9999}
              disabled={!canEdit}
              onChange={(n) => set('hp', { ...sheet.hp, current: n })}
            />
            <span aria-hidden="true">/</span>
            <NumBox
              label="Most hit points"
              value={sheet.hp.max}
              min={0}
              max={9999}
              disabled={!canEdit || lockedField}
              onChange={(n) => set('hp', { ...sheet.hp, max: n })}
            />
            <span className="cf-sub">temp</span>
            <NumBox
              label="Temporary hit points"
              value={sheet.hp.temp}
              min={0}
              max={999}
              disabled={!canEdit}
              onChange={(n) => set('hp', { ...sheet.hp, temp: n })}
            />
          </span>
        </div>
        <span className="cf-hpbar cf-hpbar--big" aria-hidden="true">
          <span
            style={{
              width: `${sheet.hp.max ? Math.max(0, Math.min(100, (sheet.hp.current / sheet.hp.max) * 100)) : 0}%`
            }}
          />
        </span>
      </div>

      <div className="cf-stat-row">
        <div className="cf-stat">
          <NumBox
            label="Armor class"
            className="cf-stat-num"
            value={sheet.ac}
            min={0}
            max={40}
            disabled={!canEdit || lockedField}
            onChange={(n) => set('ac', n)}
          />
          <span>Armor class</span>
        </div>
        <div className="cf-stat">
          <NumBox
            label="Speed in feet"
            className="cf-stat-num"
            value={sheet.speed}
            min={0}
            max={500}
            disabled={!canEdit}
            onChange={(n) => set('speed', n)}
          />
          <span>Speed (ft)</span>
        </div>
        <Stat
          label="Initiative"
          value={signed(initiativeBonus(sheet))}
          onClick={() => rollCheck(initiativeBonus(sheet), 'initiative')}
        />
      </div>
      <div className="cf-stat-row cf-stat-row--small">
        <Stat label="Proficiency" value={signed(prof)} />
        <Stat label="Passive Perception" value={String(passivePerception(sheet))} />
        <div className="cf-stat">
          <strong>
            {sheet.hitDice.reduce((n, h) => n + h.max - h.used, 0)}/
            {sheet.hitDice.reduce((n, h) => n + h.max, 0)}
          </strong>
          <span>Hit dice</span>
        </div>
      </div>

      <div className="cf-adv" role="radiogroup" aria-label="Advantage">
        {(
          [
            [null, 'Normal'],
            ['adv', 'Advantage'],
            ['dis', 'Disadvantage']
          ] as const
        ).map(([v, label]) => (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={adv === v}
            className={adv === v ? 'cf-chip cf-chip--on' : 'cf-chip'}
            onClick={() => setAdv(v)}
          >
            {label}
          </button>
        ))}
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
              <NumBox
                label={`${ABILITY_NAMES[a]} score`}
                className="cf-ability-score"
                value={sheet.abilities[a]}
                min={1}
                max={30}
                disabled={!canEdit}
                onChange={(n) => set('abilities', { ...sheet.abilities, [a]: n })}
              />
            </div>
          )
        })}
      </div>

      <h3 className="cf-h3">Actions</h3>
      <p className="cf-hint">
        {target && myToken
          ? `Attacking ${target.name || 'the target'} (double-click another token to change).`
          : 'Double-click a token on the map (or Tab to it and press T) to target it; then an attack rolls against it.'}
      </p>
      <ul className="cf-actions">
        {sheet.attacks.map((a) => {
          const ex = attackExpressions(sheet, a)
          const hit = ex.toHit.replace(/^1d20/, '')
          return (
            <li key={a.id} className="cf-action">
              <button type="button" className="cf-action-roll" onClick={() => void attack(a)}>
                <span className="cf-action-name">{a.name}</span>
                <span className="cf-action-hit">{hit || '+0'}</span>
                <span className="cf-mono">{ex.damage}</span>
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
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="cf-x"
                  aria-label={`Remove ${a.name}`}
                  onClick={() =>
                    set(
                      'attacks',
                      sheet.attacks.filter((x) => x.id !== a.id)
                    )
                  }
                >
                  ×
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {canEdit && <AddAttack onAdd={(a) => set('attacks', [...sheet.attacks, a])} />}
      <p className="cf-hint">Tap an action or a stat to roll it.</p>

      <h3 className="cf-h3">Saving throws</h3>
      <div className="cf-grid3">
        {ABILITIES.map((a) => (
          <div key={a} className="cf-check-roll">
            {canEdit && (
              <input
                type="checkbox"
                aria-label={`Proficient in ${ABILITY_NAMES[a]} saves`}
                checked={!!sheet.saves[a]}
                onChange={(e) => set('saves', { ...sheet.saves, [a]: e.target.checked })}
              />
            )}
            <button
              type="button"
              onClick={() => rollCheck(saveBonus(sheet, a), `${ABILITY_NAMES[a]} save`)}
            >
              {a.toUpperCase()} {signed(saveBonus(sheet, a))}
            </button>
          </div>
        ))}
      </div>

      <h3 className="cf-h3">Skills</h3>
      <ul className="cf-skills">
        {SKILL_IDS.map((k: SkillId) => {
          const lvl = sheet.skills[k] ?? 0
          return (
            <li key={k}>
              {canEdit && (
                <button
                  type="button"
                  className={`cf-prof cf-prof--${lvl}`}
                  aria-label={`${SKILLS[k].name}: ${lvl === 2 ? 'expertise' : lvl === 1 ? 'proficient' : 'not proficient'} (change)`}
                  onClick={() =>
                    set('skills', { ...sheet.skills, [k]: ((lvl + 1) % 3) as 0 | 1 | 2 })
                  }
                />
              )}
              <button
                type="button"
                className="cf-skill"
                onClick={() => rollCheck(skillBonus(sheet, k), SKILLS[k].name)}
              >
                <span>{SKILLS[k].name}</span>
                <span className="cf-sub">{SKILLS[k].ability.toUpperCase()}</span>
                <strong>{signed(skillBonus(sheet, k))}</strong>
              </button>
            </li>
          )
        })}
      </ul>

      <Spells sheet={sheet} canEdit={canEdit} save={save} ch={ch} />

      <h3 className="cf-h3">Resources</h3>
      <ul className="cf-resources">
        {sheet.resources.map((r, i) => (
          <li key={r.id}>
            <span className="cf-res-name">{r.name}</span>
            <span className="cf-sub">
              {r.reset === 'short' ? 'short rest' : r.reset === 'long' ? 'long rest' : ''}
            </span>
            <button
              type="button"
              className="cf-ghost cf-small"
              aria-label={`Use one ${r.name}`}
              disabled={!canEdit || r.used >= r.max}
              onClick={() =>
                set(
                  'resources',
                  sheet.resources.map((x, j) => (j === i ? { ...x, used: x.used + 1 } : x))
                )
              }
            >
              {r.max - r.used}/{r.max} · use
            </button>
            {canEdit && (
              <button
                type="button"
                className="cf-x"
                aria-label={`Remove ${r.name}`}
                onClick={() =>
                  set(
                    'resources',
                    sheet.resources.filter((_, j) => j !== i)
                  )
                }
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <InlineAdd
          label="Add a resource (name, how many)"
          placeholder="Second Wind, 1"
          onAdd={(text) => {
            const [name, n] = text.split(',').map((s) => s.trim())
            set('resources', [
              ...sheet.resources,
              {
                id: pieceId('r'),
                name: name.slice(0, 60),
                max: Math.max(1, Math.min(99, Number(n) || 1)),
                used: 0,
                reset: 'short'
              }
            ])
          }}
        />
      )}

      {canEdit && (
        <div className="cf-row-buttons">
          <button
            type="button"
            className="cf-ghost"
            onClick={() => void rest(ch, 'short', ctl, say)}
          >
            Short rest
          </button>
          <button
            type="button"
            className="cf-ghost"
            onClick={() => void rest(ch, 'long', ctl, say)}
          >
            Long rest
          </button>
        </div>
      )}

      {(dying || sheet.deathSaves.successes > 0 || sheet.deathSaves.failures > 0) &&
        ch.kind === 'pc' && (
          <div className="cf-death" aria-label="Death saves">
            <h3 className="cf-h3">Death saves</h3>
            <div className="cf-death-row">
              <span>Successes</span>
              <Pips n={sheet.deathSaves.successes} of={3} on="#57c27a" />
              <span>Failures</span>
              <Pips n={sheet.deathSaves.failures} of={3} on="#ef5a4a" />
            </div>
            {sheet.deathSaves.dead ? (
              <p className="cf-hint">Dead.</p>
            ) : sheet.deathSaves.stable ? (
              <p className="cf-hint">Stable.</p>
            ) : null}
            {dying && canEdit && (
              <button
                type="button"
                className="cf-primary"
                onClick={async () => {
                  const r = await cf.post<{ outcome: string }>(
                    `/campfire/characters/${ch.id}/death-save`
                  )
                  if (!r.ok) say(r.message)
                  else say(`Death save: ${r.data.outcome}.`)
                }}
              >
                Roll a death save
              </button>
            )}
          </div>
        )}

      <h3 className="cf-h3">Conditions</h3>
      <div className="cf-conditions" role="group" aria-label="Conditions">
        {CONDITIONS.filter((c) => c.id !== 'exhaustion').map((c) => {
          const on = sheet.conditions.includes(c.id)
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              disabled={!canEdit}
              className={on ? 'cf-chip cf-chip--on' : 'cf-chip'}
              onClick={() =>
                set(
                  'conditions',
                  on ? sheet.conditions.filter((x) => x !== c.id) : [...sheet.conditions, c.id]
                )
              }
            >
              {c.name}
            </button>
          )
        })}
      </div>
      <div className="cf-field-grid">
        <label className="cf-field">
          <span>Exhaustion</span>
          <NumBox
            label="Exhaustion level"
            value={sheet.exhaustion}
            min={0}
            max={6}
            disabled={!canEdit}
            onChange={(n) => set('exhaustion', n)}
          />
        </label>
        <label className="cf-field">
          <span>Concentrating on</span>
          <TextBox
            label="Concentrating on"
            placeholder="Nothing"
            value={sheet.concentration ?? ''}
            disabled={!canEdit}
            onChange={(s) => set('concentration', s.trim() || null)}
          />
        </label>
      </div>

      {canEdit && (
        <details className="cf-more">
          <summary>Race, class and more</summary>
          <div className="cf-field-grid">
            <label className="cf-field">
              <span>Race</span>
              <TextBox label="Race" value={sheet.race} onChange={(s) => set('race', s)} />
            </label>
            <label className="cf-field">
              <span>Background</span>
              <TextBox
                label="Background"
                value={sheet.background}
                onChange={(s) => set('background', s)}
              />
            </label>
            <label className="cf-field">
              <span>Class</span>
              <TextBox
                label="Class"
                value={cls?.name ?? ''}
                onChange={(s) =>
                  set('classes', [
                    {
                      name: s,
                      level: cls?.level ?? 1,
                      hitDie: cls?.hitDie ?? 8,
                      caster: cls?.caster ?? 'none'
                    },
                    ...sheet.classes.slice(1)
                  ])
                }
              />
            </label>
            <label className="cf-field">
              <span>Level</span>
              <NumBox
                label="Level"
                value={cls?.level ?? 1}
                min={1}
                max={20}
                onChange={(n) => {
                  const classes = [
                    {
                      name: cls?.name ?? 'Adventurer',
                      level: n,
                      hitDie: cls?.hitDie ?? 8,
                      caster: cls?.caster ?? 'none'
                    },
                    ...sheet.classes.slice(1)
                  ]
                  const slots = slotsForClasses(classes)
                  save({
                    ...sheet,
                    classes,
                    hitDice: [
                      {
                        die: classes[0].hitDie,
                        max: n,
                        used: Math.min(n, sheet.hitDice[0]?.used ?? 0)
                      }
                    ],
                    spellcasting:
                      classes[0].caster === 'none'
                        ? sheet.spellcasting
                        : {
                            ...sheet.spellcasting,
                            slots: sheet.spellcasting.slots.map((s, i) => ({
                              max: slots.slots[i] ?? 0,
                              used: Math.min(s.used, slots.slots[i] ?? 0)
                            }))
                          }
                  })
                }}
              />
            </label>
            <label className="cf-field">
              <span>Hit die</span>
              <select
                value={cls?.hitDie ?? 8}
                onChange={(e) =>
                  set('classes', [
                    {
                      name: cls?.name ?? 'Adventurer',
                      level: cls?.level ?? 1,
                      hitDie: Number(e.target.value),
                      caster: cls?.caster ?? 'none'
                    },
                    ...sheet.classes.slice(1)
                  ])
                }
              >
                {[6, 8, 10, 12].map((d) => (
                  <option key={d} value={d}>
                    d{d}
                  </option>
                ))}
              </select>
            </label>
            <label className="cf-field">
              <span>Spellcaster</span>
              <select
                value={cls?.caster ?? 'none'}
                onChange={(e) => {
                  const classes = [
                    {
                      name: cls?.name ?? 'Adventurer',
                      level: cls?.level ?? 1,
                      hitDie: cls?.hitDie ?? 8,
                      caster: e.target.value as 'none'
                    },
                    ...sheet.classes.slice(1)
                  ]
                  const slots = slotsForClasses(classes)
                  save({
                    ...sheet,
                    classes,
                    spellcasting: {
                      ...sheet.spellcasting,
                      slots: sheet.spellcasting.slots.map((s, i) => ({
                        max: slots.slots[i] ?? 0,
                        used: Math.min(s.used, slots.slots[i] ?? 0)
                      }))
                    }
                  })
                }}
              >
                <option value="none">No</option>
                <option value="full">Full caster</option>
                <option value="half">Half caster</option>
                <option value="third">Third caster</option>
                <option value="pact">Pact magic</option>
              </select>
            </label>
            <label className="cf-field">
              <span>Spellcasting ability</span>
              <select
                value={sheet.spellcasting.ability ?? ''}
                onChange={(e) =>
                  set('spellcasting', {
                    ...sheet.spellcasting,
                    ability: (e.target.value || null) as Ability | null
                  })
                }
              >
                <option value="">None</option>
                {ABILITIES.map((a) => (
                  <option key={a} value={a}>
                    {ABILITY_NAMES[a]}
                  </option>
                ))}
              </select>
            </label>
            <label className="cf-field">
              <span>D&amp;D Beyond link</span>
              <TextBox
                label="D&D Beyond character link"
                placeholder="https://www.dndbeyond.com/characters/…"
                value={ch.ddbUrl ?? ''}
                onChange={(s) => void patchChar({ ddbUrl: s.trim() || null })}
              />
            </label>
            {isGm && (
              <label className="cf-check">
                <input
                  type="checkbox"
                  checked={sheet.locked}
                  onChange={(e) => set('locked', e.target.checked)}
                />
                Lock HP max and AC for the player
              </label>
            )}
          </div>
          <label className="cf-field">
            <span>Inventory, features and notes</span>
            <TextBox
              multiline
              label="Notes"
              value={sheet.notes}
              maxLength={20000}
              onChange={(s) => set('notes', s)}
            />
          </label>
          {sheet.monster && (
            <div className="cf-monster">
              <h3 className="cf-h3">Stat block</h3>
              {[
                ...sheet.monster.traits,
                ...sheet.monster.actions,
                ...sheet.monster.legendary,
                ...sheet.monster.reactions
              ].map((f) => (
                <p key={f.id}>
                  <strong>{f.name}.</strong> {f.text}
                </p>
              ))}
            </div>
          )}
        </details>
      )}
    </div>
  )
}

async function rest(
  ch: Character,
  kind: 'short' | 'long',
  ctl: ReturnType<typeof useCf>['ctl'],
  say: (m: string) => void
): Promise<void> {
  const r = await cf.post<Character>(`/campfire/characters/${ch.id}/rest`, { kind })
  if (!r.ok) return say(r.message)
  ctl.update((s) => ({ ...s, characters: s.characters.map((c) => (c.id === ch.id ? r.data : c)) }))
  say(kind === 'short' ? 'Short rest taken.' : 'Long rest taken: back to full.')
}

function Pips({ n, of, on }: { n: number; of: number; on: string }): React.JSX.Element {
  return (
    <span className="cf-pips" aria-label={`${n} of ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} style={{ background: i < n ? on : 'rgba(255,255,255,0.12)' }} />
      ))}
    </span>
  )
}

function InlineAdd({
  label,
  placeholder,
  onAdd
}: {
  label: string
  placeholder: string
  onAdd: (text: string) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  return (
    <form
      className="cf-inline-add"
      onSubmit={(e) => {
        e.preventDefault()
        if (!text.trim()) return
        onAdd(text.trim())
        setText('')
      }}
    >
      <input
        aria-label={label}
        placeholder={placeholder}
        value={text}
        maxLength={80}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="cf-ghost cf-small">
        Add
      </button>
    </form>
  )
}

function AddAttack({ onAdd }: { onAdd: (a: SheetAttack) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [ability, setAbility] = useState<Ability | 'spell'>('str')
  const [damage, setDamage] = useState('1d8')
  const [type, setType] = useState<DamageType>('slashing')
  const [kind, setKind] = useState<'melee' | 'ranged' | 'spell'>('melee')
  if (!open)
    return (
      <button type="button" className="cf-ghost cf-small" onClick={() => setOpen(true)}>
        + Add an attack
      </button>
    )
  return (
    <form
      className="cf-add-attack"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !/^\d*d\d+([+-]\d+)?$/i.test(damage.trim())) return
        onAdd({
          id: pieceId('a'),
          name: name.trim().slice(0, 60),
          kind,
          ability,
          proficient: true,
          bonus: 0,
          fixedToHit: null,
          damage: damage.trim(),
          damageAbility: kind !== 'spell',
          damageType: type,
          range: '',
          notes: ''
        })
        setOpen(false)
        setName('')
      }}
    >
      <input
        aria-label="Attack name"
        placeholder="Longsword"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
      />
      <select
        aria-label="Attack type"
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
      >
        <option value="melee">Melee</option>
        <option value="ranged">Ranged</option>
        <option value="spell">Spell</option>
      </select>
      <select
        aria-label="Ability"
        value={ability}
        onChange={(e) => setAbility(e.target.value as Ability | 'spell')}
      >
        {ABILITIES.map((a) => (
          <option key={a} value={a}>
            {a.toUpperCase()}
          </option>
        ))}
        <option value="spell">Spellcasting</option>
      </select>
      <input
        aria-label="Damage dice"
        placeholder="1d8"
        value={damage}
        onChange={(e) => setDamage(e.target.value)}
        maxLength={20}
      />
      <select
        aria-label="Damage type"
        value={type}
        onChange={(e) => setType(e.target.value as DamageType)}
      >
        {DAMAGE_TYPES.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button type="submit" className="cf-primary cf-small">
        Add
      </button>
    </form>
  )
}

function Spells({
  sheet,
  canEdit,
  save,
  ch
}: {
  sheet: Sheet5e
  canEdit: boolean
  save: (s: Sheet5e) => void
  ch: Character
}): React.JSX.Element | null {
  const { t, roll, say, targetId, tokenOf, isGm, selectedId } = useCf()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<SrdSpellSummary[]>([])
  const [saveForm, setSaveForm] = useState<{
    ability: Ability
    damage: string
    half: boolean
  } | null>(null)
  const sc = sheet.spellcasting
  const caster = !!sc.ability || sc.slots.some((s) => s.max > 0) || sc.spells.length > 0
  if (!caster && !canEdit) return null
  const search = async (text: string): Promise<void> => {
    setQ(text)
    if (text.trim().length < 2) return setFound([])
    const r = await cf.get<{ spells: SrdSpellSummary[] }>(
      `/campfire/srd/spells?q=${encodeURIComponent(text.trim())}`
    )
    if (r.ok) setFound(r.data.spells.slice(0, 8))
  }
  const caster2 =
    tokenOf(ch.id) ??
    (isGm && selectedId ? (t.tokens.find((x) => x.id === selectedId) ?? null) : null)
  return (
    <>
      <h3 className="cf-h3">Spells</h3>
      {sc.ability && (
        <div className="cf-stat-row cf-stat-row--small">
          <Stat
            label="Spell attack"
            value={signed(spellAttackBonus(sheet))}
            onClick={() =>
              void roll(withBonus('1d20', spellAttackBonus(sheet)), {
                label: `${ch.name}: spell attack`,
                characterId: ch.id
              })
            }
          />
          <Stat label="Spell save DC" value={String(spellSaveDc(sheet))} />
        </div>
      )}
      <div className="cf-slots">
        {sc.slots.map((s, i) =>
          s.max > 0 ? (
            <div key={i} className="cf-slot">
              <span className="cf-sub">Level {i + 1}</span>
              <span
                className="cf-pips"
                role="group"
                aria-label={`Level ${i + 1} slots: ${s.max - s.used} of ${s.max} left`}
              >
                {Array.from({ length: s.max }, (_, j) => (
                  <button
                    key={j}
                    type="button"
                    disabled={!canEdit}
                    aria-label={j < s.used ? 'Used slot (give it back)' : 'Slot (use it)'}
                    style={{ background: j < s.used ? 'rgba(255,255,255,0.12)' : '#cfa8ff' }}
                    onClick={() =>
                      save({
                        ...sheet,
                        spellcasting: {
                          ...sc,
                          slots: sc.slots.map((x, k) =>
                            k === i ? { ...x, used: j < x.used ? j : j + 1 } : x
                          )
                        }
                      })
                    }
                  />
                ))}
              </span>
            </div>
          ) : null
        )}
        {sc.pact && sc.pact.max > 0 && (
          <div className="cf-slot">
            <span className="cf-sub">Pact (level {sc.pact.level})</span>
            <span>
              {sc.pact.max - sc.pact.used}/{sc.pact.max}
            </span>
          </div>
        )}
      </div>
      <ul className="cf-spells">
        {sc.spells.map((sp, i) => (
          <li key={`${sp.name}-${i}`}>
            <span>{sp.name}</span>
            <span className="cf-sub">{sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`}</span>
            {canEdit && (
              <button
                type="button"
                className="cf-x"
                aria-label={`Remove ${sp.name}`}
                onClick={() =>
                  save({
                    ...sheet,
                    spellcasting: { ...sc, spells: sc.spells.filter((_, j) => j !== i) }
                  })
                }
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="cf-spell-search">
          <input
            aria-label="Find a spell in the compendium"
            placeholder="Add a spell: search the compendium"
            value={q}
            onChange={(e) => void search(e.target.value)}
          />
          {found.length > 0 && (
            <ul className="cf-menu-list">
              {found.map((s) => (
                <li key={s.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      save({
                        ...sheet,
                        spellcasting: {
                          ...sc,
                          spells: [
                            ...sc.spells,
                            { slug: s.slug, name: s.name, level: s.level, prepared: true }
                          ]
                        }
                      })
                      setFound([])
                      setQ('')
                    }}
                  >
                    {s.name}{' '}
                    <span className="cf-sub">
                      {s.level === 0 ? 'cantrip' : `level ${s.level}`} · {s.school}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {sc.ability && canEdit && caster2 && (
        <div className="cf-save-spell">
          {!saveForm ? (
            <button
              type="button"
              className="cf-ghost cf-small"
              disabled={!targetId}
              title={targetId ? '' : 'Target a token first'}
              onClick={() => setSaveForm({ ability: 'dex', damage: '2d8', half: true })}
            >
              Cast a spell with a saving throw…
            </button>
          ) : (
            <form
              className="cf-add-attack"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!targetId) return
                const r = await cf.post(`/campfire/campaigns/${t.campaign.id}/save-spell`, {
                  casterTokenId: caster2.id,
                  targetTokenIds: [targetId],
                  dc: spellSaveDc(sheet),
                  ability: saveForm.ability,
                  damage: saveForm.damage,
                  half: saveForm.half,
                  name: 'Spell'
                })
                if (!r.ok) say(r.message)
                setSaveForm(null)
              }}
            >
              <span className="cf-sub">DC {spellSaveDc(sheet)}</span>
              <select
                aria-label="Saving throw"
                value={saveForm.ability}
                onChange={(e) => setSaveForm({ ...saveForm, ability: e.target.value as Ability })}
              >
                {ABILITIES.map((a) => (
                  <option key={a} value={a}>
                    {a.toUpperCase()} save
                  </option>
                ))}
              </select>
              <input
                aria-label="Damage dice"
                value={saveForm.damage}
                onChange={(e) => setSaveForm({ ...saveForm, damage: e.target.value })}
              />
              <label className="cf-check">
                <input
                  type="checkbox"
                  checked={saveForm.half}
                  onChange={(e) => setSaveForm({ ...saveForm, half: e.target.checked })}
                />
                Half on a save
              </label>
              <button type="submit" className="cf-primary cf-small">
                Cast
              </button>
            </form>
          )}
        </div>
      )}
    </>
  )
}

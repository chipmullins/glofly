import { useEffect, useMemo, useRef, useState } from 'react'
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
  type SheetSpell,
  type SrdSpell,
  type SrdSpellSummary
} from '@glofly/shared/campfire/types'
import {
  abilityMod,
  applyDamage,
  attackExpressions,
  CONDITIONS,
  EXHAUSTION_LEVELS,
  heal,
  initiativeBonus,
  nextLevelXp,
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
import { SRD_CREDIT } from '@glofly/shared/campfire/types'
import { tokenCenter } from '@glofly/shared/campfire/map'
import { cf, IMAGE_ACCEPT, pickFile, pieceId, uploadFile } from './api'
import { signed, useCf } from './ctx'
import { NumBox, TextBox } from './ui'
import {
  classesLine,
  spellFromSrd,
  spellLine,
  thousands,
  useRollNow,
  useSheetEditor,
  withD20,
  type RollWith,
  type SheetEditor
} from './sheetCore'
import { CfWindow, Portrait, SvgIcon } from './sheetBits'
import { InventoryTab } from './Inventory'
import { rulesOf } from '@glofly/shared/campfire/rulesData'
import { LevelUp } from './LevelUp'
import './sheet.css'

// The character sheet as a window over the table (approved boards SheetOverview / SheetActions):
// header (portrait, name, race · class · background · alignment, XP, D&D Beyond link, who plays
// it, rests), the vitals strip (AC, HP with temp HP and Damage/Heal/Temp, Initiative, Speed,
// Proficiency, Hit dice), the concentration banner, six tabs and "Roll with" for every roll.

type SheetTab = 'overview' | 'actions' | 'spells' | 'features' | 'inventory' | 'notes'
const TABS: { id: SheetTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'actions', label: 'Actions' },
  { id: 'spells', label: 'Spells' },
  { id: 'features', label: 'Features' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'notes', label: 'Notes' }
]

export function SheetWindow({
  characterId,
  onClose
}: {
  characterId: string
  onClose: () => void
}): React.JSX.Element | null {
  const { t } = useCf()
  const ch = t.characters.find((c) => c.id === characterId)
  if (!ch) return null
  return isFullCharacter(ch) ? (
    <FullSheetWindow ch={ch} onClose={onClose} />
  ) : (
    <PublicSheetWindow ch={ch} onClose={onClose} />
  )
}

/** Another player's character: what everyone at the table sees. */
function PublicSheetWindow({
  ch,
  onClose
}: {
  ch: CharacterView
  onClose: () => void
}): React.JSX.Element {
  const { nameOf } = useCf()
  const s = ch.summary
  return (
    <CfWindow label={`${ch.name}'s sheet`} onClose={onClose} className="cfs-window--small">
      <header className="cfs-head">
        <Portrait ch={ch} size={72} />
        <div className="cfs-title">
          <h2>{ch.name}</h2>
          <span className="cfs-line">
            {[s.race, s.classLine].filter(Boolean).join(' · ') || 'Player character'}
          </span>
          {ch.ownerId && (
            <span className="cfs-pill cfs-pill--good">Played by {nameOf(ch.ownerId)}</span>
          )}
        </div>
        <div className="cfs-head-buttons">
          <CloseButton onClose={onClose} />
        </div>
      </header>
      <div className="cfs-body">
        <div className="cfs-vitals">
          <div className="cfs-vital">
            <SvgIcon name="shield" />
            <strong className="cfs-big">{s.ac}</strong>
            <span>Armor class</span>
          </div>
          <div className="cfs-vital cfs-vital--hp">
            <HpLine hp={s.hp} />
          </div>
        </div>
        {s.conditions.length > 0 && (
          <p className="cfs-hint">
            Conditions:{' '}
            {s.conditions.map((c) => CONDITIONS.find((x) => x.id === c)?.name ?? c).join(', ')}
          </p>
        )}
      </div>
    </CfWindow>
  )
}

function CloseButton({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <button type="button" className="cfs-close" aria-label="Close sheet" onClick={onClose}>
      ×
    </button>
  )
}

function HpLine({ hp }: { hp: { current: number; max: number; temp: number } }): React.JSX.Element {
  const max = Math.max(1, hp.max)
  const cur = Math.max(0, Math.min(100, (hp.current / max) * 100))
  const temp = Math.max(0, Math.min(100 - cur, (hp.temp / max) * 100))
  const tone = hp.current <= 0 ? 'down' : hp.current <= hp.max / 2 ? 'bloodied' : 'good'
  return (
    <>
      <div className="cfs-hp-top">
        <span className="cfs-label">Hit points</span>
        <strong className="cfs-hp-now">{hp.current}</strong>
        <span className="cfs-hp-max">/ {hp.max}</span>
        {hp.temp > 0 && <span className="cfs-pill cfs-pill--temp">+{hp.temp} temp</span>}
      </div>
      <div
        className="cfs-hpbar"
        role="img"
        aria-label={`${hp.current} of ${hp.max} hit points${hp.temp ? `, ${hp.temp} temporary` : ''}`}
      >
        <span className={`cfs-hpbar-hp cfs-hpbar-hp--${tone}`} style={{ width: `${cur}%` }} />
        <span className="cfs-hpbar-temp" style={{ width: `${temp}%` }} />
      </div>
    </>
  )
}

function FullSheetWindow({
  ch,
  onClose
}: {
  ch: Character
  onClose: () => void
}): React.JSX.Element {
  const ed = useSheetEditor(ch)
  const { sheet, canEdit } = ed
  const { t, isGm, nameOf, say, ctl, tokenOf, me } = useCf()
  const rollNow = useRollNow()
  const [tab, setTab] = useState<SheetTab>('overview')
  const [leveling, setLeveling] = useState(false)
  const [rollWith, setRollWith] = useState<RollWith>('normal')
  const [amount, setAmount] = useState('')
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const rollCheck = (bonus: number, label: string): void =>
    void rollNow(withD20(withBonus('1d20', bonus), rollWith), {
      label: `${ch.name}: ${label}${rollWith === 'adv' ? ' (advantage)' : rollWith === 'dis' ? ' (disadvantage)' : ''}`,
      characterId: ch.id
    })

  const level = totalLevel(sheet)
  const next = ch.kind === 'pc' ? nextLevelXp(Math.max(1, level)) : null
  const line = [sheet.race, classesLine(sheet), sheet.background, sheet.alignment]
    .filter(Boolean)
    .join(' · ')
  const hitDiceLeft = sheet.hitDice.reduce((n, h) => n + h.max - h.used, 0)
  const hitDiceMax = sheet.hitDice.reduce((n, h) => n + h.max, 0)
  const token = tokenOf(ch.id)
  const mayUseToken =
    !!token && (isGm || token.controlledBy.includes(me.id) || ch.ownerId === me.id)

  const rest = async (kind: 'short' | 'long'): Promise<void> => {
    await ed.flush()
    const r = await cf.post<Character>(`/campfire/characters/${ch.id}/rest`, { kind })
    if (!r.ok) return say(r.message)
    ctl.update((s) => ({
      ...s,
      characters: s.characters.map((c) => (c.id === ch.id ? r.data : c))
    }))
    say(
      kind === 'short'
        ? `${ch.name} takes a short rest.`
        : `${ch.name} takes a long rest: back to full.`
    )
  }

  const hpAction = async (kind: 'damage' | 'heal' | 'temp'): Promise<void> => {
    const n = Math.floor(Number(amount))
    if (!Number.isFinite(n) || n <= 0) return say('Type an amount first.')
    setAmount('')
    if (kind === 'temp') {
      // Temporary hit points don't add up: you keep the bigger number.
      return ed.set('hp', { ...sheet.hp, temp: Math.max(sheet.hp.temp, Math.min(999, n)) })
    }
    if (mayUseToken && token) {
      // Through the token: the bar, the animation, concentration and death save rules.
      await ed.flush()
      const r = await cf.post(`/campfire/tokens/${token.id}/${kind}`, { amount: n })
      if (!r.ok) say(r.message)
      return
    }
    if (kind === 'heal') {
      if (sheet.deathSaves.dead) return say(`${ch.name} is dead; healing doesn't bring them back.`)
      return ed.set('hp', { ...sheet.hp, current: heal(sheet.hp.current, sheet.hp.max, n) })
    }
    const out = applyDamage(sheet.hp.current, sheet.hp.temp, n, {})
    ed.set('hp', { ...sheet.hp, current: out.hp, temp: out.temp })
  }

  const spendHitDie = async (): Promise<void> => {
    const die = [...sheet.hitDice].sort((a, b) => b.die - a.die).find((d) => d.used < d.max)
    if (!die) return say('No hit dice left. A long rest brings half of them back.')
    const r = await rollNow(withBonus(`1d${die.die}`, abilityMod(sheet.abilities.con)), {
      label: `${ch.name}: hit die`,
      characterId: ch.id
    })
    if (!r) return
    ed.save({
      ...sheet,
      hitDice: sheet.hitDice.map((d) => (d.die === die.die ? { ...d, used: d.used + 1 } : d)),
      hp: { ...sheet.hp, current: heal(sheet.hp.current, sheet.hp.max, Math.max(0, r.total)) }
    })
  }

  const changePortrait = async (): Promise<void> => {
    const file = await pickFile(IMAGE_ACCEPT)
    if (!file) return
    const up = await uploadFile(t.campaign.id, 'portrait', file)
    if (!up.ok) return say(up.message)
    await ed.patchChar({ portraitFileId: up.data.id })
    // Its tokens show the portrait too (GMs: tokens without their own picture).
    if (isGm)
      for (const tk of t.tokens.filter((x) => x.characterId === ch.id && !x.imageFileId))
        void cf.patch(`/campfire/tokens/${tk.id}`, { imageFileId: up.data.id })
  }

  const onTabKey = (e: React.KeyboardEvent, i: number): void => {
    const n = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!n) return
    e.preventDefault()
    const j = (i + n + TABS.length) % TABS.length
    setTab(TABS[j].id)
    tabRefs.current[j]?.focus()
  }

  if (leveling) return <LevelUp ch={ch} onClose={() => setLeveling(false)} />
  return (
    <CfWindow label={`${ch.name}'s sheet`} onClose={onClose} className="cfs-window--sheet">
      <header className="cfs-head">
        <div className="cfs-portrait-wrap">
          <Portrait ch={ch} size={72} />
          {canEdit && (
            <button
              type="button"
              className="cfs-portrait-change"
              aria-label="Change portrait"
              onClick={() => void changePortrait()}
            >
              <SvgIcon name="picture" size={14} />
            </button>
          )}
        </div>
        <div className="cfs-title">
          <h2>{ch.name}</h2>
          <span className="cfs-line">
            {line || (ch.kind === 'npc' ? 'NPC' : 'Player character')}
          </span>
          <div className="cfs-meta">
            {ch.kind === 'pc' && (
              <span className="cfs-muted">
                XP {thousands(sheet.xp ?? 0)}
                {next !== null ? ` / ${thousands(next)}` : ''}
              </span>
            )}
            {ch.ddbUrl && (
              <a className="cfs-link" href={ch.ddbUrl} target="_blank" rel="noopener noreferrer">
                D&amp;D Beyond sheet ↗
              </a>
            )}
            {ch.ownerId ? (
              <span className="cfs-pill cfs-pill--good">
                Played by {ch.ownerId === me.id ? 'you' : nameOf(ch.ownerId)}
              </span>
            ) : (
              <span className="cfs-pill">NPC · game masters only</span>
            )}
          </div>
        </div>
        <div className="cfs-head-buttons">
          {canEdit && ch.kind === 'pc' && (sheet.classes[0]?.level ?? 1) < 20 && (
            <button
              type="button"
              className="cfs-button"
              onClick={async () => {
                await ed.flush()
                setLeveling(true)
              }}
            >
              Level up
            </button>
          )}
          {canEdit && (
            <>
              <button type="button" className="cfs-button" onClick={() => void rest('short')}>
                Short rest
              </button>
              <button type="button" className="cfs-button" onClick={() => void rest('long')}>
                Long rest
              </button>
            </>
          )}
          <CloseButton onClose={onClose} />
        </div>
      </header>

      <div className="cfs-body">
        <div className="cfs-vitals">
          <div className="cfs-vital">
            <SvgIcon name="shield" />
            <strong className="cfs-big">{sheet.ac}</strong>
            <span>Armor class</span>
            {sheet.acNote && <span className="cfs-small">{sheet.acNote}</span>}
          </div>
          <div className="cfs-vital cfs-vital--hp">
            <HpLine hp={sheet.hp} />
            {canEdit && (
              <form
                className="cfs-hp-tools"
                onSubmit={(e) => {
                  e.preventDefault()
                  void hpAction('damage')
                }}
              >
                <label className="cfs-amount">
                  <span className="cf-sr">Amount</span>
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="Amount"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="cfs-hp-button cfs-hp-button--damage"
                  onClick={() => void hpAction('damage')}
                >
                  Damage
                </button>
                <button
                  type="button"
                  className="cfs-hp-button cfs-hp-button--heal"
                  onClick={() => void hpAction('heal')}
                >
                  Heal
                </button>
                <button
                  type="button"
                  className="cfs-hp-button cfs-hp-button--temp"
                  onClick={() => void hpAction('temp')}
                >
                  Temp
                </button>
              </form>
            )}
          </div>
          <button
            type="button"
            className="cfs-vital cfs-vital--button"
            aria-label={`Roll initiative (${signed(initiativeBonus(sheet))})`}
            onClick={() => rollCheck(initiativeBonus(sheet), 'initiative')}
          >
            <SvgIcon name="die" />
            <strong>{signed(initiativeBonus(sheet))}</strong>
            <span>Initiative</span>
            <span className="cfs-small">tap to roll</span>
          </button>
          <div className="cfs-vital">
            <SvgIcon name="boot" />
            <strong>{sheet.speed} ft</strong>
            <span>Speed</span>
            {sheet.otherSpeeds && <span className="cfs-small">{sheet.otherSpeeds}</span>}
          </div>
          <div className="cfs-vital">
            <strong>{signed(sheetProf(sheet))}</strong>
            <span>Proficiency</span>
          </div>
          <button
            type="button"
            className="cfs-vital cfs-vital--button"
            disabled={!canEdit || hitDiceLeft <= 0}
            aria-label={`Hit dice: ${hitDiceLeft} of ${hitDiceMax} left. Spend one to heal`}
            title="Spend a hit die (rolls it plus your Constitution and heals that much)"
            onClick={() => void spendHitDie()}
          >
            <SvgIcon name="heart" />
            <strong>
              {hitDiceLeft}/{hitDiceMax}
            </strong>
            <span>Hit dice</span>
            <span className="cfs-small">
              {sheet.hitDice.map((d) => `d${d.die}`).join(' + ') || '—'}
            </span>
          </button>
        </div>

        <div className="cfs-tabbar">
          <div role="tablist" aria-label="Sheet sections" className="cfs-tabs">
            {TABS.map((x, i) => (
              <button
                key={x.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`cfs-tab-${x.id}`}
                aria-controls="cfs-panel"
                aria-selected={tab === x.id}
                tabIndex={tab === x.id ? 0 : -1}
                className={tab === x.id ? 'cfs-tab cfs-tab--on' : 'cfs-tab'}
                onClick={() => setTab(x.id)}
                onKeyDown={(e) => onTabKey(e, i)}
              >
                {x.label}
              </button>
            ))}
          </div>
          <span className="cfs-muted cfs-rollwith-label" id="cfs-rollwith">
            Roll with
          </span>
          <div role="radiogroup" aria-labelledby="cfs-rollwith" className="cfs-seg">
            {(
              [
                ['normal', 'Normal'],
                ['adv', 'Advantage'],
                ['dis', 'Disadvantage']
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={rollWith === v}
                className={rollWith === v ? 'cfs-seg-button cfs-seg-button--on' : 'cfs-seg-button'}
                onClick={() => setRollWith(v)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {sheet.concentration && (tab === 'overview' || tab === 'spells') && (
          <div className="cfs-conc" role="status">
            <SvgIcon name="target" size={18} />
            <span className="cfs-conc-text">
              <b>Concentrating on {sheet.concentration}</b>{' '}
              <span className="cfs-muted">· taking damage asks for a Constitution save</span>
            </span>
            {canEdit && (
              <button
                type="button"
                className="cfs-conc-end"
                onClick={() => ed.set('concentration', null)}
              >
                End
              </button>
            )}
          </div>
        )}

        <div
          id="cfs-panel"
          role="tabpanel"
          aria-labelledby={`cfs-tab-${tab}`}
          className="cfs-panel"
        >
          {tab === 'overview' ? (
            <Overview ch={ch} ed={ed} rollCheck={rollCheck} />
          ) : tab === 'actions' ? (
            <div className="cfs-grid2">
              <ActionsSection ch={ch} ed={ed} rollWith={rollWith} />
              <SpellsSection ch={ch} ed={ed} rollWith={rollWith} />
            </div>
          ) : tab === 'spells' ? (
            <SpellsSection ch={ch} ed={ed} rollWith={rollWith} wide />
          ) : tab === 'features' ? (
            <FeaturesTab ed={ed} />
          ) : tab === 'inventory' ? (
            <InventoryTab ed={ed} />
          ) : (
            <NotesTab ch={ch} ed={ed} />
          )}
        </div>
      </div>
    </CfWindow>
  )
}

// ───────────── Overview ─────────────

const COMMON_CONDITIONS: string[] = [
  'blinded',
  'charmed',
  'frightened',
  'grappled',
  'poisoned',
  'prone',
  'restrained',
  'stunned'
]

function Section({
  title,
  aside,
  children,
  className
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={`cfs-section ${className ?? ''}`} aria-label={title}>
      <div className="cfs-section-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function EditToggle({
  on,
  set,
  what
}: {
  on: boolean
  set: (v: boolean) => void
  what: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="cfs-edit-toggle"
      aria-pressed={on}
      aria-label={on ? `Done changing ${what}` : `Change ${what}`}
      onClick={() => set(!on)}
    >
      {on ? 'Done' : 'Edit'}
    </button>
  )
}

function Dot({ level }: { level: 0 | 1 | 2 }): React.JSX.Element {
  return <span aria-hidden="true" className={`cfs-dot cfs-dot--${level}`} />
}

function Overview({
  ch,
  ed,
  rollCheck
}: {
  ch: Character
  ed: SheetEditor
  rollCheck: (bonus: number, label: string) => void
}): React.JSX.Element {
  const { sheet, set, canEdit } = ed
  const { say } = useCf()
  const [editAbilities, setEditAbilities] = useState(false)
  const [editSaves, setEditSaves] = useState(false)
  const [editSkills, setEditSkills] = useState(false)
  const [allConditions, setAllConditions] = useState(false)
  const shownConditions = CONDITIONS.filter((c) => c.id !== 'exhaustion')
  // The common ones first (as on the board); the rest behind "+ N more" unless they're on.
  const firstConditions = shownConditions.filter((c) => COMMON_CONDITIONS.includes(c.id))
  const rest = shownConditions.filter((c) => !COMMON_CONDITIONS.includes(c.id))
  const conditionList = allConditions
    ? shownConditions
    : [...firstConditions, ...rest.filter((c) => sheet.conditions.includes(c.id))]
  const hidden = shownConditions.length - conditionList.length + 1 // + exhaustion
  const dying =
    ch.kind === 'pc' && sheet.hp.current <= 0 && !sheet.deathSaves.dead && !sheet.deathSaves.stable

  const toggleCondition = (id: (typeof CONDITIONS)[number]['id']): void => {
    const on = sheet.conditions.includes(id)
    set('conditions', on ? sheet.conditions.filter((x) => x !== id) : [...sheet.conditions, id])
  }

  return (
    <div className="cfs-grid2 cfs-grid2--overview">
      <div className="cfs-col">
        <Section
          title="Abilities"
          aside={
            <>
              <span className="cfs-muted cfs-small">tap to roll a check</span>
              {canEdit && (
                <EditToggle on={editAbilities} set={setEditAbilities} what="ability scores" />
              )}
            </>
          }
        >
          <div className="cfs-abilities">
            {ABILITIES.map((a) => {
              const m = abilityMod(sheet.abilities[a])
              return editAbilities ? (
                <label key={a} className="cfs-ability cfs-ability--edit">
                  <span className="cfs-ability-name">{a.toUpperCase()}</span>
                  <strong>{signed(m)}</strong>
                  <NumBox
                    label={`${ABILITY_NAMES[a]} score`}
                    className="cfs-ability-input"
                    value={sheet.abilities[a]}
                    min={1}
                    max={30}
                    onChange={(n) => set('abilities', { ...sheet.abilities, [a]: n })}
                  />
                </label>
              ) : (
                <button
                  key={a}
                  type="button"
                  className="cfs-ability"
                  aria-label={`Roll ${a.toUpperCase()} check (${signed(m)})`}
                  onClick={() => rollCheck(m, `${ABILITY_NAMES[a]} check`)}
                >
                  <span className="cfs-ability-name">{a.toUpperCase()}</span>
                  <strong>{signed(m)}</strong>
                  <span className="cfs-ability-score">{sheet.abilities[a]}</span>
                </button>
              )
            })}
          </div>
        </Section>

        <Section
          title="Saving throws"
          aside={
            canEdit && (
              <EditToggle on={editSaves} set={setEditSaves} what="saving throw proficiencies" />
            )
          }
        >
          <ul className="cfs-rows cfs-rows--2">
            {ABILITIES.map((a) => {
              const b = saveBonus(sheet, a)
              const prof = !!sheet.saves[a]
              return (
                <li key={a}>
                  <button
                    type="button"
                    className="cfs-row-button"
                    aria-pressed={editSaves ? prof : undefined}
                    aria-label={
                      editSaves
                        ? `${ABILITY_NAMES[a]} saves: ${prof ? 'proficient' : 'not proficient'}`
                        : `Roll ${ABILITY_NAMES[a]} save (${signed(b)}${prof ? ', proficient' : ''})`
                    }
                    onClick={() =>
                      editSaves
                        ? set('saves', { ...sheet.saves, [a]: !prof })
                        : rollCheck(b, `${ABILITY_NAMES[a]} save`)
                    }
                  >
                    <Dot level={prof ? 1 : 0} />
                    <span className="cfs-row-name">{a.toUpperCase()}</span>
                    <span className={prof ? 'cfs-row-num cfs-row-num--prof' : 'cfs-row-num'}>
                      {signed(b)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section title="Conditions">
          <div className="cfs-chips" role="group" aria-label="Conditions">
            {conditionList.map((c) => {
              const on = sheet.conditions.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit}
                  className={on ? 'cfs-chip cfs-chip--on' : 'cfs-chip'}
                  onClick={() => toggleCondition(c.id)}
                >
                  {c.name}
                </button>
              )
            })}
            {!allConditions ? (
              <button
                type="button"
                className="cfs-chip"
                aria-expanded={false}
                onClick={() => setAllConditions(true)}
              >
                + {hidden} more
              </button>
            ) : (
              <label className="cfs-chip cfs-chip--field">
                Exhaustion
                <select
                  aria-label="Exhaustion level"
                  value={sheet.exhaustion}
                  disabled={!canEdit}
                  onChange={(e) => set('exhaustion', Number(e.target.value))}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'None' : `${n}: ${EXHAUSTION_LEVELS[n - 1]}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {!allConditions && sheet.exhaustion > 0 && (
              <span className="cfs-chip cfs-chip--on">Exhaustion {sheet.exhaustion}</span>
            )}
          </div>
          {ch.kind === 'pc' && (
            <div className="cfs-death" aria-label="Death saves">
              <span className="cfs-muted">Death saves</span>
              <span className="cfs-death-set">
                <b className="cfs-good">Successes</b>
                <Pips n={sheet.deathSaves.successes} tone="good" label="successes" />
              </span>
              <span className="cfs-death-set">
                <b className="cfs-bad">Failures</b>
                <Pips n={sheet.deathSaves.failures} tone="bad" label="failures" />
              </span>
              {dying && canEdit ? (
                <button
                  type="button"
                  className="cfs-button cfs-button--accent cfs-button--small"
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
              ) : (
                <span className="cfs-muted">
                  {sheet.deathSaves.dead
                    ? 'Dead.'
                    : sheet.deathSaves.stable
                      ? 'Stable.'
                      : 'Rolled here when you’re at 0 HP'}
                </span>
              )}
            </div>
          )}
        </Section>
      </div>

      <div className="cfs-col">
        <Section
          title="Skills"
          aside={
            <>
              <span className="cfs-legend" aria-hidden="true">
                <span>
                  <Dot level={1} />
                  proficient
                </span>
                <span>
                  <Dot level={2} />
                  expertise
                </span>
              </span>
              {canEdit && (
                <EditToggle on={editSkills} set={setEditSkills} what="skill proficiencies" />
              )}
            </>
          }
        >
          <ul className="cfs-rows cfs-rows--2">
            {SKILL_IDS.map((k) => {
              const lvl = (sheet.skills[k] ?? 0) as 0 | 1 | 2
              const b = skillBonus(sheet, k)
              const what = lvl === 2 ? 'expertise' : lvl === 1 ? 'proficient' : 'not proficient'
              return (
                <li key={k}>
                  <button
                    type="button"
                    className="cfs-row-button"
                    aria-label={
                      editSkills
                        ? `${SKILLS[k].name}: ${what} (change)`
                        : `Roll ${SKILLS[k].name} (${signed(b)}${lvl ? `, ${what}` : ''})`
                    }
                    onClick={() =>
                      editSkills
                        ? set('skills', { ...sheet.skills, [k]: ((lvl + 1) % 3) as 0 | 1 | 2 })
                        : rollCheck(b, SKILLS[k].name)
                    }
                  >
                    <Dot level={lvl} />
                    <span className="cfs-row-name">
                      {SKILLS[k].name}{' '}
                      <span className="cfs-muted cfs-tiny">{SKILLS[k].ability.toUpperCase()}</span>
                    </span>
                    <span className={lvl ? 'cfs-row-num cfs-row-num--prof' : 'cfs-row-num'}>
                      {signed(b)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="cfs-passives">
            <span className="cfs-passive">
              <b>{passivePerception(sheet)}</b>{' '}
              <span className="cfs-muted">passive Perception</span>
            </span>
            <span className="cfs-passive">
              <b>{10 + skillBonus(sheet, 'insight')}</b>{' '}
              <span className="cfs-muted">passive Insight</span>
            </span>
            {senseChips(sheet).map((s) => (
              <span key={s.label} className="cfs-passive">
                {s.value && <b>{s.value}</b>} <span className="cfs-muted">{s.label}</span>
              </span>
            ))}
          </div>
        </Section>
      </div>
    </div>
  )
}

/** "Darkvision 60 ft, Tremorsense 10 ft" → [{ value: '60 ft', label: 'Darkvision' }, …]. */
function senseChips(sheet: Sheet5e): { value: string; label: string }[] {
  const text = sheet.senses ?? ''
  return text
    .split(/[,;]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(.*?)\s*(\d+\s*(?:ft\.?|feet))$/i.exec(x)
      return m && m[1]
        ? {
            label: m[1].replace(/^./, (c) => c.toUpperCase()),
            value: m[2].replace(/feet|ft\./i, 'ft')
          }
        : { label: x, value: '' }
    })
}

function Pips({
  n,
  tone,
  label
}: {
  n: number
  tone: 'good' | 'bad'
  label: string
}): React.JSX.Element {
  return (
    <span className="cfs-pips" role="img" aria-label={`${n} of 3 ${label}`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`cfs-pip cfs-pip--${tone}${i < n ? ' cfs-pip--on' : ''}`} />
      ))}
    </span>
  )
}

// ───────────── Actions ─────────────

function ActionsSection({
  ch,
  ed,
  rollWith
}: {
  ch: Character
  ed: SheetEditor
  rollWith: RollWith
}): React.JSX.Element {
  const { sheet, set, canEdit } = ed
  const { t, isGm, say, targetId, tokenOf, selectedId } = useCf()
  const rollNow = useRollNow()
  const [adding, setAdding] = useState(false)
  const myToken =
    tokenOf(ch.id) ??
    (isGm && selectedId ? (t.tokens.find((x) => x.id === selectedId) ?? null) : null)
  const target = targetId ? t.tokens.find((x) => x.id === targetId) : null
  const advWord = rollWith === 'adv' ? ' (advantage)' : rollWith === 'dis' ? ' (disadvantage)' : ''

  const toHit = async (a: SheetAttack): Promise<void> => {
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
        ...(rollWith !== 'normal' ? { advantage: rollWith } : {})
      })
      if (!r.ok) say(r.message)
      else if (!r.data.hit) say(`${a.name} misses ${target.name || 'the target'}.`)
      else if (r.data.pending === null && r.data.applied === null && !isGm)
        say(`${r.data.crit ? 'Critical hit! ' : 'Hit! '}The game master applies the damage.`)
      return
    }
    await rollNow(withD20(ex.toHit, rollWith), {
      label: `${ch.name}: ${a.name} to hit${advWord}`,
      characterId: ch.id
    })
  }
  const damage = (a: SheetAttack): void =>
    void rollNow(attackExpressions(sheet, a).damage, {
      label: `${ch.name}: ${a.name} damage`,
      characterId: ch.id
    })

  const res = sheet.resources
  const hitLeft = sheet.hitDice.reduce((n, h) => n + h.max - h.used, 0)
  const hitMax = sheet.hitDice.reduce((n, h) => n + h.max, 0)

  return (
    <Section
      title="Attacks"
      aside={
        canEdit && (
          <button
            type="button"
            className="cfs-add"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            + Add attack
          </button>
        )
      }
    >
      <p className="cfs-hint">
        {target && myToken
          ? `Attacking ${target.name || 'the target'}. Tap to hit: a hit rolls damage and sends it to the game master.`
          : 'Pick a target on the map first (double-click or T), then tap to hit. A hit rolls damage and sends it to the game master.'}
      </p>
      {adding && (
        <AddAttack
          onAdd={(a) => {
            set('attacks', [...sheet.attacks, a])
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <ul className="cfs-attacks">
        {sheet.attacks.map((a) => {
          const ex = attackExpressions(sheet, a)
          const hit = signed(Number(ex.toHit.replace(/^1d20/, '') || 0))
          return (
            <li key={a.id} className="cfs-attack">
              <div className="cfs-attack-name">
                <b>{a.name}</b>
                <span className="cfs-muted cfs-small">
                  {[
                    a.kind === 'melee' ? 'Melee' : a.kind === 'ranged' ? 'Ranged' : 'Spell',
                    a.range
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
              <button
                type="button"
                className="cfs-tohit"
                aria-label={`Roll ${a.name} to hit`}
                onClick={() => void toHit(a)}
              >
                {hit}
              </button>
              <button
                type="button"
                className="cfs-dmg"
                aria-label={`Roll ${a.name} damage`}
                onClick={() => damage(a)}
              >
                {ex.damage} <span className="cfs-muted">{a.damageType}</span>
              </button>
              <AttackNotes
                a={a}
                canEdit={canEdit}
                onChange={(notes) =>
                  set(
                    'attacks',
                    sheet.attacks.map((x) => (x.id === a.id ? { ...x, notes } : x))
                  )
                }
              />
              {canEdit && (
                <button
                  type="button"
                  className="cfs-x"
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
        {sheet.attacks.length === 0 && <li className="cfs-hint">No attacks yet.</li>}
      </ul>

      <div className="cfs-section-head">
        <h3>Class resources</h3>
      </div>
      <div className="cfs-resources">
        <span className="cfs-resource">
          <b>Hit dice</b>{' '}
          <span className="cfs-muted">
            {hitLeft} of {hitMax} {sheet.hitDice.map((d) => `d${d.die}`).join('+')} · short rest
          </span>
        </span>
        <button
          type="button"
          className="cfs-resource cfs-resource--button"
          aria-pressed={!!sheet.inspiration}
          disabled={!canEdit}
          onClick={() => set('inspiration', !sheet.inspiration)}
        >
          <b>Inspiration</b>{' '}
          {sheet.inspiration ? (
            <span className="cfs-amber">● ready</span>
          ) : (
            <span className="cfs-muted">○ none</span>
          )}
        </button>
        {res.map((r, i) => (
          <span key={r.id} className="cfs-resource">
            <b>{r.name}</b>{' '}
            <span className="cfs-muted">
              {r.max - r.used} of {r.max}
              {r.reset === 'short' ? ' · short rest' : r.reset === 'long' ? ' · long rest' : ''}
            </span>
            {canEdit && (
              <>
                <button
                  type="button"
                  className="cfs-mini"
                  disabled={r.used >= r.max}
                  aria-label={`Use one ${r.name}`}
                  onClick={() =>
                    set(
                      'resources',
                      res.map((x, j) => (j === i ? { ...x, used: x.used + 1 } : x))
                    )
                  }
                >
                  Use
                </button>
                <button
                  type="button"
                  className="cfs-mini"
                  disabled={r.used <= 0}
                  aria-label={`Get one ${r.name} back`}
                  onClick={() =>
                    set(
                      'resources',
                      res.map((x, j) => (j === i ? { ...x, used: x.used - 1 } : x))
                    )
                  }
                >
                  +1
                </button>
                <button
                  type="button"
                  className="cfs-x"
                  aria-label={`Remove ${r.name}`}
                  onClick={() =>
                    set(
                      'resources',
                      res.filter((_, j) => j !== i)
                    )
                  }
                >
                  ×
                </button>
              </>
            )}
          </span>
        ))}
      </div>
      {canEdit && <AddResource onAdd={(r) => set('resources', [...res, r])} />}
    </Section>
  )
}

/** An attack's notes: wrapped text; tap to change it (owner and GMs). */
function AttackNotes({
  a,
  canEdit,
  onChange
}: {
  a: SheetAttack
  canEdit: boolean
  onChange: (notes: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(a.notes)
  if (!canEdit) return <span className="cfs-attack-notes">{a.notes}</span>
  if (editing)
    return (
      <textarea
        className="cfs-attack-notes cfs-notes-edit"
        aria-label={`${a.name} notes`}
        autoFocus
        maxLength={500}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (text !== a.notes) onChange(text)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            ;(e.target as HTMLTextAreaElement).blur()
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            setText(a.notes)
            setEditing(false)
          }
        }}
      />
    )
  return (
    <button
      type="button"
      className="cfs-attack-notes cfs-notes-button"
      aria-label={`${a.name} notes: ${a.notes || 'none'} (change)`}
      onClick={() => {
        setText(a.notes)
        setEditing(true)
      }}
    >
      {a.notes || <span className="cfs-notes-empty">Add notes</span>}
    </button>
  )
}

function AddResource({
  onAdd
}: {
  onAdd: (r: Sheet5e['resources'][number]) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [max, setMax] = useState('1')
  const [reset, setReset] = useState<'short' | 'long' | 'none'>('short')
  return (
    <form
      className="cfs-inline-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onAdd({
          id: pieceId('r'),
          name: name.trim().slice(0, 60),
          max: Math.max(1, Math.min(999, Number(max) || 1)),
          used: 0,
          reset
        })
        setName('')
      }}
    >
      <input
        aria-label="Resource name"
        placeholder="Add a resource (Second Wind)"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        aria-label="How many"
        type="number"
        min={1}
        max={999}
        value={max}
        onChange={(e) => setMax(e.target.value)}
        className="cfs-narrow"
      />
      <select
        aria-label="Comes back after"
        value={reset}
        onChange={(e) => setReset(e.target.value as typeof reset)}
      >
        <option value="short">Short rest</option>
        <option value="long">Long rest</option>
        <option value="none">Never</option>
      </select>
      <button type="submit" className="cfs-button cfs-button--small">
        Add
      </button>
    </form>
  )
}

function AddAttack({
  onAdd,
  onCancel
}: {
  onAdd: (a: SheetAttack) => void
  onCancel: () => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [ability, setAbility] = useState<Ability | 'spell'>('str')
  const [damage, setDamage] = useState('1d8')
  const [type, setType] = useState<DamageType>('slashing')
  const [kind, setKind] = useState<'melee' | 'ranged' | 'spell'>('melee')
  const [range, setRange] = useState('')
  const [bad, setBad] = useState<string | null>(null)
  return (
    <form
      className="cfs-inline-form cfs-inline-form--card"
      aria-label="New attack"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return setBad('Give it a name.')
        if (!/^\d*d\d+([+-]\d+)?$/i.test(damage.trim())) return setBad('Damage like 1d8 or 2d6+1.')
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
          range: range.trim().slice(0, 40),
          notes: ''
        })
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
        className="cfs-narrow"
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
      <input
        aria-label="Range or properties"
        placeholder="150/600 ft"
        value={range}
        onChange={(e) => setRange(e.target.value)}
        maxLength={40}
      />
      <button type="submit" className="cfs-button cfs-button--accent cfs-button--small">
        Add
      </button>
      <button type="button" className="cfs-button cfs-button--small" onClick={onCancel}>
        Cancel
      </button>
      {bad && (
        <span className="cfs-error" role="alert">
          {bad}
        </span>
      )}
    </form>
  )
}

// ───────────── Spells ─────────────

function SpellsSection({
  ch,
  ed,
  rollWith,
  wide
}: {
  ch: Character
  ed: SheetEditor
  rollWith: RollWith
  wide?: boolean
}): React.JSX.Element {
  const { sheet, save, canEdit } = ed
  const { t, say, targetId, tokenOf, isGm, selectedId } = useCf()
  const rollNow = useRollNow()
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [saveForm, setSaveForm] = useState<{
    ability: Ability
    damage: string
    half: boolean
    /** 0 = just the target; otherwise everyone within this many feet of the target's center */
    areaFt: number
    /** Tokens left out of the area by hand */
    skip: string[]
  } | null>(null)
  const sc = sheet.spellcasting
  const caster =
    tokenOf(ch.id) ??
    (isGm && selectedId ? (t.tokens.find((x) => x.id === selectedId) ?? null) : null)
  // Who a save spell hits: the target, or every token (that this person can see) inside the area.
  const saveTargets = useMemo(() => {
    const target = targetId ? t.tokens.find((x) => x.id === targetId) : null
    const scene = t.scene
    if (!target || !saveForm || !scene) return target ? [target] : []
    if (!saveForm.areaFt) return [target]
    const g = scene.grid
    const [cx, cy] = tokenCenter(target, g)
    const r = (saveForm.areaFt / Math.max(1, g.feet)) * g.size
    return t.tokens
      .filter((x) => x.layer !== 'map' && (isGm || x.layer !== 'gm'))
      .filter((x) => {
        const [x0, y0] = tokenCenter(x, g)
        // Inside if any of the token's square is: its center within the radius plus half its size.
        return Math.hypot(x0 - cx, y0 - cy) <= r + (Math.min(x.w, x.h) * g.size) / 2 - 1
      })
      .sort((a, b) =>
        a.id === target.id ? -1 : b.id === target.id ? 1 : a.name.localeCompare(b.name)
      )
      .slice(0, 20)
  }, [targetId, t.tokens, t.scene, saveForm, isGm])
  const chosenTargets = saveTargets.filter((x) => !saveForm?.skip.includes(x.id))
  const spells = useMemo(
    () =>
      sc.spells.map((sp, i) => ({ sp, i })).sort((a, b) => a.sp.level - b.sp.level || a.i - b.i),
    [sc.spells]
  )
  const advWord = rollWith === 'adv' ? ' (advantage)' : rollWith === 'dis' ? ' (disadvantage)' : ''

  const setSlotUsed = (level: number, used: number): void =>
    save({
      ...sheet,
      spellcasting: { ...sc, slots: sc.slots.map((x, k) => (k === level - 1 ? { ...x, used } : x)) }
    })

  const cast = async (sp: SheetSpell): Promise<void> => {
    let next: Sheet5e = sheet
    let slotWord = ''
    if (sp.level > 0) {
      const lvl = sc.slots.findIndex((s, k) => k + 1 >= sp.level && s.used < s.max)
      const pactOk = sc.pact && sc.pact.level >= sp.level && sc.pact.used < sc.pact.max
      if (lvl >= 0) {
        next = {
          ...next,
          spellcasting: {
            ...sc,
            slots: sc.slots.map((x, k) => (k === lvl ? { ...x, used: x.used + 1 } : x))
          }
        }
        slotWord = lvl + 1 > sp.level ? ` (level ${lvl + 1} slot)` : ''
      } else if (pactOk && sc.pact) {
        next = { ...next, spellcasting: { ...sc, pact: { ...sc.pact, used: sc.pact.used + 1 } } }
        slotWord = ' (pact slot)'
      } else return say(`No level ${sp.level} spell slots left.`)
    }
    if (sp.concentration) {
      if (sheet.concentration && sheet.concentration !== sp.name)
        say(`${sheet.concentration} ends: you concentrate on ${sp.name} now.`)
      next = { ...next, concentration: sp.name }
    }
    if (next !== sheet) save(next)
    if (sp.roll)
      await rollNow(sp.roll, { label: `${ch.name}: ${sp.name}${slotWord}`, characterId: ch.id })
    else say(`${ch.name} casts ${sp.name}${slotWord}.`)
  }

  const slotRows = sc.slots.map((s, i) => ({ ...s, level: i + 1 })).filter((s) => s.max > 0)

  return (
    <Section
      title="Spells"
      className={wide ? 'cfs-section--wide' : ''}
      aside={
        canEdit && (
          <button
            type="button"
            className="cfs-add"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            + Add from the rules
          </button>
        )
      }
    >
      {picking && (
        <SpellPicker
          sheet={sheet}
          onPick={(sp) => {
            save({ ...sheet, spellcasting: { ...sc, spells: [...sc.spells, sp] } })
            say(`${sp.name} added.`)
          }}
          onClose={() => setPicking(false)}
        />
      )}
      <div className="cfs-resources">
        <button
          type="button"
          className="cfs-resource cfs-resource--button"
          aria-label={`Roll a spell attack (${signed(spellAttackBonus(sheet))})`}
          onClick={() =>
            void rollNow(withD20(withBonus('1d20', spellAttackBonus(sheet)), rollWith), {
              label: `${ch.name}: spell attack${advWord}`,
              characterId: ch.id
            })
          }
        >
          <b className="cfs-num-big">{signed(spellAttackBonus(sheet))}</b>{' '}
          <span className="cfs-muted">spell attack</span>
        </button>
        <span className="cfs-resource">
          <b className="cfs-num-big">{spellSaveDc(sheet)}</b>{' '}
          <span className="cfs-muted">save DC</span>
        </span>
        <label className="cfs-resource">
          {canEdit ? (
            <select
              className="cfs-bare-select cfs-num-big"
              aria-label="Spellcasting ability"
              value={sc.ability ?? ''}
              onChange={(e) =>
                save({
                  ...sheet,
                  spellcasting: { ...sc, ability: (e.target.value || null) as Ability | null }
                })
              }
            >
              <option value="">None</option>
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {a.toUpperCase()}
                </option>
              ))}
            </select>
          ) : (
            <b className="cfs-num-big">{sc.ability?.toUpperCase() ?? '—'}</b>
          )}{' '}
          <span className="cfs-muted">spellcasting ability</span>
        </label>
      </div>

      {slotRows.map((s) => (
        <div key={s.level} className="cfs-slots">
          <span className="cfs-slot-label">Level {s.level}</span>
          <div className="cfs-slot-pips" role="group" aria-label={`Level ${s.level} slots`}>
            {Array.from({ length: s.max }, (_, j) => {
              const used = j < s.used
              return (
                <button
                  key={j}
                  type="button"
                  disabled={!canEdit}
                  aria-label={`Level ${s.level} slot ${j + 1}${used ? ' used' : ''}`}
                  title={used ? 'Used: tap to get it back' : 'Tap to spend it'}
                  className={used ? 'cfs-slot cfs-slot--used' : 'cfs-slot'}
                  onClick={() => setSlotUsed(s.level, used ? s.used - 1 : s.used + 1)}
                />
              )
            })}
          </div>
          <span className="cfs-muted cfs-small">
            {s.max - s.used} of {s.max} left
          </span>
        </div>
      ))}
      {sc.pact && sc.pact.max > 0 && (
        <div className="cfs-slots">
          <span className="cfs-slot-label">Pact ({sc.pact.level})</span>
          <div className="cfs-slot-pips" role="group" aria-label="Pact slots">
            {Array.from({ length: sc.pact.max }, (_, j) => {
              const used = j < sc.pact!.used
              return (
                <button
                  key={j}
                  type="button"
                  disabled={!canEdit}
                  aria-label={`Pact slot ${j + 1}${used ? ' used' : ''}`}
                  className={used ? 'cfs-slot cfs-slot--used' : 'cfs-slot'}
                  onClick={() =>
                    save({
                      ...sheet,
                      spellcasting: {
                        ...sc,
                        pact: { ...sc.pact!, used: used ? sc.pact!.used - 1 : sc.pact!.used + 1 }
                      }
                    })
                  }
                />
              )
            })}
          </div>
          <span className="cfs-muted cfs-small">
            {sc.pact.max - sc.pact.used} of {sc.pact.max} left · short rest
          </span>
        </div>
      )}
      {slotRows.length === 0 && !sc.pact && (
        <p className="cfs-hint">
          No spell slots. A spellcasting class (Notes → Details) gives them by level.
        </p>
      )}

      <ul className="cfs-spells">
        {spells.map(({ sp, i }) => (
          <li key={`${sp.name}-${i}`} className="cfs-spell">
            <div className="cfs-spell-row">
              <span
                className="cfs-spell-level"
                aria-label={sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`}
              >
                {sp.level === 0 ? 'C' : sp.level}
              </span>
              <div className="cfs-spell-main">
                <div className="cfs-spell-name">
                  <b>{sp.name}</b>
                  {sp.concentration && <span className="cfs-tag">Concentration</span>}
                </div>
                <span className="cfs-muted cfs-small">
                  {spellLine(sp) || (sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`)}
                </span>
              </div>
              {sp.notes && <span className="cfs-spell-notes">{sp.notes}</span>}
              {canEdit && (
                <button
                  type="button"
                  className="cfs-mini"
                  aria-expanded={editing === i}
                  aria-label={`Change ${sp.name}`}
                  onClick={() => setEditing(editing === i ? null : i)}
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                className="cfs-cast"
                disabled={!canEdit}
                aria-label={`Cast ${sp.name}${sp.roll ? `, rolls ${sp.roll}` : ''}`}
                onClick={() => void cast(sp)}
              >
                Cast{sp.roll ? ` · ${sp.roll}` : ''}
              </button>
            </div>
            {editing === i && canEdit && (
              <SpellEdit
                sp={sp}
                onChange={(next) =>
                  save({
                    ...sheet,
                    spellcasting: { ...sc, spells: sc.spells.map((x, j) => (j === i ? next : x)) }
                  })
                }
                onRemove={() => {
                  setEditing(null)
                  save({
                    ...sheet,
                    spellcasting: { ...sc, spells: sc.spells.filter((_, j) => j !== i) }
                  })
                }}
              />
            )}
          </li>
        ))}
        {spells.length === 0 && <li className="cfs-hint">No spells yet.</li>}
      </ul>

      {wide && canEdit && caster && (
        <div className="cfs-save-spell">
          {!saveForm ? (
            <button
              type="button"
              className="cfs-button cfs-button--small"
              disabled={!targetId}
              title={targetId ? '' : 'Target a token first'}
              onClick={() =>
                setSaveForm({ ability: 'dex', damage: '2d8', half: true, areaFt: 0, skip: [] })
              }
            >
              Cast a spell with a saving throw…
            </button>
          ) : (
            <form
              className="cfs-inline-form"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!chosenTargets.length) return
                const r = await cf.post(`/campfire/campaigns/${t.campaign.id}/save-spell`, {
                  casterTokenId: caster.id,
                  targetTokenIds: chosenTargets.map((x) => x.id),
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
              <span className="cfs-muted">DC {spellSaveDc(sheet)}</span>
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
                className="cfs-narrow"
                onChange={(e) => setSaveForm({ ...saveForm, damage: e.target.value })}
              />
              <label className="cfs-check">
                <input
                  type="checkbox"
                  checked={saveForm.half}
                  onChange={(e) => setSaveForm({ ...saveForm, half: e.target.checked })}
                />
                Half on a save
              </label>
              <select
                aria-label="Who it hits"
                value={saveForm.areaFt}
                onChange={(e) =>
                  setSaveForm({ ...saveForm, areaFt: Number(e.target.value), skip: [] })
                }
              >
                <option value={0}>Just the target</option>
                {[5, 10, 15, 20, 30, 40].map((ft) => (
                  <option key={ft} value={ft}>
                    Everyone within {ft} ft of the target
                  </option>
                ))}
              </select>
              {saveForm.areaFt > 0 && (
                <fieldset className="cfs-save-targets">
                  <legend className="cfs-muted cfs-small">
                    {chosenTargets.length} of {saveTargets.length} in the area roll a save
                  </legend>
                  {saveTargets.map((x) => (
                    <label key={x.id} className="cfs-check">
                      <input
                        type="checkbox"
                        checked={!saveForm.skip.includes(x.id)}
                        onChange={(e) =>
                          setSaveForm({
                            ...saveForm,
                            skip: e.target.checked
                              ? saveForm.skip.filter((id) => id !== x.id)
                              : [...saveForm.skip, x.id]
                          })
                        }
                      />
                      {x.name || 'Someone'}
                      {x.id === targetId ? ' (target)' : x.id === caster.id ? ' (the caster)' : ''}
                    </label>
                  ))}
                </fieldset>
              )}
              <button
                type="submit"
                className="cfs-button cfs-button--accent cfs-button--small"
                disabled={!chosenTargets.length}
              >
                Cast{chosenTargets.length > 1 ? ` at ${chosenTargets.length}` : ''}
              </button>
              <button
                type="button"
                className="cfs-button cfs-button--small"
                onClick={() => setSaveForm(null)}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </Section>
  )
}

function SpellEdit({
  sp,
  onChange,
  onRemove
}: {
  sp: SheetSpell
  onChange: (s: SheetSpell) => void
  onRemove: () => void
}): React.JSX.Element {
  return (
    <div className="cfs-inline-form cfs-inline-form--card">
      <label className="cfs-field">
        <span>Level</span>
        <select
          aria-label={`${sp.name} level`}
          value={sp.level}
          onChange={(e) => onChange({ ...sp, level: Number(e.target.value) })}
        >
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Cantrip' : n}
            </option>
          ))}
        </select>
      </label>
      <label className="cfs-field">
        <span>Dice when cast</span>
        <TextBox
          label={`${sp.name} dice when cast`}
          placeholder="2d4"
          value={sp.roll ?? ''}
          maxLength={60}
          onChange={(v) => onChange({ ...sp, roll: v.trim() || undefined })}
        />
      </label>
      <label className="cfs-field cfs-field--grow">
        <span>Notes</span>
        <TextBox
          label={`${sp.name} notes`}
          value={sp.notes ?? ''}
          maxLength={300}
          onChange={(v) => onChange({ ...sp, notes: v })}
        />
      </label>
      <label className="cfs-check">
        <input
          type="checkbox"
          checked={!!sp.concentration}
          onChange={(e) => onChange({ ...sp, concentration: e.target.checked })}
        />
        Concentration
      </label>
      <button
        type="button"
        className="cfs-button cfs-button--small cfs-button--danger"
        onClick={onRemove}
      >
        Remove {sp.name}
      </button>
    </div>
  )
}

/** "+ Add from the rules": SRD spells by name, level, and (on by default) the character's class. */
function SpellPicker({
  sheet,
  onPick,
  onClose
}: {
  sheet: Sheet5e
  onPick: (sp: SheetSpell) => void
  onClose: () => void
}): React.JSX.Element {
  const { say, t } = useCf()
  const spellRules = sheet.rules ?? rulesOf(t.campaign.settings)
  const cls = sheet.classes[0]?.name ?? ''
  const [q, setQ] = useState('')
  const [level, setLevel] = useState<string>('')
  const [onlyClass, setOnlyClass] = useState(!!cls)
  const [list, setList] = useState<SrdSpellSummary[] | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const params = new URLSearchParams()
      if (q.trim()) params.set('q', q.trim())
      if (level) params.set('level', level)
      if (onlyClass && cls) params.set('class', cls)
      params.set('rules', spellRules)
      const r = await cf.get<{ spells: SrdSpellSummary[] }>(`/campfire/srd/spells?${params}`)
      if (r.ok) setList(r.data.spells.slice(0, 60))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [q, level, onlyClass, cls, spellRules])
  const have = new Set(sheet.spellcasting.spells.map((s) => s.slug).filter(Boolean))
  return (
    <div
      className="cfs-picker"
      role="group"
      aria-label="Add a spell from the rules"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="cfs-inline-form">
        <input
          ref={input}
          aria-label="Find a spell"
          placeholder="Find a spell (cure, fire, mark…)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="Spell level" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Any level</option>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'Cantrips' : `Level ${n}`}
            </option>
          ))}
        </select>
        {cls && (
          <label className="cfs-check">
            <input
              type="checkbox"
              checked={onlyClass}
              onChange={(e) => setOnlyClass(e.target.checked)}
            />
            {cls} spells
          </label>
        )}
        <button type="button" className="cfs-button cfs-button--small" onClick={onClose}>
          Done
        </button>
      </div>
      <ul className="cfs-picker-list">
        {list?.map((s) => (
          <li key={s.slug}>
            <button
              type="button"
              disabled={have.has(s.slug)}
              aria-label={`Add ${s.name}${have.has(s.slug) ? ' (already on the sheet)' : ''}`}
              onClick={async () => {
                const r = await cf.get<SrdSpell>(
                  `/campfire/srd/spells/${s.slug}?rules=${spellRules}`
                )
                if (!r.ok) return say(r.message)
                onPick(spellFromSrd(r.data, sheet))
              }}
            >
              <span className="cfs-spell-level" aria-hidden="true">
                {s.level === 0 ? 'C' : s.level}
              </span>
              <b>{s.name}</b>
              <span className="cfs-muted cfs-small">
                {s.school} · {s.classes.join(', ')}
              </span>
              <span className="cfs-picker-add" aria-hidden="true">
                {have.has(s.slug) ? '✓' : '+'}
              </span>
            </button>
          </li>
        ))}
        {list && list.length === 0 && <li className="cfs-hint">No spells match.</li>}
      </ul>
      <p className="cfs-credit">{SRD_CREDIT}</p>
    </div>
  )
}

// ───────────── Features, inventory, notes ─────────────

function FeaturesTab({ ed }: { ed: SheetEditor }): React.JSX.Element {
  const { sheet, set, canEdit } = ed
  const [name, setName] = useState('')
  const m = sheet.monster
  return (
    <div className="cfs-grid2">
      <Section title="Features and traits">
        <ul className="cfs-cards">
          {sheet.features.map((f) => (
            <li key={f.id} className="cfs-card">
              {canEdit ? (
                <>
                  <div className="cfs-card-head">
                    <TextBox
                      className="cfs-inline-text cfs-inline-text--bold"
                      label="Feature name"
                      value={f.name}
                      maxLength={100}
                      onChange={(v) =>
                        v.trim() &&
                        set(
                          'features',
                          sheet.features.map((x) => (x.id === f.id ? { ...x, name: v.trim() } : x))
                        )
                      }
                    />
                    <button
                      type="button"
                      className="cfs-x"
                      aria-label={`Remove ${f.name}`}
                      onClick={() =>
                        set(
                          'features',
                          sheet.features.filter((x) => x.id !== f.id)
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                  <TextBox
                    multiline
                    className="cfs-textarea cfs-textarea--short"
                    label={`${f.name}: what it does`}
                    placeholder="What it does"
                    value={f.text}
                    maxLength={4000}
                    onChange={(v) =>
                      set(
                        'features',
                        sheet.features.map((x) => (x.id === f.id ? { ...x, text: v } : x))
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <b>{f.name}</b>
                  <p className="cfs-para">{f.text}</p>
                </>
              )}
            </li>
          ))}
          {sheet.features.length === 0 && (
            <li className="cfs-hint">
              No features yet: class features, feats and racial traits go here.
            </li>
          )}
        </ul>
        {canEdit && (
          <form
            className="cfs-inline-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              set('features', [
                ...sheet.features,
                { id: pieceId('f'), name: name.trim().slice(0, 100), text: '' }
              ])
              setName('')
            }}
          >
            <input
              aria-label="New feature name"
              placeholder="Add a feature (Favored Enemy)"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="cfs-button cfs-button--small">
              Add
            </button>
          </form>
        )}
      </Section>
      <Section title="Defenses">
        {(['resist', 'vulnerable', 'immune'] as const).map((k) => (
          <div key={k} className="cfs-defense">
            <span className="cfs-muted">
              {k === 'resist' ? 'Resistant to' : k === 'vulnerable' ? 'Vulnerable to' : 'Immune to'}
            </span>
            <div
              className="cfs-chips"
              role="group"
              aria-label={
                k === 'resist'
                  ? 'Resistances'
                  : k === 'vulnerable'
                    ? 'Vulnerabilities'
                    : 'Immunities'
              }
            >
              {DAMAGE_TYPES.map((d) => {
                const on = sheet[k].includes(d)
                if (!canEdit && !on) return null
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={!canEdit}
                    className={
                      on ? 'cfs-chip cfs-chip--small cfs-chip--on' : 'cfs-chip cfs-chip--small'
                    }
                    onClick={() => set(k, on ? sheet[k].filter((x) => x !== d) : [...sheet[k], d])}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {m && (m.traits.length > 0 || m.reactions.length > 0 || m.legendary.length > 0) && (
          <div className="cfs-cards">
            {[...m.traits, ...m.reactions, ...m.legendary].map((f) => (
              <p key={f.id} className="cfs-para">
                <b>
                  <i>{f.name}.</i>
                </b>{' '}
                {f.text}
              </p>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function NotesTab({ ch, ed }: { ch: Character; ed: SheetEditor }): React.JSX.Element {
  const { sheet, set, save, canEdit, lockedField, patchChar } = ed
  const { isGm } = useCf()
  const cls = sheet.classes[0]
  const setClass = (patch: Partial<NonNullable<typeof cls>>, recount = false): void => {
    const first = {
      name: cls?.name ?? 'Adventurer',
      level: cls?.level ?? 1,
      hitDie: cls?.hitDie ?? 8,
      caster: cls?.caster ?? 'none',
      ...(cls?.subclass ? { subclass: cls.subclass } : {}),
      ...patch
    }
    const classes = [first, ...sheet.classes.slice(1)]
    if (!recount) return set('classes', classes)
    // Level, hit die or spellcasting changed: hit dice and slots follow.
    const slots = slotsForClasses(classes)
    save({
      ...sheet,
      classes,
      hitDice: [
        {
          die: first.hitDie,
          max: first.level,
          used: Math.min(first.level, sheet.hitDice[0]?.used ?? 0)
        }
      ],
      spellcasting: {
        ...sheet.spellcasting,
        slots: sheet.spellcasting.slots.map((s, i) => ({
          max: slots.slots[i] ?? 0,
          used: Math.min(s.used, slots.slots[i] ?? 0)
        })),
        pact: slots.pact
          ? {
              level: slots.pact.level,
              max: slots.pact.slots,
              used: Math.min(sheet.spellcasting.pact?.used ?? 0, slots.pact.slots)
            }
          : null
      }
    })
  }
  const text = (
    label: string,
    value: string,
    on: (v: string) => void,
    opts: { placeholder?: string; max?: number; disabled?: boolean } = {}
  ): React.JSX.Element => (
    <label className="cfs-field">
      <span>{label}</span>
      <TextBox
        label={label}
        value={value}
        placeholder={opts.placeholder}
        maxLength={opts.max ?? 60}
        disabled={!canEdit || opts.disabled}
        onChange={on}
      />
    </label>
  )
  const num = (
    label: string,
    value: number,
    on: (n: number) => void,
    min: number,
    max: number,
    disabled = false
  ): React.JSX.Element => (
    <label className="cfs-field">
      <span>{label}</span>
      <NumBox
        label={label}
        value={value}
        min={min}
        max={max}
        disabled={!canEdit || disabled}
        onChange={on}
      />
    </label>
  )
  return (
    <div className="cfs-grid2">
      <Section title="Details">
        <div className="cfs-fields">
          {text('Name', ch.name, (v) => v.trim() && void patchChar({ name: v.trim() }))}
          {text('Race', sheet.race, (v) => set('race', v))}
          {text('Class', cls?.name ?? '', (v) => setClass({ name: v.trim() || 'Adventurer' }), {
            max: 40
          })}
          {text('Subclass', cls?.subclass ?? '', (v) => setClass({ subclass: v.trim() }), {
            max: 40,
            placeholder: 'Hunter'
          })}
          {num('Level', cls?.level ?? 1, (n) => setClass({ level: n }, true), 1, 20)}
          <label className="cfs-field">
            <span>Hit die</span>
            <select
              value={cls?.hitDie ?? 8}
              disabled={!canEdit}
              onChange={(e) => setClass({ hitDie: Number(e.target.value) }, true)}
            >
              {[6, 8, 10, 12].map((d) => (
                <option key={d} value={d}>
                  d{d}
                </option>
              ))}
            </select>
          </label>
          <label className="cfs-field">
            <span>Spellcaster</span>
            <select
              value={cls?.caster ?? 'none'}
              disabled={!canEdit}
              onChange={(e) => setClass({ caster: e.target.value as 'none' }, true)}
            >
              <option value="none">No</option>
              <option value="full">Full caster</option>
              <option value="half">Half caster</option>
              <option value="third">Third caster</option>
              <option value="pact">Pact magic</option>
            </select>
          </label>
          {text('Background', sheet.background, (v) => set('background', v))}
          {text('Alignment', sheet.alignment, (v) => set('alignment', v), { max: 40 })}
          {num('Experience points', sheet.xp ?? 0, (n) => set('xp', n), 0, 1_000_000)}
          {num('Armor class', sheet.ac, (n) => set('ac', n), 0, 50, lockedField)}
          {text('Armor', sheet.acNote ?? '', (v) => set('acNote', v), { placeholder: 'Leather' })}
          {num(
            'Most hit points',
            sheet.hp.max,
            (n) => set('hp', { ...sheet.hp, max: n, current: Math.min(sheet.hp.current, n) }),
            0,
            99999,
            lockedField
          )}
          {num(
            'Current hit points',
            sheet.hp.current,
            (n) => set('hp', { ...sheet.hp, current: n }),
            0,
            sheet.hp.max
          )}
          {num('Speed (ft)', sheet.speed, (n) => set('speed', n), 0, 500)}
          {num(
            'Extra initiative',
            sheet.initiativeBonus,
            (n) => set('initiativeBonus', n),
            -20,
            20
          )}
          {text('Senses', sheet.senses ?? '', (v) => set('senses', v), {
            placeholder: 'Darkvision 60 ft',
            max: 200
          })}
          {text(
            'D&D Beyond link',
            ch.ddbUrl ?? '',
            (v) => void patchChar({ ddbUrl: v.trim() || null }),
            { placeholder: 'https://www.dndbeyond.com/characters/…', max: 300 }
          )}
        </div>
        {lockedField && (
          <p className="cfs-hint">
            The game master locked this sheet&apos;s armor class and most hit points.
          </p>
        )}
        {isGm && (
          <label className="cfs-check">
            <input
              type="checkbox"
              checked={sheet.locked}
              onChange={(e) => set('locked', e.target.checked)}
            />
            Lock armor class and most hit points for the player
          </label>
        )}
      </Section>
      <Section title="Notes">
        <TextBox
          multiline
          className="cfs-textarea"
          label="Notes"
          placeholder="Backstory, allies, the map to the crypt…"
          value={sheet.notes}
          maxLength={20000}
          disabled={!canEdit}
          onChange={(v) => set('notes', v)}
        />
      </Section>
    </div>
  )
}

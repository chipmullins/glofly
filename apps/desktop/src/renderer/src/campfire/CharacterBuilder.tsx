import { useEffect, useMemo, useState } from 'react'
import {
  ABILITIES,
  ABILITY_NAMES,
  type Ability,
  type Character,
  type SheetSpell,
  type SkillId,
  type SrdSpellSummary
} from '@glofly/shared/campfire/types'
import { abilityMod, SKILLS } from '@glofly/shared/campfire/rules5e'
import {
  POINT_BUY_BUDGET,
  POINT_BUY_COST,
  RULES_LABEL,
  STANDARD_ARRAY,
  pointBuySpent,
  roll4d6,
  type BuilderRules,
  type BuilderSpecies,
  type RulesItem,
  type RulesSet
} from '@glofly/shared/campfire/rulesData'
import {
  asiLevels,
  backgroundBonusOk,
  buildSheet,
  finalScores,
  pickFrom,
  spellCounts,
  type AsiChoice,
  type BuildChoices
} from '@glofly/shared/campfire/builder'
import type { Homebrew, HomebrewBackground, HomebrewSpecies } from '@glofly/shared/campfire/hub'
import { cf, IMAGE_ACCEPT, pickFile, uploadFile } from './api'
import { signed, useCf } from './ctx'
import { CfWindow } from './sheetBits'
import {
  campaignRules,
  loadHomebrew,
  searchItems,
  searchSpells,
  sheetSpellFrom,
  spellDetails,
  useBuilder
} from './rulesApi'
import { ImportPanel, QuickEntry } from './Bring'
import './roundA.css'

// Round A: the character builder (approved boards "CharBuilder" and "SwitchOver"). A player new to
// a campaign picks how to bring a character (import a PDF, copy it in, or build it at the party's
// level); building walks through species, class, background, ability scores, skills, equipment,
// spells, and name + portrait, with the character so far on the right. The sheet itself is made by
// the shared buildSheet, so phones build the same character.

const STEPS = [
  'Species',
  'Class',
  'Background',
  'Ability scores',
  'Skills',
  'Equipment',
  'Spells',
  'Name and portrait'
] as const
type Method = 'array' | 'points' | 'roll'

/** The campaign's shared homebrew species and backgrounds, as builder entries. */
function withHomebrew(data: BuilderRules, brew: Homebrew[]): BuilderRules {
  const species: BuilderSpecies[] = brew
    .filter((h) => h.kind === 'species')
    .map((h) => {
      const d = h.data as HomebrewSpecies
      return {
        id: `hb-${h.id}`,
        name: h.name,
        size: d.size,
        speed: d.speed,
        darkvision: d.darkvision,
        traits: d.traits,
        bonuses: d.bonuses,
        skills: d.skills,
        resist: d.resist,
        subs: [],
        homebrew: true
      }
    })
  const backgrounds = brew
    .filter((h) => h.kind === 'background')
    .map((h) => {
      const d = h.data as HomebrewBackground
      return {
        id: `hb-${h.id}`,
        name: h.name,
        skills: d.skills,
        abilities: d.abilities,
        tools: d.tools,
        feature: d.text ? { name: h.name, text: d.text } : undefined,
        gold: 0,
        homebrew: true
      }
    })
  return {
    ...data,
    species: [...data.species, ...species],
    backgrounds: [...data.backgrounds, ...backgrounds]
  }
}

export function CharacterBuilder({
  onClose,
  onMade
}: {
  onClose: () => void
  onMade: (c: Character) => void
}): React.JSX.Element {
  const { t, say } = useCf()
  const rules = campaignRules(t.campaign.settings)
  const base = useBuilder(rules)
  const [brew, setBrew] = useState<Homebrew[]>([])
  useEffect(() => {
    void loadHomebrew(t.campaign.id).then(setBrew)
  }, [t.campaign.id])
  const data = useMemo(() => (base ? withHomebrew(base, brew) : null), [base, brew])
  const [hubLevel, setHubLevel] = useState(1)
  useEffect(() => {
    void cf
      .get<{ progress: { level: number } }>(`/campfire/campaigns/${t.campaign.id}/hub`)
      .then((r) => r.ok && setHubLevel(r.data.progress.level))
  }, [t.campaign.id])
  const [mode, setMode] = useState<'choose' | 'build' | 'import' | 'copy'>('choose')

  return (
    <CfWindow label="Make your character" onClose={onClose} className="cfa-window">
      <header className="cfa-head">
        <div className="cfa-head-title">
          <h1>
            {mode === 'choose'
              ? 'Bring your character'
              : mode === 'build'
                ? 'Make your character'
                : mode === 'import'
                  ? 'Import a character sheet'
                  : 'Copy your character in'}
          </h1>
          <span>
            {t.campaign.name} · {RULES_LABEL[rules]}
            {brew.length ? " · your game master's homebrew included" : ''}
          </span>
        </div>
        <button
          type="button"
          className="cfs-close"
          aria-label="Close (nothing is saved yet)"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {mode === 'choose' && <Choose level={hubLevel} onPick={setMode} />}
      {mode === 'build' &&
        (data ? (
          <Build data={data} rules={rules} startLevel={hubLevel} onMade={onMade} say={say} />
        ) : (
          <p className="cfa-pad cf-hint">Loading the rules…</p>
        ))}
      {mode === 'import' && (
        <ImportPanel rules={rules} onBack={() => setMode('choose')} onMade={onMade} />
      )}
      {mode === 'copy' && (
        <QuickEntry
          rules={rules}
          level={hubLevel}
          onBack={() => setMode('choose')}
          onMade={onMade}
        />
      )}
    </CfWindow>
  )
}

function Choose({
  level,
  onPick
}: {
  level: number
  onPick: (m: 'build' | 'import' | 'copy') => void
}): React.JSX.Element {
  const option = ({
    id,
    title,
    text,
    icon,
    main
  }: {
    id: 'build' | 'import' | 'copy'
    title: string
    text: string
    icon: React.ReactNode
    main?: boolean
  }): React.JSX.Element => (
    <button
      type="button"
      className={`cfa-choice${main ? ' cfa-choice--main' : ''}`}
      onClick={() => onPick(id)}
    >
      <span className="cfa-choice-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="cfa-choice-text">
        <b>{title}</b>
        <span>{text}</span>
      </span>
    </button>
  )
  return (
    <div className="cfa-pad cfa-choose">
      <p className="cfa-lead">
        {level > 1 ? `The party is level ${level}. ` : ''}Pick how you’d like to bring your hero to
        the table.
      </p>
      {option({
        id: 'build',
        main: true,
        title: level > 1 ? `Build one at level ${level}` : 'Build a new character',
        text: 'The builder walks you through every choice, with a short line on what each one means.',
        icon: <PlusIcon />
      })}
      {option({
        id: 'import',
        title: 'Import a character sheet PDF',
        text: "From D&D Beyond (Export to PDF) or any filled-in 5e character sheet PDF. You check everything before it's saved.",
        icon: <FileIcon />
      })}
      {option({
        id: 'copy',
        title: 'Copy it in from another sheet',
        text: 'For Roll20 or paper: one page with the numbers that matter. About five minutes.',
        icon: <PenIcon />
      })}
      <p className="cf-sub">
        Roll20 doesn’t let players export characters, so the copy page is the quick way over.
      </p>
    </div>
  )
}

type Draft = {
  speciesId: string
  subId: string | null
  classId: string
  subclassId: string | null
  level: number
  backgroundId: string
  method: Method
  /** Standard array / rolled: which value each ability got (index into the pool) */
  assign: Partial<Record<Ability, number>>
  points: Record<Ability, number>
  rolled: number[]
  bonus: Partial<Record<Ability, number>>
  asi: AsiChoice[]
  skills: SkillId[]
  speciesSkill: SkillId | null
  equipment: RulesItem[]
  spells: SheetSpell[]
  name: string
  alignment: string
  hp: 'average' | number[]
}

function Build({
  data,
  rules,
  startLevel,
  onMade,
  say
}: {
  data: BuilderRules
  rules: RulesSet
  startLevel: number
  onMade: (c: Character) => void
  say: (m: string) => void
}): React.JSX.Element {
  const { t } = useCf()
  const [step, setStep] = useState(0)
  const [d, setD] = useState<Draft>({
    speciesId: '',
    subId: null,
    classId: '',
    subclassId: null,
    level: Math.max(1, Math.min(20, startLevel)),
    backgroundId: '',
    method: 'array',
    assign: {},
    points: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 },
    rolled: [],
    bonus: {},
    asi: [],
    skills: [],
    speciesSkill: null,
    equipment: [],
    spells: [],
    name: '',
    alignment: '',
    hp: 'average'
  })
  const [portrait, setPortrait] = useState<{ id: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Draft>): void => setD((x) => ({ ...x, ...patch }))
  const pick = pickFrom(data, d)
  const pool = d.method === 'roll' ? d.rolled : [...STANDARD_ARRAY]
  const baseScores: Record<Ability, number> =
    d.method === 'points'
      ? d.points
      : (Object.fromEntries(
          ABILITIES.map((a) => [a, d.assign[a] !== undefined ? (pool[d.assign[a]!] ?? 8) : 8])
        ) as Record<Ability, number>)
  const asiCount = pick.cls ? asiLevels(pick.cls, d.level).length : 0
  const choices: BuildChoices = {
    rules,
    name: d.name,
    speciesId: d.speciesId,
    subId: d.subId,
    classId: d.classId,
    subclassId: d.subclassId,
    level: d.level,
    backgroundId: d.backgroundId,
    base: baseScores,
    bonus: d.bonus,
    skills: [...d.skills, ...(d.speciesSkill ? [d.speciesSkill] : [])],
    asi: d.asi.slice(0, asiCount),
    hp: d.hp,
    spells: d.spells,
    equipment: d.equipment,
    alignment: d.alignment
  }
  const scores = finalScores(data, choices)
  const sheet = pick.cls ? buildSheet(data, choices) : null

  const stepDone = [
    !!pick.species &&
      (!pick.species.subs.length || !!pick.sub) &&
      (!pick.species.skillChoice || !!d.speciesSkill),
    !!pick.cls && (d.level < (pick.cls?.subclassLevel ?? 99) || !!d.subclassId),
    !!pick.bg && backgroundBonusOk(pick.bg, d.bonus),
    (d.method === 'points'
      ? (pointBuySpent(ABILITIES.map((a) => d.points[a])) ?? 99) <= POINT_BUY_BUDGET
      : ABILITIES.every((a) => d.assign[a] !== undefined) &&
        (d.method !== 'roll' || d.rolled.length === 6)) &&
      // Every Ability Score Improvement spent: +2 in all, or a feat.
      Array.from({ length: asiCount }, (_, i) => d.asi[i]).every((a) =>
        a?.kind === 'feat'
          ? !!a.featId
          : !!a && Object.values(a.plus).reduce((n: number, v) => n + (v ?? 0), 0) === 2
      ),
    !!pick.cls && d.skills.length === pick.cls.skillChoice.count,
    true,
    true,
    !!d.name.trim()
  ]
  const ready = stepDone.every(Boolean)

  const create = async (): Promise<void> => {
    if (!sheet || !ready) return
    setBusy(true)
    const r = await cf.post<Character>(`/campfire/campaigns/${t.campaign.id}/characters`, {
      kind: 'pc',
      name: d.name.trim(),
      sheet,
      ...(portrait ? { portraitFileId: portrait.id } : {})
    })
    setBusy(false)
    if (!r.ok) return say(r.message)
    onMade(r.data)
  }

  return (
    <div className="cfa-body">
      <div className="cfa-main">
        <nav aria-label="Builder steps" className="cfa-steps">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  aria-current={step === i ? 'step' : undefined}
                  className={`cfa-step${step === i ? ' cfa-step--on' : stepDone[i] ? ' cfa-step--done' : ''}`}
                  onClick={() => setStep(i)}
                >
                  {s}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="cfa-step-body">
          {step === 0 && <SpeciesStep data={data} d={d} set={set} />}
          {step === 1 && <ClassStep data={data} d={d} set={set} />}
          {step === 2 && <BackgroundStep data={data} d={d} set={set} />}
          {step === 3 && (
            <AbilityStep
              data={data}
              d={d}
              set={set}
              pool={pool}
              scores={scores}
              asiCount={asiCount}
            />
          )}
          {step === 4 && <SkillStep data={data} d={d} set={set} />}
          {step === 5 && <EquipmentStep rules={rules} d={d} set={set} />}
          {step === 6 && <SpellStep data={data} rules={rules} d={d} set={set} scores={scores} />}
          {step === 7 && (
            <NameStep
              d={d}
              set={set}
              portrait={portrait}
              onPortrait={async () => {
                const file = await pickFile(IMAGE_ACCEPT)
                if (!file) return
                const up = await uploadFile(t.campaign.id, 'portrait', file)
                if (!up.ok) return say(up.message)
                setPortrait({ id: up.data.id, url: URL.createObjectURL(file) })
              }}
              hitDie={pick.cls?.hitDie ?? 8}
            />
          )}
        </div>
      </div>
      <aside className="cfa-aside" aria-label="Your character so far">
        <div className="cfa-me">
          <span className="cfa-me-face" aria-hidden="true">
            {portrait ? <img src={portrait.url} alt="" /> : (d.name.trim()[0] ?? '?').toUpperCase()}
          </span>
          <div>
            <b>
              {d.name.trim() ||
                (pick.cls ? `Unnamed ${pick.cls.name.toLowerCase()}` : 'Your character')}
            </b>
            <span>
              {[
                pick.sub
                  ? `${pick.species?.name} (${pick.sub.name.replace(/^.*?: /, '')})`
                  : pick.species?.name,
                pick.cls ? `${pick.cls.name} ${d.level}` : null,
                pick.bg?.name
              ]
                .filter(Boolean)
                .join(' · ') || 'Nothing picked yet'}
            </span>
          </div>
        </div>
        {sheet && (
          <div className="cfa-stats">
            <div>
              <b>{sheet.ac}</b>
              <span>Armor class</span>
            </div>
            <div>
              <b>{sheet.hp.max}</b>
              <span>Hit points</span>
            </div>
            <div>
              <b>{sheet.speed} ft</b>
              <span>Speed</span>
            </div>
          </div>
        )}
        <div className="cfa-scores" aria-label="Ability scores">
          {ABILITIES.map((a) => (
            <div key={a}>
              <span>{a.toUpperCase()}</span>
              <b>{scores[a]}</b>
              <span>{signed(abilityMod(scores[a]))}</span>
            </div>
          ))}
        </div>
        <ul className="cfa-sofar">
          {pick.species && (
            <li>
              ✓ <b>{pick.species.name}</b> ·{' '}
              {pick.species.traits
                .slice(0, 3)
                .map((x) => x.name)
                .join(', ')}
            </li>
          )}
          {pick.cls && (
            <li>
              ✓ <b>{pick.cls.name}</b> · d{pick.cls.hitDie} hit die
              {pick.cls.armor.length ? `, ${pick.cls.armor.join(', ').toLowerCase()}` : ''}
            </li>
          )}
          {pick.bg && (
            <li>
              ✓ <b>{pick.bg.name}</b> · {pick.bg.skills.map((s) => SKILLS[s].name).join(', ')}
              {pick.bg.feat ? `, ${pick.bg.feat.name}` : ''}
            </li>
          )}
        </ul>
        <div className="cfa-aside-foot">
          {step < STEPS.length - 1 ? (
            <button type="button" className="cf-primary cfa-big" onClick={() => setStep(step + 1)}>
              Next: {STEPS[step + 1].toLowerCase()}
            </button>
          ) : (
            <button
              type="button"
              className="cf-primary cfa-big"
              disabled={!ready || busy}
              onClick={() => void create()}
            >
              {busy
                ? 'Saving…'
                : ready
                  ? 'Bring them to the table'
                  : 'Finish the steps marked open'}
            </button>
          )}
          {step > 0 && (
            <button type="button" className="cf-ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="cf-sub">{data.credit}</span>
        </div>
      </aside>
    </div>
  )
}

type StepProps = { data: BuilderRules; d: Draft; set: (p: Partial<Draft>) => void }

function Card({
  on,
  onClick,
  title,
  meta,
  text,
  tag,
  children
}: {
  on: boolean
  onClick: () => void
  title: string
  meta?: string
  text?: string
  tag?: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`cfa-card${on ? ' cfa-card--on' : ''}`}>
      <button type="button" aria-pressed={on} className="cfa-card-main" onClick={onClick}>
        <span className="cfa-card-top">
          <b>{title}</b>
          {meta && <span className="cfa-card-meta">{meta}</span>}
          {tag && <span className="cfa-tag">{tag}</span>}
        </span>
        {text && <span className="cfa-card-text">{text}</span>}
      </button>
      {children}
    </div>
  )
}

const short = (s: string, n = 140): string =>
  s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, '')}…` : s

function SpeciesStep({ data, d, set }: StepProps): React.JSX.Element {
  return (
    <section className="cfa-section">
      <h2>Species</h2>
      <p className="cfa-lead">
        Your species gives you traits like darkvision and how fast you move.
      </p>
      <div className="cfa-grid">
        {data.species.map((s) => (
          <Card
            key={s.id}
            on={d.speciesId === s.id}
            onClick={() => set({ speciesId: s.id, subId: null, speciesSkill: null })}
            title={s.name}
            meta={`Speed ${s.speed} ft${s.darkvision ? ` · Darkvision ${s.darkvision} ft` : ''}`}
            text={short(s.traits.map((x) => x.name).join(', '))}
            tag={s.homebrew ? "Your game master's" : undefined}
          >
            {d.speciesId === s.id && s.subs.length > 0 && (
              <div className="cfa-chips" role="radiogroup" aria-label={`${s.name} lineage`}>
                {s.subs.map((sub) => (
                  <button
                    key={sub.id}
                    type="button"
                    role="radio"
                    aria-checked={d.subId === sub.id}
                    className={`cf-chip${d.subId === sub.id ? ' cf-chip--on' : ''}`}
                    onClick={() => set({ subId: sub.id })}
                  >
                    {sub.name.replace(/^.*?: /, '')}
                    {sub.speed && sub.speed !== s.speed ? ` · ${sub.speed} ft` : ''}
                  </button>
                ))}
              </div>
            )}
            {d.speciesId === s.id && s.skillChoice && (
              <label className="cfa-inline">
                <span>Skill from your species</span>
                <select
                  value={d.speciesSkill ?? ''}
                  onChange={(e) =>
                    set({ speciesSkill: (e.target.value || null) as SkillId | null })
                  }
                >
                  <option value="">Pick one</option>
                  {s.skillChoice.from.map((k) => (
                    <option key={k} value={k}>
                      {SKILLS[k].name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </Card>
        ))}
      </div>
    </section>
  )
}

function ClassStep({ data, d, set }: StepProps): React.JSX.Element {
  const cls = data.classes.find((c) => c.id === d.classId)
  return (
    <section className="cfa-section">
      <div className="cfa-row">
        <div>
          <h2>Class</h2>
          <p className="cfa-lead">
            What your character does best. The level is the party’s; change it if your game master
            says so.
          </p>
        </div>
        <label className="cfa-inline">
          <span>Level</span>
          <input
            type="number"
            min={1}
            max={20}
            value={d.level}
            onChange={(e) =>
              set({ level: Math.max(1, Math.min(20, Number(e.target.value) || 1)), asi: [] })
            }
          />
        </label>
      </div>
      <div className="cfa-grid">
        {data.classes.map((c) => (
          <Card
            key={c.id}
            on={d.classId === c.id}
            onClick={() =>
              set({ classId: c.id, subclassId: null, skills: [], spells: [], asi: [] })
            }
            title={c.name}
            meta={`d${c.hitDie} · ${c.primary.map((a) => ABILITY_NAMES[a]).join(c.id === 'fighter' ? ' or ' : ' and ') || 'Any'}`}
            text={short(c.levels[0]?.features.map((f) => f.name).join(', ') ?? '')}
          />
        ))}
      </div>
      {cls && d.level >= cls.subclassLevel && (
        <div className="cfa-sub-pick">
          <h3>{cls.subclassLabel}</h3>
          <div className="cfa-chips" role="radiogroup" aria-label={cls.subclassLabel}>
            {cls.subclasses.map((sc) => (
              <button
                key={sc.id}
                type="button"
                role="radio"
                aria-checked={d.subclassId === sc.id}
                className={`cf-chip${d.subclassId === sc.id ? ' cf-chip--on' : ''}`}
                onClick={() => set({ subclassId: sc.id })}
              >
                {sc.name}
              </button>
            ))}
          </div>
          {cls.subclasses.find((x) => x.id === d.subclassId) && (
            <p className="cf-sub">
              {short(cls.subclasses.find((x) => x.id === d.subclassId)!.summary, 260)}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function BackgroundStep({ data, d, set }: StepProps): React.JSX.Element {
  const bg = data.backgrounds.find((b) => b.id === d.backgroundId)
  const plan = (kind: '21' | '111', first?: Ability, second?: Ability): void => {
    if (!bg?.abilities) return
    if (kind === '111') return set({ bonus: Object.fromEntries(bg.abilities.map((a) => [a, 1])) })
    if (first && second && first !== second) set({ bonus: { [first]: 2, [second]: 1 } })
  }
  const two = bg?.abilities
    ? (Object.entries(d.bonus).find(([, v]) => v === 2)?.[0] as Ability | undefined)
    : undefined
  const one = bg?.abilities
    ? (Object.entries(d.bonus).find(([, v]) => v === 1)?.[0] as Ability | undefined)
    : undefined
  const triple = !!bg?.abilities && bg.abilities.every((a) => d.bonus[a] === 1)
  return (
    <section className="cfa-section">
      <h2>Background</h2>
      <p className="cfa-lead">
        What your character did before adventuring: skills
        {data.rules === '2024' ? ', an origin feat and +3 to abilities' : ' and a feature'}.
      </p>
      <div className="cfa-grid">
        {data.backgrounds.map((b) => (
          <Card
            key={b.id}
            on={d.backgroundId === b.id}
            onClick={() =>
              set({
                backgroundId: b.id,
                bonus: b.abilities?.length === 3 ? { [b.abilities[0]]: 2, [b.abilities[1]]: 1 } : {}
              })
            }
            title={b.name}
            meta={b.skills.map((s) => SKILLS[s].name).join(', ')}
            text={
              b.feat ? `Feat: ${b.feat.name}` : b.feature ? `Feature: ${b.feature.name}` : undefined
            }
            tag={b.homebrew ? "Your game master's" : undefined}
          />
        ))}
      </div>
      {bg?.abilities?.length ? (
        <div className="cfa-box">
          <b>Ability bonuses from {bg.name}</b>
          <div className="cfa-chips" role="radiogroup" aria-label="How to spread the bonus">
            <button
              type="button"
              role="radio"
              aria-checked={!triple}
              className={`cf-chip${!triple ? ' cf-chip--on' : ''}`}
              onClick={() => plan('21', bg.abilities![0], bg.abilities![1])}
            >
              +2 and +1
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={triple}
              className={`cf-chip${triple ? ' cf-chip--on' : ''}`}
              onClick={() => plan('111')}
            >
              +1 to all three
            </button>
          </div>
          {!triple && (
            <div className="cfa-inline-row">
              <label className="cfa-inline">
                <span>+2 to</span>
                <select
                  value={two ?? ''}
                  onChange={(e) =>
                    plan(
                      '21',
                      e.target.value as Ability,
                      one && one !== e.target.value
                        ? one
                        : bg.abilities!.find((a) => a !== e.target.value)
                    )
                  }
                >
                  {bg.abilities.map((a) => (
                    <option key={a} value={a}>
                      {ABILITY_NAMES[a]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="cfa-inline">
                <span>+1 to</span>
                <select
                  value={one ?? ''}
                  onChange={(e) =>
                    plan(
                      '21',
                      two && two !== e.target.value
                        ? two
                        : bg.abilities!.find((a) => a !== e.target.value),
                      e.target.value as Ability
                    )
                  }
                >
                  {bg.abilities.map((a) => (
                    <option key={a} value={a}>
                      {ABILITY_NAMES[a]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      ) : null}
      {bg?.feat && (
        <div className="cfa-box">
          <b>Origin feat: {bg.feat.name}</b>
          <span className="cf-sub">{short(bg.feat.text.replace(/\*\*/g, ''), 320)}</span>
        </div>
      )}
    </section>
  )
}

function AbilityStep({
  data,
  d,
  set,
  pool,
  scores,
  asiCount
}: StepProps & {
  pool: number[]
  scores: Record<Ability, number>
  asiCount: number
}): React.JSX.Element {
  const pick = pickFrom(data, d)
  const used = new Set(Object.values(d.assign))
  const spent = pointBuySpent(ABILITIES.map((a) => d.points[a])) ?? 0
  const halfElf = data.rules === '2014' ? pick.species?.bonusChoice : undefined
  const suggest = (): void => {
    if (!pick.cls) return
    const order: Ability[] = [
      ...pick.cls.primary,
      'con',
      ...ABILITIES.filter((a) => !pick.cls!.primary.includes(a) && a !== 'con')
    ]
    const idx = pool.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v)
    set({
      assign: Object.fromEntries(order.slice(0, 6).map((a, k) => [a, idx[k].i])) as Partial<
        Record<Ability, number>
      >
    })
  }
  return (
    <section className="cfa-section">
      <div className="cfa-row">
        <div>
          <h2>Ability scores</h2>
          <p className="cfa-lead">
            Six numbers that say what you’re good at.{' '}
            {pick.cls ? (
              <>
                {pick.cls.name}s want{' '}
                <b>
                  {pick.cls.primary
                    .map((a) => ABILITY_NAMES[a])
                    .join(pick.cls.id === 'fighter' ? ' or ' : ' and ')}
                </b>{' '}
                first.
              </>
            ) : null}
          </p>
        </div>
        <div className="cfa-seg" role="radiogroup" aria-label="How to get your scores">
          {(
            [
              ['array', 'Standard array'],
              ['points', 'Point buy'],
              ['roll', 'Roll 4d6']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={d.method === id}
              className={d.method === id ? 'cfa-seg-on' : ''}
              onClick={() => set({ method: id, assign: {} })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {d.method === 'roll' && (
        <div className="cfa-box cfa-box--row">
          <span>
            {d.rolled.length
              ? `You rolled ${d.rolled.join(', ')}.`
              : 'Roll four six-sided dice six times; each keeps the best three.'}{' '}
            Rolled on this computer: your game master may want to watch.
          </span>
          <button
            type="button"
            className="cf-ghost"
            onClick={() =>
              set({ rolled: Array.from({ length: 6 }, () => roll4d6().total), assign: {} })
            }
          >
            {d.rolled.length ? 'Roll again' : 'Roll'}
          </button>
        </div>
      )}
      {d.method === 'points' ? (
        <p className="cfa-lead">
          <b>{POINT_BUY_BUDGET - spent}</b> of {POINT_BUY_BUDGET} points left · scores from 8 to 15
        </p>
      ) : (
        <div className="cfa-box cfa-box--row">
          <span>Left to place</span>
          {pool.map((v, i) => (
            <span key={i} className={`cfa-pool${used.has(i) ? ' cfa-pool--used' : ''}`}>
              {v}
            </span>
          ))}
          {pick.cls && (
            <button type="button" className="cf-ghost cfa-push" onClick={suggest}>
              Suggest for a {pick.cls.name.toLowerCase()}
            </button>
          )}
        </div>
      )}
      <div className="cfa-grid cfa-grid--3">
        {ABILITIES.map((a) => {
          const main = pick.cls?.primary.includes(a)
          const extra =
            scores[a] -
            (d.method === 'points'
              ? d.points[a]
              : d.assign[a] !== undefined
                ? pool[d.assign[a]!]
                : 8)
          return (
            <div key={a} className={`cfa-ability${main ? ' cfa-ability--main' : ''}`}>
              <div className="cfa-ability-top">
                <b>{ABILITY_NAMES[a]}</b>
                {main && <span className="cfa-tag">{pick.cls!.name}’s main</span>}
              </div>
              <div className="cfa-ability-row">
                {d.method === 'points' ? (
                  <span className="cfa-stepper">
                    <button
                      type="button"
                      aria-label={`Lower ${ABILITY_NAMES[a]}`}
                      disabled={d.points[a] <= 8}
                      onClick={() => set({ points: { ...d.points, [a]: d.points[a] - 1 } })}
                    >
                      −
                    </button>
                    <b>{d.points[a]}</b>
                    <button
                      type="button"
                      aria-label={`Raise ${ABILITY_NAMES[a]}`}
                      disabled={
                        d.points[a] >= 15 ||
                        spent + (POINT_BUY_COST[d.points[a] + 1] - POINT_BUY_COST[d.points[a]]) >
                          POINT_BUY_BUDGET
                      }
                      onClick={() => set({ points: { ...d.points, [a]: d.points[a] + 1 } })}
                    >
                      +
                    </button>
                  </span>
                ) : (
                  <select
                    aria-label={`${ABILITY_NAMES[a]} score`}
                    value={d.assign[a] ?? ''}
                    onChange={(e) =>
                      set({
                        assign: {
                          ...d.assign,
                          [a]: e.target.value === '' ? undefined : Number(e.target.value)
                        }
                      })
                    }
                  >
                    <option value="">Pick</option>
                    {pool.map((v, i) => (
                      <option key={i} value={i} disabled={used.has(i) && d.assign[a] !== i}>
                        {v}
                      </option>
                    ))}
                  </select>
                )}
                <span className="cfa-final">
                  <b>{scores[a]}</b>
                  <span>{signed(abilityMod(scores[a]))}</span>
                </span>
                {extra > 0 && <span className="cf-sub">+{extra} from bonuses</span>}
              </div>
            </div>
          )
        })}
      </div>
      {halfElf && (
        <div className="cfa-box">
          <b>{pick.species!.name}: +1 to two other abilities</b>
          <div className="cfa-chips">
            {ABILITIES.filter((a) => !halfElf.except.includes(a)).map((a) => {
              const on = d.bonus[a] === 1
              const count = Object.values(d.bonus).filter((v) => v === 1).length
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  className={`cf-chip${on ? ' cf-chip--on' : ''}`}
                  disabled={!on && count >= halfElf.count}
                  onClick={() => set({ bonus: { ...d.bonus, [a]: on ? 0 : 1 } })}
                >
                  {ABILITY_NAMES[a]}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {asiCount > 0 && (
        <div className="cfa-box">
          <b>
            Ability Score Improvements by level {d.level} ({asiCount})
          </b>
          {Array.from({ length: asiCount }, (_, i) => {
            const c = d.asi[i] ?? { kind: 'asi', plus: {} }
            const put = (next: AsiChoice): void => {
              const list = [...d.asi]
              while (list.length < asiCount) list.push({ kind: 'asi', plus: {} })
              list[i] = next
              set({ asi: list })
            }
            return (
              <div key={i} className="cfa-inline-row">
                <select
                  aria-label={`Improvement ${i + 1}`}
                  value={c.kind === 'feat' ? `feat:${c.featId}` : 'asi'}
                  onChange={(e) =>
                    put(
                      e.target.value === 'asi'
                        ? { kind: 'asi', plus: {} }
                        : { kind: 'feat', featId: e.target.value.slice(5) }
                    )
                  }
                >
                  <option value="asi">Raise scores</option>
                  {data.feats
                    .filter(
                      (f) =>
                        f.type !== 'origin' &&
                        f.type !== 'epic-boon' &&
                        f.type !== 'fighting-style' &&
                        f.id !== 'ability-score-improvement'
                    )
                    .map((f) => (
                      <option key={f.id} value={`feat:${f.id}`}>
                        Feat: {f.name}
                      </option>
                    ))}
                </select>
                {c.kind === 'asi' &&
                  ABILITIES.map((a) => (
                    <label key={a} className="cfa-mini">
                      <span>{a.toUpperCase()}</span>
                      <select
                        value={c.plus[a] ?? 0}
                        onChange={(e) => {
                          const plus = { ...c.plus, [a]: Number(e.target.value) }
                          const total = Object.values(plus).reduce((n, v) => n + (v ?? 0), 0)
                          if (total <= 2) put({ kind: 'asi', plus })
                        }}
                      >
                        <option value={0}>+0</option>
                        <option value={1}>+1</option>
                        <option value={2}>+2</option>
                      </select>
                    </label>
                  ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function SkillStep({ data, d, set }: StepProps): React.JSX.Element {
  const { cls, bg, species } = pickFrom(data, d)
  if (!cls) return <p className="cf-hint">Pick a class first.</p>
  const fixed = new Set<SkillId>([
    ...(bg?.skills ?? []),
    ...(species?.skills ?? []),
    ...(d.speciesSkill ? [d.speciesSkill] : [])
  ])
  return (
    <section className="cfa-section">
      <h2>Skills</h2>
      <p className="cfa-lead">
        Pick <b>{cls.skillChoice.count}</b> from the {cls.name.toLowerCase()} list (
        {d.skills.length} picked). Skills from your background and species are already yours.
      </p>
      <div className="cfa-grid cfa-grid--3">
        {cls.skillChoice.from.map((k) => {
          const on = d.skills.includes(k)
          const have = fixed.has(k)
          return (
            <button
              key={k}
              type="button"
              aria-pressed={on || have}
              disabled={have || (!on && d.skills.length >= cls.skillChoice.count)}
              className={`cfa-skill${on ? ' cfa-skill--on' : ''}${have ? ' cfa-skill--have' : ''}`}
              onClick={() =>
                set({ skills: on ? d.skills.filter((x) => x !== k) : [...d.skills, k] })
              }
            >
              <b>{SKILLS[k].name}</b>
              <span>{have ? 'Already yours' : ABILITY_NAMES[SKILLS[k].ability]}</span>
            </button>
          )
        })}
      </div>
      {fixed.size > 0 && (
        <p className="cf-sub">Also yours: {[...fixed].map((k) => SKILLS[k].name).join(', ')}</p>
      )}
    </section>
  )
}

function EquipmentStep({
  rules,
  d,
  set
}: {
  rules: RulesSet
  d: Draft
  set: (p: Partial<Draft>) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'armor' | 'weapon' | 'shield' | 'gear'>('armor')
  const [list, setList] = useState<RulesItem[]>([])
  useEffect(() => {
    const timer = window.setTimeout(() => void searchItems(rules, q, kind).then(setList), 150)
    return () => window.clearTimeout(timer)
  }, [rules, q, kind])
  return (
    <section className="cfa-section">
      <h2>Equipment</h2>
      <p className="cfa-lead">
        Armor and weapons you start with. Armor sets your armor class; weapons show up in Actions
        with their numbers worked out.
      </p>
      <div className="cfa-row">
        <div className="cfa-seg" role="radiogroup" aria-label="What kind">
          {(['armor', 'shield', 'weapon', 'gear'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'cfa-seg-on' : ''}
              onClick={() => setKind(k)}
            >
              {k === 'gear' ? 'Gear' : `${k[0].toUpperCase()}${k.slice(1)}s`}
            </button>
          ))}
        </div>
        <input
          className="cfa-search"
          type="search"
          placeholder="Search"
          aria-label="Search equipment"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <ul className="cfa-list">
        {list.slice(0, 30).map((it) => (
          <li key={it.id}>
            <span>
              <b>{it.name}</b>
              <span className="cf-sub">
                {it.armor
                  ? `AC ${it.armor.base}${it.armor.dex ? (it.armor.maxDex === null ? ' + Dex' : ` + Dex (max ${it.armor.maxDex})`) : ''}`
                  : it.weapon
                    ? `${it.weapon.damage} ${it.weapon.type}${it.weapon.mastery ? ` · ${it.weapon.mastery}` : ''}`
                    : it.kind === 'shield'
                      ? '+2 AC'
                      : ''}{' '}
                · {it.weight} lb
              </span>
            </span>
            <button
              type="button"
              className="cf-ghost cf-small"
              onClick={() => set({ equipment: [...d.equipment, it] })}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
      {d.equipment.length > 0 && (
        <div className="cfa-box">
          <b>Taking</b>
          <div className="cfa-chips">
            {d.equipment.map((it, i) => (
              <button
                key={`${it.id}-${i}`}
                type="button"
                className="cf-chip cf-chip--on"
                aria-label={`Remove ${it.name}`}
                onClick={() => set({ equipment: d.equipment.filter((_, j) => j !== i) })}
              >
                {it.name} ×
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function SpellStep({
  data,
  rules,
  d,
  set,
  scores
}: StepProps & { rules: RulesSet; scores: Record<Ability, number> }): React.JSX.Element {
  const { cls } = pickFrom(data, d)
  const [list, setList] = useState<SrdSpellSummary[]>([])
  const [q, setQ] = useState('')
  const row = cls?.levels.find((l) => l.level === d.level)
  const maxLevel = row
    ? (row.pact?.level ?? row.slots.reduce((top, n, i) => (n ? i + 1 : top), 0))
    : 0
  const counts = cls?.spellAbility
    ? spellCounts(cls, d.level, abilityMod(scores[cls.spellAbility]))
    : { cantrips: 0, spells: 0 }
  useEffect(() => {
    if (!cls?.spellAbility) return
    const timer = window.setTimeout(
      () =>
        void searchSpells(rules, q, { cls: cls.name }).then((s) =>
          setList(s.filter((x) => x.level <= maxLevel))
        ),
      150
    )
    return () => window.clearTimeout(timer)
  }, [rules, q, cls, maxLevel])
  if (!cls?.spellAbility)
    return (
      <section className="cfa-section">
        <h2>Spells</h2>
        <p className="cfa-lead">
          {cls
            ? `${cls.name}s don't cast spells (some subclasses do later).`
            : 'Pick a class first.'}
        </p>
      </section>
    )
  const cantrips = d.spells.filter((s) => s.level === 0).length
  const leveled = d.spells.filter((s) => s.level > 0).length
  const add = async (s: SrdSpellSummary): Promise<void> => {
    const full = await spellDetails(rules, s.slug)
    if (full) set({ spells: [...d.spells, sheetSpellFrom(full)] })
  }
  return (
    <section className="cfa-section">
      <h2>Spells</h2>
      <p className="cfa-lead">
        {counts.cantrips ? `${cantrips} of ${counts.cantrips} cantrips · ` : ''}
        {leveled} of {counts.spells} spells{maxLevel ? ` (up to level ${maxLevel})` : ''}.
        Spellcasting uses {ABILITY_NAMES[cls.spellAbility]}.
      </p>
      <input
        className="cfa-search"
        type="search"
        placeholder={`${cls.name} spells`}
        aria-label="Search spells"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="cfa-list">
        {list.slice(0, 40).map((s) => {
          const have = d.spells.some((x) => x.slug === s.slug)
          const full = s.level === 0 ? cantrips >= counts.cantrips : leveled >= counts.spells
          return (
            <li key={s.slug}>
              <span>
                <b>{s.name}</b>
                <span className="cf-sub">
                  {s.level === 0 ? 'Cantrip' : `Level ${s.level}`} · {s.school}
                </span>
              </span>
              <button
                type="button"
                className="cf-ghost cf-small"
                disabled={have || full}
                onClick={() => void add(s)}
              >
                {have ? 'Picked' : 'Pick'}
              </button>
            </li>
          )
        })}
      </ul>
      {d.spells.length > 0 && (
        <div className="cfa-chips">
          {d.spells.map((s) => (
            <button
              key={s.name}
              type="button"
              className="cf-chip cf-chip--on"
              aria-label={`Remove ${s.name}`}
              onClick={() => set({ spells: d.spells.filter((x) => x.name !== s.name) })}
            >
              {s.name} ×
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function NameStep({
  d,
  set,
  portrait,
  onPortrait,
  hitDie
}: {
  d: Draft
  set: (p: Partial<Draft>) => void
  portrait: { url: string } | null
  onPortrait: () => void
  hitDie: number
}): React.JSX.Element {
  return (
    <section className="cfa-section">
      <h2>Name and portrait</h2>
      <div className="cfa-name">
        <button
          type="button"
          className="cfa-portrait"
          onClick={onPortrait}
          aria-label={portrait ? 'Change portrait' : 'Upload a portrait'}
        >
          {portrait ? <img src={portrait.url} alt="" /> : <span>Upload a portrait</span>}
        </button>
        <div className="cfa-name-fields">
          <label className="cf-field">
            <span>Name</span>
            <input
              value={d.name}
              maxLength={60}
              placeholder="Lyra"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="cf-field">
            <span>Alignment (optional)</span>
            <input
              value={d.alignment}
              maxLength={40}
              placeholder="Chaotic good"
              onChange={(e) => set({ alignment: e.target.value })}
            />
          </label>
          <p className="cf-sub">
            Your portrait shows on your token, in the turn order and on your rolls.
          </p>
        </div>
      </div>
      {d.level > 1 && (
        <div className="cfa-box">
          <b>Hit points after level 1</b>
          <div className="cfa-chips" role="radiogroup" aria-label="Hit points">
            <button
              type="button"
              role="radio"
              aria-checked={d.hp === 'average'}
              className={`cf-chip${d.hp === 'average' ? ' cf-chip--on' : ''}`}
              onClick={() => set({ hp: 'average' })}
            >
              Take the average ({Math.floor(hitDie / 2) + 1} a level)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={Array.isArray(d.hp)}
              className={`cf-chip${Array.isArray(d.hp) ? ' cf-chip--on' : ''}`}
              onClick={() =>
                set({
                  hp: Array.from(
                    { length: d.level - 1 },
                    () => 1 + Math.floor(Math.random() * hitDie)
                  )
                })
              }
            >
              {Array.isArray(d.hp) ? `Rolled ${d.hp.join(', ')}` : `Roll 1d${hitDie} each level`}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function PlusIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function FileIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M12 18v-6M9 15l3 3 3-3" />
    </svg>
  )
}
function PenIcon(): React.JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9l-4-4L4 16z" />
    </svg>
  )
}

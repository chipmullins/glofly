// Campfire: fifth edition rules math (SRD 5.1). Pure functions over a Sheet5e, used by the server
// (attacks, damage, rests) and the apps (the sheet's numbers), so both always agree.

import { critDice, parseDice } from './dice'
import {
  ABILITIES,
  DAMAGE_TYPES,
  type Ability,
  type CasterType,
  type ConditionId,
  type CreatureSize,
  type DamageType,
  type DeathSaves,
  type Sheet5e,
  type SheetAttack,
  type SheetClass,
  type SheetItem,
  type SheetSpell,
  type SkillId,
  type SkillLevel
} from './types'

// ───────────── Abilities, proficiency, skills ─────────────

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2)

/** +2 at levels 1–4, +3 at 5–8 … +6 at 17–20. */
export const profBonus = (level: number): number => 2 + Math.floor((Math.min(Math.max(level, 1), 20) - 1) / 4)

export const SKILLS: Record<SkillId, { name: string; ability: Ability }> = {
  acrobatics: { name: 'Acrobatics', ability: 'dex' },
  animalHandling: { name: 'Animal Handling', ability: 'wis' },
  arcana: { name: 'Arcana', ability: 'int' },
  athletics: { name: 'Athletics', ability: 'str' },
  deception: { name: 'Deception', ability: 'cha' },
  history: { name: 'History', ability: 'int' },
  insight: { name: 'Insight', ability: 'wis' },
  intimidation: { name: 'Intimidation', ability: 'cha' },
  investigation: { name: 'Investigation', ability: 'int' },
  medicine: { name: 'Medicine', ability: 'wis' },
  nature: { name: 'Nature', ability: 'int' },
  perception: { name: 'Perception', ability: 'wis' },
  performance: { name: 'Performance', ability: 'cha' },
  persuasion: { name: 'Persuasion', ability: 'cha' },
  religion: { name: 'Religion', ability: 'int' },
  sleightOfHand: { name: 'Sleight of Hand', ability: 'dex' },
  stealth: { name: 'Stealth', ability: 'dex' },
  survival: { name: 'Survival', ability: 'wis' }
}
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[]

export const totalLevel = (sheet: Pick<Sheet5e, 'classes'>): number => sheet.classes.reduce((n, c) => n + c.level, 0)
/** The sheet's proficiency bonus (a monster's stat block number, or from total level). */
export const sheetProf = (sheet: Sheet5e): number => sheet.profOverride ?? profBonus(Math.max(1, totalLevel(sheet)))
const mod = (sheet: Sheet5e, a: Ability) => abilityMod(sheet.abilities[a])

export function saveBonus(sheet: Sheet5e, ability: Ability): number {
  const fixed = sheet.saveOverrides[ability]
  if (typeof fixed === 'number') return fixed
  return mod(sheet, ability) + (sheet.saves[ability] ? sheetProf(sheet) : 0)
}

export function skillBonus(sheet: Sheet5e, skill: SkillId): number {
  const fixed = sheet.skillOverrides[skill]
  if (typeof fixed === 'number') return fixed
  return mod(sheet, SKILLS[skill].ability) + (sheet.skills[skill] ?? 0) * sheetProf(sheet)
}

export const passivePerception = (sheet: Sheet5e): number => 10 + skillBonus(sheet, 'perception')
export const initiativeBonus = (sheet: Sheet5e): number => mod(sheet, 'dex') + sheet.initiativeBonus

const spellMod = (sheet: Sheet5e) => (sheet.spellcasting.ability ? mod(sheet, sheet.spellcasting.ability) : 0)
export const spellSaveDc = (sheet: Sheet5e): number => 8 + sheetProf(sheet) + spellMod(sheet)
export const spellAttackBonus = (sheet: Sheet5e): number => sheetProf(sheet) + spellMod(sheet)

/** "1d20" + 7 → "1d20+7"; − for negatives; nothing for 0. */
export const withBonus = (expr: string, n: number): string => (n > 0 ? `${expr}+${n}` : n < 0 ? `${expr}-${-n}` : expr)

export function attackToHit(sheet: Sheet5e, attack: SheetAttack): number {
  if (attack.fixedToHit !== null) return attack.fixedToHit
  const ability = attack.ability === 'spell' ? sheet.spellcasting.ability : attack.ability
  return (ability ? mod(sheet, ability) : 0) + (attack.proficient ? sheetProf(sheet) : 0) + attack.bonus
}

/** What to roll for an attack: { toHit: '1d20+7', damage: '1d8+4', critDamage: '2d8+4' }. */
export function attackExpressions(sheet: Sheet5e, attack: SheetAttack): { toHit: string; damage: string; critDamage: string } {
  const ability = attack.ability === 'spell' ? sheet.spellcasting.ability : attack.ability
  const damage = attack.damageAbility && ability ? withBonus(attack.damage, mod(sheet, ability)) : attack.damage
  return { toHit: withBonus('1d20', attackToHit(sheet, attack)), damage, critDamage: critDice(damage) }
}

// ───────────── Damage, healing, death saves ─────────────

export type DamageMods = { resist?: boolean; vulnerable?: boolean; immune?: boolean }

/** A creature's resistances for one damage type (from its sheet). */
export function damageModsFor(sheet: Sheet5e | null, type: DamageType | null): DamageMods {
  if (!sheet || !type) return {}
  return { resist: sheet.resist.includes(type), vulnerable: sheet.vulnerable.includes(type), immune: sheet.immune.includes(type) }
}

/** Damage after immunity (0), resistance (half, rounded down) and vulnerability (double). */
export function adjustedDamage(amount: number, mods: DamageMods = {}): number {
  let n = Math.max(0, Math.floor(amount))
  if (mods.immune) return 0
  if (mods.resist) n = Math.floor(n / 2)
  if (mods.vulnerable) n *= 2
  return n
}

/** Takes damage: temporary HP first, then HP (never below 0). */
export function applyDamage(hp: number, temp: number, amount: number, mods: DamageMods = {}): { hp: number; temp: number; taken: number } {
  const taken = adjustedDamage(amount, mods)
  const fromTemp = Math.min(Math.max(temp, 0), taken)
  return { hp: Math.max(0, hp - (taken - fromTemp)), temp: Math.max(temp, 0) - fromTemp, taken }
}

/**
 * Massive damage (5e): if the damage left over after dropping to 0 HP (or the damage taken while
 * already at 0) is at least the creature's hit point maximum, it dies outright. Temp HP soak first.
 */
export function instantDeath(hp: number, temp: number, taken: number, max: number): boolean {
  if (max <= 0) return false
  const afterTemp = Math.max(0, taken - Math.max(0, temp))
  return afterTemp - Math.max(0, hp) >= max
}

export const heal = (hp: number, max: number, amount: number): number => Math.min(max, Math.max(0, hp) + Math.max(0, Math.floor(amount)))

export const hpState = (value: number, max: number): 'healthy' | 'bloodied' | 'defeated' =>
  value <= 0 ? 'defeated' : max > 0 && value <= max / 2 ? 'bloodied' : 'healthy'

export const NO_DEATH_SAVES: DeathSaves = { successes: 0, failures: 0, stable: false, dead: false }

/**
 * One death saving throw (a d20, natural): 20 = back up with 1 HP, 1 = two failures, 10+ success.
 * Three successes: stable. Three failures: dead.
 */
export function deathSave(roll: number, state: DeathSaves): { state: DeathSaves; outcome: 'success' | 'failure' | 'stable' | 'dead' | 'revived' } {
  if (state.dead) return { state, outcome: 'dead' }
  if (roll >= 20) return { state: { ...NO_DEATH_SAVES }, outcome: 'revived' }
  if (roll >= 10) {
    const successes = Math.min(3, state.successes + 1)
    return successes >= 3 ? { state: { ...NO_DEATH_SAVES, successes: 3, stable: true }, outcome: 'stable' } : { state: { ...state, successes }, outcome: 'success' }
  }
  return deathSaveFailures(state, roll <= 1 ? 2 : 1)
}

/** Failures from a failed save or from taking damage at 0 HP (a critical hit counts twice). */
export function deathSaveFailures(state: DeathSaves, n: number): { state: DeathSaves; outcome: 'failure' | 'dead' } {
  const failures = Math.min(3, state.failures + n)
  return failures >= 3
    ? { state: { ...state, failures: 3, stable: false, dead: true }, outcome: 'dead' }
    : { state: { ...state, failures, stable: false }, outcome: 'failure' }
}

/** Concentration save after damage: DC 10 or half the damage, whichever is higher. */
export const concentrationDc = (damage: number): number => Math.max(10, Math.floor(damage / 2))

// ───────────── Rests ─────────────

/** A short rest: short-rest resources and pact slots come back. (Spending hit dice is the player's call.) */
export function shortRest(sheet: Sheet5e): Sheet5e {
  return {
    ...sheet,
    resources: sheet.resources.map((r) => (r.reset === 'short' ? { ...r, used: 0 } : r)),
    spellcasting: { ...sheet.spellcasting, pact: sheet.spellcasting.pact ? { ...sheet.spellcasting.pact, used: 0 } : null }
  }
}

/**
 * A long rest: full HP, no temporary HP, every resource and slot back, half the hit dice back
 * (at least one, biggest dice first), death saves reset, one level of exhaustion gone.
 */
export function longRest(sheet: Sheet5e): Sheet5e {
  const total = sheet.hitDice.reduce((n, d) => n + d.max, 0)
  let back = Math.max(1, Math.floor(total / 2))
  const hitDice = [...sheet.hitDice]
    .sort((a, b) => b.die - a.die)
    .map((d) => {
      const n = Math.min(back, d.used)
      back -= n
      return { ...d, used: d.used - n }
    })
  return {
    ...shortRest(sheet),
    hp: { current: sheet.hp.max, max: sheet.hp.max, temp: 0 },
    hitDice: sheet.hitDice.map((d) => hitDice.find((h) => h.die === d.die) ?? d),
    resources: sheet.resources.map((r) => (r.reset === 'none' ? r : { ...r, used: 0 })),
    spellcasting: {
      ...sheet.spellcasting,
      slots: sheet.spellcasting.slots.map((s) => ({ ...s, used: 0 })),
      pact: sheet.spellcasting.pact ? { ...sheet.spellcasting.pact, used: 0 } : null
    },
    deathSaves: { ...NO_DEATH_SAVES },
    exhaustion: Math.max(0, sheet.exhaustion - 1),
    conditions: sheet.conditions.filter((c) => c !== 'unconscious' || sheet.hp.max <= 0),
    concentration: null
  }
}

// ───────────── Conditions ─────────────

export const CONDITIONS: readonly { id: ConditionId; name: string }[] = [
  { id: 'blinded', name: 'Blinded' },
  { id: 'charmed', name: 'Charmed' },
  { id: 'deafened', name: 'Deafened' },
  { id: 'frightened', name: 'Frightened' },
  { id: 'grappled', name: 'Grappled' },
  { id: 'incapacitated', name: 'Incapacitated' },
  { id: 'invisible', name: 'Invisible' },
  { id: 'paralyzed', name: 'Paralyzed' },
  { id: 'petrified', name: 'Petrified' },
  { id: 'poisoned', name: 'Poisoned' },
  { id: 'prone', name: 'Prone' },
  { id: 'restrained', name: 'Restrained' },
  { id: 'stunned', name: 'Stunned' },
  { id: 'unconscious', name: 'Unconscious' },
  { id: 'exhaustion', name: 'Exhaustion' }
]
export const isCondition = (x: unknown): x is ConditionId => typeof x === 'string' && CONDITIONS.some((c) => c.id === x)
/** What each level of exhaustion does (they add up). */
export const EXHAUSTION_LEVELS: readonly string[] = [
  'Disadvantage on ability checks',
  'Speed halved',
  'Disadvantage on attack rolls and saving throws',
  'Hit point maximum halved',
  'Speed reduced to 0',
  'Death'
]
/** Token markers beyond the 5e conditions (the token's conditions may also carry these). */
export const TOKEN_MARKERS: readonly string[] = ['concentrating', 'dead', 'defeated', 'hidden', 'blessed', 'hexed', 'marked']

// ───────────── Spell slots ─────────────

const FULL: number[][] = [
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 2, 1, 1]
]
const pad = (row: number[]) => [...row, ...Array(9 - row.length).fill(0)] as number[]
/** Slots per spell level (index 0 = 1st), by class level 1–20. */
export const SPELL_SLOTS: {
  full: number[][]
  half: number[][]
  third: number[][]
  pact: { slots: number; level: number }[]
} = {
  full: FULL.map(pad),
  // Paladins and rangers: nothing at 1st level, then the full table at half their level (rounded up).
  half: Array.from({ length: 20 }, (_, i) => (i === 0 ? pad([]) : pad(FULL[Math.ceil((i + 1) / 2) - 1]))),
  // Eldritch Knights and Arcane Tricksters: from 3rd level, the full table at a third (rounded up).
  third: Array.from({ length: 20 }, (_, i) => (i < 2 ? pad([]) : pad(FULL[Math.ceil((i + 1) / 3) - 1]))),
  pact: [
    { slots: 1, level: 1 }, { slots: 2, level: 1 }, { slots: 2, level: 2 }, { slots: 2, level: 2 }, { slots: 2, level: 3 },
    { slots: 2, level: 3 }, { slots: 2, level: 4 }, { slots: 2, level: 4 }, { slots: 2, level: 5 }, { slots: 2, level: 5 },
    { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 },
    { slots: 3, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 }
  ]
}

/**
 * Slots for a character's classes. One spellcasting class uses its own table; several add up by
 * the multiclass rule (full levels + half of half-caster levels + a third of third-caster levels,
 * rounded down). Pact magic is separate.
 */
export function slotsForClasses(classes: SheetClass[]): { slots: number[]; pact: { slots: number; level: number } | null } {
  const lvl = (c: SheetClass) => Math.min(20, Math.max(1, c.level))
  const casters = classes.filter((c) => c.caster === 'full' || c.caster === 'half' || c.caster === 'third')
  let slots = pad([])
  if (casters.length === 1) slots = SPELL_SLOTS[casters[0].caster as 'full' | 'half' | 'third'][lvl(casters[0]) - 1]
  else if (casters.length > 1) {
    const level = casters.reduce((n, c) => n + (c.caster === 'full' ? lvl(c) : c.caster === 'half' ? Math.floor(lvl(c) / 2) : Math.floor(lvl(c) / 3)), 0)
    if (level > 0) slots = SPELL_SLOTS.full[Math.min(20, level) - 1]
  }
  const warlock = classes.filter((c) => c.caster === 'pact').reduce((n, c) => n + lvl(c), 0)
  return { slots: [...slots], pact: warlock ? SPELL_SLOTS.pact[Math.min(20, warlock) - 1] : null }
}

// ───────────── Challenge ratings, sizes ─────────────

export const XP_BY_CR: Record<string, number> = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900,
  '8': 3900, '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000,
  '17': 18000, '18': 20000, '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000,
  '25': 75000, '26': 90000, '27': 105000, '28': 120000, '29': 135000, '30': 155000
}
/** 0.125 → "1/8". */
export const crLabel = (cr: number): string => (cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr))
export const xpForCr = (cr: number): number => XP_BY_CR[crLabel(cr)] ?? 0

/** How many grid cells a creature takes up on each side. */
export const sizeCells = (size: CreatureSize): number => ({ tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 })[size] ?? 1
export const CREATURE_SIZES: readonly CreatureSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']

// ───────────── Blank and cleaned-up sheets ─────────────

export function blankSheet(): Sheet5e {
  return {
    version: 1,
    race: '',
    background: '',
    alignment: '',
    classes: [],
    size: 'medium',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: {},
    skills: {},
    saveOverrides: {},
    skillOverrides: {},
    profOverride: null,
    ac: 10,
    speed: 30,
    otherSpeeds: '',
    hp: { current: 10, max: 10, temp: 0 },
    hitDice: [],
    initiativeBonus: 0,
    attacks: [],
    spellcasting: { ability: null, slots: Array.from({ length: 9 }, () => ({ max: 0, used: 0 })), pact: null, spells: [] },
    resources: [],
    deathSaves: { ...NO_DEATH_SAVES },
    conditions: [],
    exhaustion: 0,
    concentration: null,
    resist: [],
    vulnerable: [],
    immune: [],
    inventory: [],
    features: [],
    notes: '',
    locked: false,
    monster: null
  }
}

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
const str = (x: unknown, max: number, def = ''): string =>
  typeof x === 'string' ? x.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, max) : def
const int = (x: unknown, lo: number, hi: number, def: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : def
const num = (x: unknown, lo: number, hi: number, def: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def
const list = <T>(x: unknown, max: number, each: (v: unknown, i: number) => T | null): T[] =>
  Array.isArray(x) ? x.slice(0, max).map(each).filter((v): v is T => v !== null) : []
const idOf = (x: unknown, i: number, prefix: string): string => (typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x) ? x : `${prefix}${i}`)
const isAbility = (x: unknown): x is Ability => typeof x === 'string' && (ABILITIES as readonly string[]).includes(x)
export const isDamageType = (x: unknown): x is DamageType => typeof x === 'string' && (DAMAGE_TYPES as readonly string[]).includes(x)
const CASTERS: readonly CasterType[] = ['none', 'full', 'half', 'third', 'pact']
/** A damage expression a sheet may keep: one that parses, kept short. */
const diceText = (x: unknown, def: string): string => {
  const s = str(x, 60).trim()
  return s && parseDice(s).ok ? s : def
}
const features = (x: unknown, max: number, prefix: string) =>
  list(x, max, (v, i) => {
    const o = obj(v)
    const name = str(o.name, 100).trim()
    return name ? { id: idOf(o.id, i, prefix), name, text: str(o.text, 4000) } : null
  })

export const SHEET_LIMITS = { attacks: 40, spells: 300, resources: 40, items: 200, features: 100, classes: 6, notes: 20_000 } as const

/**
 * Turns whatever an app sent into a valid sheet: unknown fields dropped, numbers clamped, text cut
 * to size, lists capped. Never throws; anything unusable gets the blank sheet's value.
 */
export function normalizeSheet(raw: unknown): Sheet5e {
  const s = obj(raw)
  const base = blankSheet()
  const abilities = obj(s.abilities)
  const hp = obj(s.hp)
  const spell = obj(s.spellcasting)
  const pact = s.spellcasting && spell.pact ? obj(spell.pact) : null
  const death = obj(s.deathSaves)
  const monster = s.monster ? obj(s.monster) : null
  const sizes = CREATURE_SIZES as readonly string[]
  const abilityRecord = <T>(x: unknown, each: (v: unknown) => T | undefined): Partial<Record<Ability, T>> => {
    const o = obj(x)
    const out: Partial<Record<Ability, T>> = {}
    for (const a of ABILITIES) {
      const v = each(o[a])
      if (v !== undefined) out[a] = v
    }
    return out
  }
  const skillRecord = <T>(x: unknown, each: (v: unknown) => T | undefined): Partial<Record<SkillId, T>> => {
    const o = obj(x)
    const out: Partial<Record<SkillId, T>> = {}
    for (const k of SKILL_IDS) {
      const v = each(o[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  const fixed = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? int(v, -30, 50, 0) : undefined)
  const damageList = (x: unknown) => [...new Set(list(x, 13, (v) => (isDamageType(v) ? v : null)))]
  const hpMax = int(hp.max, 0, 99_999, base.hp.max)
  return {
    version: 1,
    race: str(s.race, 60),
    background: str(s.background, 60),
    alignment: str(s.alignment, 40),
    classes: list(s.classes, SHEET_LIMITS.classes, (v): SheetClass | null => {
      const o = obj(v)
      const name = str(o.name, 40).trim()
      if (!name) return null
      const caster = CASTERS.includes(o.caster as CasterType) ? (o.caster as CasterType) : 'none'
      const subclass = str(o.subclass, 40).trim()
      return {
        name,
        level: int(o.level, 1, 20, 1),
        hitDie: [6, 8, 10, 12].includes(o.hitDie as number) ? (o.hitDie as number) : 8,
        caster,
        ...(subclass ? { subclass } : {})
      }
    }),
    size: sizes.includes(s.size as string) ? (s.size as CreatureSize) : 'medium',
    abilities: Object.fromEntries(ABILITIES.map((a) => [a, int(abilities[a], 1, 30, 10)])) as Record<Ability, number>,
    saves: abilityRecord(s.saves, (v) => (v === true ? true : undefined)),
    skills: skillRecord(s.skills, (v) => (v === 1 || v === 2 ? (v as SkillLevel) : undefined)),
    saveOverrides: abilityRecord(s.saveOverrides, fixed),
    skillOverrides: skillRecord(s.skillOverrides, fixed),
    profOverride: typeof s.profOverride === 'number' ? int(s.profOverride, 0, 12, 2) : null,
    ac: int(s.ac, 0, 50, base.ac),
    speed: int(s.speed, 0, 500, base.speed),
    otherSpeeds: str(s.otherSpeeds, 120),
    hp: { max: hpMax, current: int(hp.current, 0, hpMax, hpMax), temp: int(hp.temp, 0, 99_999, 0) },
    hitDice: [
      ...new Map(
        list(s.hitDice, 4, (v) => {
          const o = obj(v)
          if (![6, 8, 10, 12].includes(o.die as number)) return null
          const max = int(o.max, 0, 20, 0)
          return { die: o.die as number, max, used: int(o.used, 0, max, 0) }
        }).map((d) => [d.die, d])
      ).values()
    ],
    initiativeBonus: int(s.initiativeBonus, -20, 20, 0),
    attacks: list(s.attacks, SHEET_LIMITS.attacks, (v, i): SheetAttack | null => {
      const o = obj(v)
      const name = str(o.name, 80).trim()
      if (!name) return null
      return {
        id: idOf(o.id, i, 'a'),
        name,
        kind: o.kind === 'ranged' || o.kind === 'spell' ? o.kind : 'melee',
        ability: isAbility(o.ability) || o.ability === 'spell' ? (o.ability as Ability | 'spell') : null,
        proficient: o.proficient === true,
        bonus: int(o.bonus, -20, 20, 0),
        fixedToHit: typeof o.fixedToHit === 'number' ? int(o.fixedToHit, -20, 40, 0) : null,
        damage: diceText(o.damage, '1d4'),
        damageAbility: o.damageAbility === true,
        damageType: isDamageType(o.damageType) ? o.damageType : 'bludgeoning',
        range: str(o.range, 40),
        notes: str(o.notes, 500)
      }
    }),
    spellcasting: {
      ability: isAbility(spell.ability) ? spell.ability : null,
      slots: Array.from({ length: 9 }, (_, i) => {
        const o = obj(Array.isArray(spell.slots) ? spell.slots[i] : null)
        const max = int(o.max, 0, 9, 0)
        return { max, used: int(o.used, 0, max, 0) }
      }),
      pact: pact
        ? (() => {
            const max = int(pact.max, 0, 9, 0)
            return { level: int(pact.level, 1, 9, 1), max, used: int(pact.used, 0, max, 0) }
          })()
        : null,
      spells: list(spell.spells, SHEET_LIMITS.spells, (v) => {
        const o = obj(v)
        const name = str(o.name, 80).trim()
        if (!name) return null
        const slug = typeof o.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(o.slug) ? o.slug : null
        const extra: Partial<SheetSpell> = {}
        for (const k of ['castingTime', 'range', 'duration'] as const) {
          const v = str(o[k], 60).trim()
          if (v) extra[k] = v
        }
        if (o.concentration === true) extra.concentration = true
        const rollText = diceText(o.roll, '')
        if (rollText) extra.roll = rollText
        const notes = str(o.notes, 300).trim()
        if (notes) extra.notes = notes
        return { slug, name, level: int(o.level, 0, 9, 0), prepared: o.prepared === true, ...extra }
      })
    },
    resources: list(s.resources, SHEET_LIMITS.resources, (v, i) => {
      const o = obj(v)
      const name = str(o.name, 60).trim()
      if (!name) return null
      const max = int(o.max, 0, 999, 0)
      return { id: idOf(o.id, i, 'r'), name, max, used: int(o.used, 0, max, 0), reset: o.reset === 'short' || o.reset === 'none' ? o.reset : 'long' }
    }),
    deathSaves: {
      successes: int(death.successes, 0, 3, 0),
      failures: int(death.failures, 0, 3, 0),
      stable: death.stable === true,
      dead: death.dead === true
    },
    conditions: [...new Set(list(s.conditions, 15, (v) => (isCondition(v) ? v : null)))],
    exhaustion: int(s.exhaustion, 0, 6, 0),
    concentration: typeof s.concentration === 'string' && s.concentration.trim() ? str(s.concentration, 80).trim() : null,
    resist: damageList(s.resist),
    vulnerable: damageList(s.vulnerable),
    immune: damageList(s.immune),
    inventory: list(s.inventory, SHEET_LIMITS.items, (v, i) => {
      const o = obj(v)
      const name = str(o.name, 80).trim()
      return name ? { id: idOf(o.id, i, 'i'), name, qty: int(o.qty, 0, 99_999, 1), notes: str(o.notes, 500), ...itemExtras(o) } : null
    }),
    features: features(s.features, SHEET_LIMITS.features, 'f'),
    notes: str(s.notes, SHEET_LIMITS.notes),
    locked: s.locked === true,
    monster: monster
      ? {
          cr: num(monster.cr, 0, 30, 0),
          xp: int(monster.xp, 0, 1_000_000, 0),
          type: str(monster.type, 60),
          alignment: str(monster.alignment, 60),
          senses: str(monster.senses, 300),
          languages: str(monster.languages, 300),
          traits: features(monster.traits, 40, 't'),
          actions: features(monster.actions, 40, 'x'),
          legendary: features(monster.legendary, 20, 'l'),
          reactions: features(monster.reactions, 20, 'e'),
          conditionImmunities: list(monster.conditionImmunities, 15, (v) => (typeof v === 'string' ? str(v, 30) : null))
        }
      : null,
    ...optionalExtras(s)
  }
}

/** The optional fields (Nov 10, 2026): only present when set, so older sheets stay as they were. */
function optionalExtras(s: Record<string, unknown>): Partial<Sheet5e> {
  const out: Partial<Sheet5e> = {}
  if (typeof s.xp === 'number' && Number.isFinite(s.xp)) out.xp = int(s.xp, 0, 1_000_000, 0)
  if (s.inspiration === true) out.inspiration = true
  const acNote = str(s.acNote, 60).trim()
  if (acNote) out.acNote = acNote
  const senses = str(s.senses, 200).trim()
  if (senses) out.senses = senses
  if (s.coins && typeof s.coins === 'object') {
    const c = obj(s.coins)
    out.coins = { cp: int(c.cp, 0, 9_999_999, 0), sp: int(c.sp, 0, 9_999_999, 0), ep: int(c.ep, 0, 9_999_999, 0), gp: int(c.gp, 0, 9_999_999, 0), pp: int(c.pp, 0, 9_999_999, 0) }
  }
  if (s.rules === '2014' || s.rules === '2024') out.rules = s.rules
  if (s.build && typeof s.build === 'object') {
    const b = obj(s.build)
    const slug = (x: unknown) => (typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x) ? x : undefined)
    const build: NonNullable<Sheet5e['build']> = {}
    for (const k of ['species', 'sub', 'background', 'classId', 'subclass'] as const) {
      const v = slug(b[k])
      if (v) build[k] = v
    }
    const feats = list(b.feats, 40, (v) => slug(v) ?? null)
    if (feats.length) build.feats = feats
    if (Object.keys(build).length) out.build = build
  }
  return out
}

const ITEM_KINDS = ['armor', 'shield', 'weapon', 'gear', 'magic', 'ammo'] as const
/** An item's optional fields (Round A), only when set. */
function itemExtras(o: Record<string, unknown>): Partial<SheetItem> {
  const out: Partial<SheetItem> = {}
  if (typeof o.weight === 'number' && Number.isFinite(o.weight)) out.weight = num(o.weight, 0, 10_000, 0)
  if (o.equipped === true) out.equipped = true
  if (o.attuned === true) out.attuned = true
  if (typeof o.kind === 'string' && (ITEM_KINDS as readonly string[]).includes(o.kind)) out.kind = o.kind as SheetItem['kind']
  if (o.armor && typeof o.armor === 'object') {
    const a = obj(o.armor)
    out.armor = { base: int(a.base, 0, 30, 10), dex: a.dex === true, maxDex: typeof a.maxDex === 'number' ? int(a.maxDex, 0, 10, 2) : null }
  }
  if (typeof o.acBonus === 'number') out.acBonus = int(o.acBonus, -5, 10, 0)
  if (o.attunement === true) out.attunement = true
  const rarity = str(o.rarity, 30).trim()
  if (rarity) out.rarity = rarity
  for (const k of ['attackId', 'homebrewId'] as const) if (typeof o[k] === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(o[k] as string)) out[k] = o[k] as string
  return out
}

/**
 * The armor class from what's equipped (Round A): the best equipped armor (or 10 + Dexterity
 * without any), plus shields and magic bonuses of equipped (and, when needed, attuned) items.
 * Null when nothing equipped says anything about AC, so the sheet keeps its own number.
 */
export function armorClassFromItems(sheet: Pick<Sheet5e, 'inventory' | 'abilities'>): number | null {
  const dexMod = abilityMod(sheet.abilities.dex)
  const worn = sheet.inventory.filter((i) => i.equipped && (!i.attunement || i.attuned))
  const armors = worn.filter((i) => i.armor)
  const bonus = worn.reduce((n, i) => n + (i.acBonus ?? 0), 0)
  if (!armors.length && !bonus) return null
  const base = armors.length
    ? Math.max(...armors.map((i) => i.armor!.base + (i.armor!.dex ? (i.armor!.maxDex === null ? dexMod : Math.min(dexMod, i.armor!.maxDex)) : 0)))
    : 10 + dexMod
  return base + bonus
}

/** Pounds carried (items × weight, plus 50 coins to the pound). */
export function carriedWeight(sheet: Pick<Sheet5e, 'inventory' | 'coins'>): number {
  const items = sheet.inventory.reduce((n, i) => n + (i.weight ?? 0) * i.qty, 0)
  const c = sheet.coins
  const coins = c ? (c.cp + c.sp + c.ep + c.gp + c.pp) / 50 : 0
  return Math.round((items + coins) * 10) / 10
}

/** "Fighter 3 / Wizard 2" (or the monster's type and CR). */
export function classLine(sheet: Sheet5e): string {
  if (sheet.monster) return `${sheet.monster.type || 'Creature'} · CR ${crLabel(sheet.monster.cr)}`
  return sheet.classes.map((c) => `${c.name} ${c.level}`).join(' / ')
}

// ───────────── Experience, hit dice formula ─────────────

/** XP needed to reach each level (index 0 = level 1). */
export const XP_FOR_LEVEL: readonly number[] = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000,
  265000, 305000, 355000
]
/** The XP for the next level (null at 20). */
export const nextLevelXp = (level: number): number | null => (level >= 20 ? null : XP_FOR_LEVEL[Math.max(1, level)])

/**
 * A creature's hit points as dice ("7d10+21"): its hit dice plus its Constitution modifier for each
 * (a monster's stat block formula). Null without hit dice.
 */
export function hitPointFormula(sheet: Sheet5e): string | null {
  const dice = sheet.hitDice.filter((d) => d.max > 0)
  if (!dice.length) return null
  const count = dice.reduce((n, d) => n + d.max, 0)
  return withBonus(dice.map((d) => `${d.max}d${d.die}`).join('+'), abilityMod(sheet.abilities.con) * count)
}

// Campfire Round A (Nov 2026): the two 5e rule sets a campaign can use, and the shape of the
// character-builder data the server sends (species, classes, backgrounds, feats, equipment), built
// from the SRDs by tools/campfire-srd/build.mjs. Both SRDs are CC BY 4.0: show `creditFor(rules)`.

import type { Ability, CasterType, CreatureSize, DamageType, SkillId } from './types'

export type RulesSet = '2014' | '2024'
export const RULES_SETS: readonly RulesSet[] = ['2014', '2024']
export const isRulesSet = (x: unknown): x is RulesSet => x === '2014' || x === '2024'
/** Campaigns made before Round A used the 2014 rules (SRD 5.1). */
export const rulesOf = (settings: { rules?: unknown } | null | undefined): RulesSet => (isRulesSet(settings?.rules) ? settings.rules : '2014')

export const SRD_CREDIT_2024 =
  'Includes material from the System Reference Document 5.2 by Wizards of the Coast LLC, licensed under CC BY 4.0.'
export const creditFor = (rules: RulesSet): string =>
  rules === '2024'
    ? SRD_CREDIT_2024
    : 'Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.'
export const RULES_LABEL: Record<RulesSet, string> = { '2014': '5e, 2014 rules', '2024': '5e, 2024 rules' }

export type RulesText = { name: string; text: string }

export type BuilderSpecies = {
  id: string
  name: string
  size: CreatureSize
  /** Some species let you pick Small or Medium */
  sizeOptions?: CreatureSize[]
  speed: number
  darkvision: number
  traits: RulesText[]
  /** 2014 rules: the species' ability score increases */
  bonuses?: Partial<Record<Ability, number>>
  /** 2014 half-elf: +1 to N other abilities of your choice */
  bonusChoice?: { count: number; amount: number; except: Ability[] }
  /** Skills the species always gives */
  skills?: SkillId[]
  /** "Choose one skill" (2024 elf: keen senses, human: skillful) */
  skillChoice?: { count: number; from: SkillId[] }
  resist?: DamageType[]
  subs: BuilderSubspecies[]
  /** Homebrew from the campaign's game master */
  homebrew?: boolean
}
export type BuilderSubspecies = {
  id: string
  name: string
  traits: RulesText[]
  speed?: number
  darkvision?: number
  bonuses?: Partial<Record<Ability, number>>
  resist?: DamageType[]
}

export type BuilderLevel = {
  level: number
  features: RulesText[]
  /** An Ability Score Improvement (or a feat) at this level */
  asi: boolean
  cantrips?: number
  /** 2024: spells prepared. 2014: spells known (bards, rangers, sorcerers, warlocks) */
  spells?: number
  /** Slots per spell level (index 0 = 1st) */
  slots: number[]
  /** Warlocks */
  pact?: { level: number; slots: number }
}

export type BuilderClass = {
  id: string
  name: string
  hitDie: number
  primary: Ability[]
  saves: Ability[]
  /** "Light armor, Medium armor, Shields" */
  armor: string[]
  weapons: string[]
  skillChoice: { count: number; from: SkillId[] }
  caster: CasterType
  spellAbility: Ability | null
  /** 2014 prepared casters: how many they prepare ('level' = class level + modifier, 'half' = half level + modifier) */
  prepared?: 'level' | 'half'
  subclassLevel: number
  subclassLabel: string
  subclasses: { id: string; name: string; summary: string; features: (RulesText & { level: number })[]; homebrew?: boolean }[]
  levels: BuilderLevel[]
}

export type BuilderBackground = {
  id: string
  name: string
  skills: SkillId[]
  /** 2024: the three abilities it can raise (+2/+1 or +1/+1/+1) */
  abilities?: Ability[]
  /** 2024: its origin feat */
  feat?: RulesText & { id: string }
  tools: string
  feature?: RulesText
  gold: number
  homebrew?: boolean
}

export type BuilderFeat = RulesText & { id: string; type: string; repeatable: boolean; prerequisite: string }

export type ItemKind = 'armor' | 'shield' | 'weapon' | 'gear' | 'magic' | 'ammo'
export type RulesItem = {
  id: string
  name: string
  kind: ItemKind
  weight: number
  /** Cost in gp (0.1 = 1 sp) */
  cost: number
  armor?: { base: number; dex: boolean; maxDex: number | null; category: 'light' | 'medium' | 'heavy'; stealthDis: boolean; strMin: number }
  weapon?: { damage: string; type: DamageType; versatile?: string; ranged: boolean; range: string; finesse: boolean; properties: string[]; mastery?: string; category: 'simple' | 'martial' }
  magic?: { rarity: string; attunement: boolean; text: string }
  text?: string
}

/** Everything the character builder needs for one rule set. */
export type BuilderRules = {
  rules: RulesSet
  species: BuilderSpecies[]
  classes: BuilderClass[]
  backgrounds: BuilderBackground[]
  feats: BuilderFeat[]
  credit: string
}

// ───────────── Character building math (both rule sets) ─────────────

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const
/** Point buy: 27 points, scores 8–15 */
export const POINT_BUY_BUDGET = 27
export const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }
export function pointBuySpent(scores: number[]): number | null {
  let n = 0
  for (const s of scores) {
    const c = POINT_BUY_COST[s]
    if (c === undefined) return null
    n += c
  }
  return n
}

/** 4d6, drop the lowest (with a given rng for tests). */
export function roll4d6(rng: () => number = Math.random): { total: number; dice: number[] } {
  const dice = Array.from({ length: 4 }, () => 1 + Math.floor(rng() * 6)).sort((a, b) => b - a)
  return { total: dice[0] + dice[1] + dice[2], dice }
}

/** Average hit points for a level after the first (5e: half the die + 1). */
export const averageHitDie = (die: number): number => Math.floor(die / 2) + 1

/** Hit points for a single-class character at a level, taking the average after level 1. */
export function startingHitPoints(hitDie: number, level: number, conMod: number, perLevelBonus = 0): number {
  const lv = Math.max(1, Math.min(20, Math.floor(level)))
  return Math.max(1, hitDie + conMod + perLevelBonus + (lv - 1) * (averageHitDie(hitDie) + conMod + perLevelBonus))
}

/** 2014 prepared casters: how many spells they prepare. */
export function preparedCount(kind: 'level' | 'half', classLevel: number, mod: number): number {
  return Math.max(1, (kind === 'half' ? Math.floor(classLevel / 2) : classLevel) + mod)
}

// ───────────── Inventory (Round A) ─────────────

export type Coins = { cp: number; sp: number; ep: number; gp: number; pp: number }
export const NO_COINS: Coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 }
export const coinsInGp = (c: Coins): number => c.pp * 10 + c.gp + c.ep / 2 + c.sp / 10 + c.cp / 100

/**
 * Splits coins evenly between people (no exchange between coin kinds): each gets the same,
 * the leftovers stay in the pot.
 */
export function splitCoins(pot: Coins, people: number): { each: Coins; left: Coins } {
  const n = Math.max(1, Math.floor(people))
  const each = { ...NO_COINS }
  const left = { ...NO_COINS }
  for (const k of Object.keys(NO_COINS) as (keyof Coins)[]) {
    each[k] = Math.floor(Math.max(0, pot[k]) / n)
    left[k] = Math.max(0, pot[k]) - each[k] * n
  }
  return { each, left }
}

/** Carrying capacity in pounds (Strength × 15; Small or Medium). */
export const carryingCapacity = (str: number, size: CreatureSize = 'medium'): number =>
  Math.max(0, str) * 15 * (size === 'tiny' ? 0.5 : size === 'large' ? 2 : size === 'huge' ? 4 : size === 'gargantuan' ? 8 : 1)

/** The most magic items a character can be attuned to at once. */
export const ATTUNEMENT_MAX = 3

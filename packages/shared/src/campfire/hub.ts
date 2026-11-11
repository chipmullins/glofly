// Campfire Round A (Nov 2026): the campaign hub (sessions, RSVPs, recaps, quests, journal, party
// loot), the campaign's own homebrew, and switching over from another tool mid-campaign. The
// server cleans everything apps send with the normalize* helpers here.

import type { Ability, CreatureSize, DamageType, SheetItem, SkillId } from './types'
import { ABILITIES, DAMAGE_TYPES } from './types'
import { NO_COINS, type BuilderBackground, type BuilderRules, type BuilderSpecies, type Coins, type RulesText } from './rulesData'

export type SessionRsvp = 'yes' | 'maybe' | 'no'
export const SESSION_RSVPS: readonly SessionRsvp[] = ['yes', 'maybe', 'no']

/** What the server counts while a session is played (the recap draft is made from it). */
export type SessionStats = {
  fights: number
  rolls: number
  crits: number
  fumbles: number
  /** "Goblin" → 5 */
  defeated: Record<string, number>
  /** PCs that dropped to 0 HP: name → times */
  downs: Record<string, number>
  biggest: { name: string; amount: number } | null
}
export const EMPTY_STATS: SessionStats = { fights: 0, rolls: 0, crits: 0, fumbles: 0, defeated: {}, downs: {}, biggest: null }

export type CampfireSession = {
  id: string
  number: number
  title: string
  /** Planned start (null: not scheduled) */
  startsAt: string | null
  /** Posted recap (players see it once posted) */
  recap: string
  recapPostedAt: string | null
  stats: SessionStats
  rsvps: { userId: string; answer: SessionRsvp }[]
  /** "Before Campfire": the story so far, for campaigns that switched over */
  before?: boolean
}

export type QuestStatus = 'open' | 'done' | 'failed'
export type Quest = {
  id: string
  title: string
  detail: string
  giver: string
  status: QuestStatus
  /** Only game masters see it */
  hidden: boolean
  sort: number
}

export type JournalKind = 'npc' | 'place' | 'item' | 'lore'
export type JournalEntry = {
  id: string
  kind: JournalKind
  name: string
  text: string
  hidden: boolean
  /** Game masters only (never sent to players) */
  gmNotes?: string
  pictureFileId: string | null
}

export type LootItem = { id: string; name: string; qty: number; notes: string; homebrewId?: string }
export type PartyLoot = { coins: Coins; items: LootItem[] }
export const EMPTY_LOOT: PartyLoot = { coins: { ...NO_COINS }, items: [] }

/** Where a campaign stood when it moved to Campfire (and how the party levels). */
export type CampaignProgress = {
  /** Sessions played before Campfire */
  sessionsBefore: number
  /** The party's level (milestones; with XP each sheet has its own) */
  level: number
}
export const DEFAULT_PROGRESS: CampaignProgress = { sessionsBefore: 0, level: 1 }

/** One party member on the hub. */
export type PartyMember = { characterId: string; ownerId: string | null; name: string; portraitFileId: string | null; line: string; level: number }

export type CampaignHub = {
  campaignId: string
  pitch: string
  bannerFileId: string | null
  progress: CampaignProgress
  sessions: CampfireSession[]
  quests: Quest[]
  journal: JournalEntry[]
  loot: PartyLoot
  party: PartyMember[]
  homebrewCounts: Partial<Record<HomebrewKind, number>>
}

// ───────────── Homebrew ─────────────

export type HomebrewKind = 'item' | 'spell' | 'monster' | 'species' | 'subclass' | 'background' | 'feat'
export const HOMEBREW_KINDS: readonly HomebrewKind[] = ['item', 'spell', 'monster', 'species', 'subclass', 'background', 'feat']

export type HomebrewItem = {
  itemKind: 'armor' | 'shield' | 'weapon' | 'gear' | 'magic'
  rarity: string
  text: string
  weight: number
  attunement: boolean
  /** What Campfire does with it */
  acBonus?: number
  armor?: { base: number; dex: boolean; maxDex: number | null }
  attack?: { damage: string; type: DamageType; bonus: number; ranged: boolean; finesse: boolean }
  speed?: string
  charges?: number
}
export type HomebrewSpell = { level: number; school: string; castingTime: string; range: string; duration: string; concentration: boolean; text: string; roll?: string; classes: string[] }
export type HomebrewSpecies = { size: CreatureSize; speed: number; darkvision: number; traits: RulesText[]; bonuses?: Partial<Record<Ability, number>>; skills?: SkillId[]; resist?: DamageType[] }
export type HomebrewSubclass = { classId: string; summary: string; features: (RulesText & { level: number })[] }
export type HomebrewBackground = { skills: SkillId[]; abilities?: Ability[]; tools: string; text: string }
export type HomebrewFeat = { text: string; prerequisite: string }
/** A monster: its stat block is the NPC sheet (normalized like any sheet). */
export type HomebrewMonster = { characterId?: string; cr: number; type: string; text: string }

export type HomebrewData =
  | HomebrewItem
  | HomebrewSpell
  | HomebrewSpecies
  | HomebrewSubclass
  | HomebrewBackground
  | HomebrewFeat
  | HomebrewMonster

export type Homebrew = { id: string; kind: HomebrewKind; name: string; shared: boolean; data: HomebrewData; updatedAt: string }

export const HUB_LIMITS = {
  sessions: 500,
  quests: 200,
  journal: 500,
  homebrew: 500,
  lootItems: 200,
  title: 100,
  text: 8000,
  recap: 20_000,
  pitch: 300
} as const

// ───────────── Cleaning what apps send ─────────────

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
const str = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/\u0000/g, '').slice(0, max) : '')
const line = (x: unknown, max: number): string => str(x, max).replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
const int = (x: unknown, lo: number, hi: number, def: number): number =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : def
const isAbility = (x: unknown): x is Ability => typeof x === 'string' && (ABILITIES as readonly string[]).includes(x)
const isDamage = (x: unknown): x is DamageType => typeof x === 'string' && (DAMAGE_TYPES as readonly string[]).includes(x)
const slug = (x: unknown): string | undefined => (typeof x === 'string' && /^[a-z0-9-]{1,80}$/.test(x) ? x : undefined)
const SKILLS = [
  'acrobatics', 'animalHandling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation',
  'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleightOfHand', 'stealth', 'survival'
]
const skills = (x: unknown): SkillId[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is SkillId => typeof s === 'string' && SKILLS.includes(s)))].slice(0, 18) : [])
const texts = (x: unknown, max: number, withLevel = false) =>
  (Array.isArray(x) ? x.slice(0, max) : [])
    .map((v) => {
      const o = obj(v)
      const name = line(o.name, 100)
      if (!name) return null
      return { name, text: str(o.text, 4000), ...(withLevel ? { level: int(o.level, 1, 20, 1) } : {}) }
    })
    .filter((v): v is RulesText & { level: number } => v !== null)
const bonuses = (x: unknown): Partial<Record<Ability, number>> | undefined => {
  const o = obj(x)
  const out: Partial<Record<Ability, number>> = {}
  for (const a of ABILITIES) if (typeof o[a] === 'number') out[a] = int(o[a], -5, 5, 0)
  return Object.keys(out).length ? out : undefined
}

export function normalizeCoins(x: unknown): Coins {
  const o = obj(x)
  return { cp: int(o.cp, 0, 9_999_999, 0), sp: int(o.sp, 0, 9_999_999, 0), ep: int(o.ep, 0, 9_999_999, 0), gp: int(o.gp, 0, 9_999_999, 0), pp: int(o.pp, 0, 9_999_999, 0) }
}

export function normalizeLoot(x: unknown): PartyLoot {
  const o = obj(x)
  const items = (Array.isArray(o.items) ? o.items.slice(0, HUB_LIMITS.lootItems) : [])
    .map((v, i) => {
      const it = obj(v)
      const name = line(it.name, 80)
      if (!name) return null
      const id = typeof it.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(it.id) ? it.id : `l${i}`
      const homebrewId = typeof it.homebrewId === 'string' && /^[0-9a-f-]{36}$/.test(it.homebrewId) ? it.homebrewId : undefined
      return { id, name, qty: int(it.qty, 1, 99_999, 1), notes: str(it.notes, 300), ...(homebrewId ? { homebrewId } : {}) }
    })
    .filter((v): v is LootItem => v !== null)
  return { coins: normalizeCoins(o.coins), items }
}

export function normalizeProgress(x: unknown): CampaignProgress {
  const o = obj(x)
  return { sessionsBefore: int(o.sessionsBefore, 0, 999, 0), level: int(o.level, 1, 20, 1) }
}

export function normalizeStats(x: unknown): SessionStats {
  const o = obj(x)
  const counts = (v: unknown) => {
    const c = obj(v)
    const out: Record<string, number> = {}
    for (const [k, n] of Object.entries(c).slice(0, 60)) {
      const name = line(k, 60)
      if (name) out[name] = int(n, 0, 9999, 0)
    }
    return out
  }
  const b = o.biggest ? obj(o.biggest) : null
  return {
    fights: int(o.fights, 0, 9999, 0),
    rolls: int(o.rolls, 0, 999_999, 0),
    crits: int(o.crits, 0, 99_999, 0),
    fumbles: int(o.fumbles, 0, 99_999, 0),
    defeated: counts(o.defeated),
    downs: counts(o.downs),
    biggest: b && line(b.name, 60) ? { name: line(b.name, 60), amount: int(b.amount, 0, 99_999, 0) } : null
  }
}

/** A homebrew entry's data for its kind (unknown fields dropped). Null when it isn't usable. */
export function normalizeHomebrew(kind: HomebrewKind, raw: unknown): HomebrewData | null {
  const o = obj(raw)
  switch (kind) {
    case 'item': {
      const k = ['armor', 'shield', 'weapon', 'gear', 'magic'].includes(o.itemKind as string) ? (o.itemKind as HomebrewItem['itemKind']) : 'magic'
      const out: HomebrewItem = { itemKind: k, rarity: line(o.rarity, 30), text: str(o.text, HUB_LIMITS.text), weight: int(o.weight, 0, 9999, 0), attunement: o.attunement === true }
      if (typeof o.acBonus === 'number') out.acBonus = int(o.acBonus, -5, 10, 0)
      if (o.armor) {
        const a = obj(o.armor)
        out.armor = { base: int(a.base, 0, 30, 10), dex: a.dex === true, maxDex: typeof a.maxDex === 'number' ? int(a.maxDex, 0, 10, 2) : null }
      }
      if (o.attack) {
        const a = obj(o.attack)
        const damage = line(a.damage, 40)
        if (/^\d{1,2}d\d{1,3}([+-]\d{1,3})?$/.test(damage.replace(/\s+/g, '')))
          out.attack = { damage: damage.replace(/\s+/g, ''), type: isDamage(a.type) ? a.type : 'slashing', bonus: int(a.bonus, -5, 10, 0), ranged: a.ranged === true, finesse: a.finesse === true }
      }
      const speed = line(o.speed, 40)
      if (speed) out.speed = speed
      if (typeof o.charges === 'number') out.charges = int(o.charges, 0, 99, 0)
      return out
    }
    case 'spell':
      return {
        level: int(o.level, 0, 9, 0),
        school: line(o.school, 30),
        castingTime: line(o.castingTime, 60),
        range: line(o.range, 60),
        duration: line(o.duration, 60),
        concentration: o.concentration === true,
        text: str(o.text, HUB_LIMITS.text),
        ...(/^\d{1,2}d\d{1,3}([+-]\d{1,3})?$/.test(line(o.roll, 30)) ? { roll: line(o.roll, 30) } : {}),
        classes: (Array.isArray(o.classes) ? o.classes : []).map((c) => line(c, 30)).filter(Boolean).slice(0, 12)
      }
    case 'species': {
      const sizes: CreatureSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']
      const resist = (Array.isArray(o.resist) ? o.resist : []).filter(isDamage)
      return {
        size: sizes.includes(o.size as CreatureSize) ? (o.size as CreatureSize) : 'medium',
        speed: int(o.speed, 0, 120, 30),
        darkvision: int(o.darkvision, 0, 300, 0),
        traits: texts(o.traits, 20),
        ...(bonuses(o.bonuses) ? { bonuses: bonuses(o.bonuses) } : {}),
        ...(skills(o.skills).length ? { skills: skills(o.skills) } : {}),
        ...(resist.length ? { resist } : {})
      }
    }
    case 'subclass': {
      const classId = slug(o.classId)
      if (!classId) return null
      return { classId, summary: str(o.summary, 600), features: texts(o.features, 30, true) as HomebrewSubclass['features'] }
    }
    case 'background':
      return { skills: skills(o.skills), ...(Array.isArray(o.abilities) ? { abilities: o.abilities.filter(isAbility).slice(0, 3) } : {}), tools: line(o.tools, 200), text: str(o.text, HUB_LIMITS.text) }
    case 'feat':
      return { text: str(o.text, HUB_LIMITS.text), prerequisite: line(o.prerequisite, 100) }
    case 'monster':
      return {
        ...(typeof o.characterId === 'string' && /^[0-9a-f-]{36}$/.test(o.characterId) ? { characterId: o.characterId } : {}),
        cr: typeof o.cr === 'number' && Number.isFinite(o.cr) ? Math.min(30, Math.max(0, o.cr)) : 0,
        type: line(o.type, 60),
        text: str(o.text, HUB_LIMITS.text)
      }
  }
}

// ───────────── The recap draft ─────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A first draft of a session's recap from what the server counted (the GM edits it). */
export function recapDraft(stats: SessionStats): string {
  const parts: string[] = []
  if (stats.fights) parts.push(`The party fought ${stats.fights === 1 ? 'once' : `${stats.fights} times`}.`)
  const defeated = Object.entries(stats.defeated)
  if (defeated.length) parts.push(`Defeated: ${defeated.map(([n, c]) => (c > 1 ? `${c} × ${n}` : n)).join(', ')}.`)
  const downs = Object.entries(stats.downs)
  if (downs.length) parts.push(`${downs.map(([n, c]) => (c > 1 ? `${n} (${c} times)` : n)).join(' and ')} went down to 0 HP.`)
  if (stats.biggest) parts.push(`Biggest hit: ${stats.biggest.name}, ${stats.biggest.amount} damage.`)
  if (stats.crits) parts.push(`${plural(stats.crits, 'natural 20')}${stats.fumbles ? ` and ${plural(stats.fumbles, 'natural 1')}` : ''}.`)
  return parts.join(' ')
}

/** "2 fights", "5 defeated" … for the recap's chips. */
export function statChips(stats: SessionStats): string[] {
  const out: string[] = []
  if (stats.fights) out.push(plural(stats.fights, 'fight'))
  const defeated = Object.values(stats.defeated).reduce((a, b) => a + b, 0)
  if (defeated) out.push(`${defeated} defeated`)
  if (stats.crits) out.push(plural(stats.crits, 'natural 20'))
  if (stats.biggest) out.push(`Biggest hit: ${stats.biggest.name}, ${stats.biggest.amount}`)
  return out
}

/** A homebrew item as an inventory entry's extra fields (the server's loot "give" and the sheet's
 *  "Add from homebrew" both use it). */
export function homebrewSheetItem(data: Partial<HomebrewItem>, id: string): Partial<SheetItem> {
  return {
    kind: data.itemKind === 'armor' || data.itemKind === 'shield' || data.itemKind === 'weapon' || data.itemKind === 'gear' ? data.itemKind : 'magic',
    weight: data.weight ?? 0,
    ...(data.attunement ? { attunement: true } : {}),
    ...(data.rarity ? { rarity: data.rarity } : {}),
    ...(typeof data.acBonus === 'number' && data.acBonus ? { acBonus: data.acBonus } : {}),
    ...(data.armor ? { armor: data.armor } : {}),
    homebrewId: id
  }
}

/** The campaign's shared homebrew species and backgrounds, as builder entries. */
export function withHomebrew(data: BuilderRules, brew: Homebrew[]): BuilderRules {
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
  const backgrounds: BuilderBackground[] = brew
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


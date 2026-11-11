// Campfire Round A: turning character-builder choices into a sheet, and leveling a sheet up. Pure
// functions over the builder data (rulesData.ts), so the desktop/web builder and the phone builder
// make exactly the same character. Both rule sets: 2014 (species give ability bonuses) and 2024
// (backgrounds give them, plus an origin feat).

import { ABILITIES, type Ability, type CreatureSize, type DamageType, type Sheet5e, type SheetAttack, type SheetFeature, type SheetItem, type SheetSpell, type SkillId, type SrdSpell } from './types'
import { abilityMod, armorClassFromItems, blankSheet, normalizeSheet } from './rules5e'
import {
  averageHitDie,
  type BuilderBackground,
  type BuilderClass,
  type BuilderFeat,
  type BuilderRules,
  type BuilderSpecies,
  type RulesItem,
  type RulesSet
} from './rulesData'

/** An Ability Score Improvement level's choice: +2 to one / +1 to two, or a feat. */
export type AsiChoice = { kind: 'asi'; plus: Partial<Record<Ability, number>> } | { kind: 'feat'; featId: string }

export type BuildChoices = {
  rules: RulesSet
  name: string
  speciesId: string
  subId?: string | null
  size?: CreatureSize
  classId: string
  subclassId?: string | null
  /** 1–20 (players joining a campaign that's further along start higher) */
  level: number
  backgroundId: string
  /** The six scores before any bonus (standard array, point buy or rolled) */
  base: Record<Ability, number>
  /** 2024: the background's +2/+1 or +1/+1/+1. 2014: the half-elf's +1s. */
  bonus: Partial<Record<Ability, number>>
  /** Class skill picks, plus the species' pick (2024 elf, human) */
  skills: SkillId[]
  /** One per Ability Score Improvement level reached, in order */
  asi: AsiChoice[]
  /** Hit points after level 1: 'average', or the rolled values (one per level after the first) */
  hp: 'average' | number[]
  spells: SheetSpell[]
  equipment: RulesItem[]
  alignment?: string
}

export type BuildPick = { species: BuilderSpecies | null; sub: BuilderSpecies['subs'][number] | null; cls: BuilderClass | null; bg: BuilderBackground | null }
export function pickFrom(data: BuilderRules, c: Pick<BuildChoices, 'speciesId' | 'subId' | 'classId' | 'backgroundId'>): BuildPick {
  const species = data.species.find((s) => s.id === c.speciesId) ?? null
  return {
    species,
    sub: species?.subs.find((s) => s.id === c.subId) ?? null,
    cls: data.classes.find((x) => x.id === c.classId) ?? null,
    bg: data.backgrounds.find((b) => b.id === c.backgroundId) ?? null
  }
}

/** How many Ability Score Improvements a class has by this level. */
export const asiLevels = (cls: BuilderClass, level: number): number[] => cls.levels.filter((l) => l.level <= level && l.asi).map((l) => l.level)

/** The final ability scores: base + species (2014) + chosen bonus + improvements, capped at 20. */
export function finalScores(data: BuilderRules, c: BuildChoices): Record<Ability, number> {
  const { species, sub } = pickFrom(data, c)
  const out = { ...c.base }
  const add = (b: Partial<Record<Ability, number>> | undefined) => {
    for (const a of ABILITIES) if (b?.[a]) out[a] = out[a] + b[a]!
  }
  if (data.rules === '2014') {
    add(species?.bonuses)
    add(sub?.bonuses)
  }
  add(c.bonus)
  for (const choice of c.asi) if (choice.kind === 'asi') add(choice.plus)
  for (const a of ABILITIES) out[a] = Math.max(1, Math.min(20, out[a]))
  return out
}

/** Checks a 2024 background bonus: +2/+1 or +1/+1/+1, only to the background's three abilities. */
export function backgroundBonusOk(bg: BuilderBackground | null, bonus: Partial<Record<Ability, number>>): boolean {
  if (!bg?.abilities?.length) return true
  const entries = Object.entries(bonus).filter(([, v]) => v)
  if (entries.some(([a]) => !bg.abilities!.includes(a as Ability))) return false
  const values = entries.map(([, v]) => v!).sort((a, b) => b - a)
  return JSON.stringify(values) === '[2,1]' || JSON.stringify(values) === '[1,1,1]'
}

const featureList = (items: { name: string; text: string }[], prefix: string): SheetFeature[] =>
  items.map((f, i) => ({ id: `${prefix}${i}`, name: f.name.slice(0, 100), text: f.text.slice(0, 4000) }))

/** A weapon from the rules as a sheet attack (finesse picks the better of Strength and Dexterity). */
export function attackFromItem(item: RulesItem, scores: Record<Ability, number>, id: string, proficient = true): SheetAttack | null {
  const w = item.weapon
  if (!w) return null
  const ability: Ability = w.ranged ? 'dex' : w.finesse && abilityMod(scores.dex) > abilityMod(scores.str) ? 'dex' : 'str'
  return {
    id,
    name: item.name,
    kind: w.ranged ? 'ranged' : 'melee',
    ability,
    proficient,
    bonus: 0,
    fixedToHit: null,
    damage: w.damage,
    damageAbility: true,
    damageType: w.type,
    range: w.range,
    notes: [w.mastery ? `Mastery: ${w.mastery}` : '', w.versatile ? `Two hands: ${w.versatile}` : ''].filter(Boolean).join(' · ')
  }
}

/** A rules item as an inventory entry (equipped for armor, shields and weapons). */
export function inventoryFromItem(item: RulesItem, id: string, equip = true): SheetItem {
  const out: SheetItem = { id, name: item.name, qty: item.kind === 'ammo' ? 20 : 1, notes: '', weight: item.weight, kind: item.kind }
  if (item.armor) out.armor = { base: item.armor.base, dex: item.armor.dex, maxDex: item.armor.maxDex }
  if (item.kind === 'shield') out.acBonus = 2
  if (item.magic) {
    if (item.magic.attunement) out.attunement = true
    if (item.magic.rarity) out.rarity = item.magic.rarity
    out.notes = item.magic.text.slice(0, 500)
  }
  if (equip && (item.kind === 'armor' || item.kind === 'shield' || item.kind === 'weapon')) out.equipped = true
  return out
}

/** Hit points: the class die at level 1, then the average (or what was rolled), plus Constitution each level. */
export function hitPointsFor(cls: BuilderClass, level: number, conMod: number, hp: BuildChoices['hp'], perLevel = 0): number {
  let total = cls.hitDie + conMod + perLevel
  for (let l = 2; l <= level; l++) {
    const rolled = Array.isArray(hp) ? hp[l - 2] : undefined
    total += Math.max(1, (rolled ?? averageHitDie(cls.hitDie)) + conMod + perLevel)
  }
  return Math.max(1, total)
}

/** Dwarven Toughness: +1 HP per level (both rule sets). */
const toughness = (species: BuilderSpecies | null, sub: BuildPick['sub']): number =>
  [...(species?.traits ?? []), ...(sub?.traits ?? [])].some((t) => /toughness/i.test(t.name)) ? 1 : 0

/** Builds the character sheet from the builder's choices. */
/** Class-table rows that only mark "your subclass gives a feature here". */
const SUBCLASS_SLOT = /(^|\s)(subclass|subclass feature|archetype feature)$/i

export function buildSheet(data: BuilderRules, c: BuildChoices, feats: BuilderFeat[] = data.feats): Sheet5e {
  const { species, sub, cls, bg } = pickFrom(data, c)
  const sheet = blankSheet()
  if (!cls) return sheet
  const level = Math.max(1, Math.min(20, Math.floor(c.level)))
  const scores = finalScores(data, c)
  const conMod = abilityMod(scores.con)
  const subclass = cls.subclasses.find((s) => s.id === c.subclassId) ?? null
  const reached = cls.levels.filter((l) => l.level <= level)
  const top = reached[reached.length - 1]
  sheet.rules = data.rules
  sheet.race = sub ? `${species?.name ?? ''} (${sub.name.replace(/^.*?: /, '')})` : (species?.name ?? '')
  sheet.background = bg?.name ?? ''
  sheet.alignment = c.alignment ?? ''
  sheet.size = c.size ?? species?.size ?? 'medium'
  sheet.abilities = scores
  sheet.classes = [{ name: cls.name, level, hitDie: cls.hitDie, caster: cls.caster, ...(subclass && level >= cls.subclassLevel ? { subclass: subclass.name } : {}) }]
  sheet.saves = Object.fromEntries(cls.saves.map((a) => [a, true]))
  const skillSet = new Set<SkillId>([...c.skills, ...(bg?.skills ?? []), ...(species?.skills ?? [])])
  sheet.skills = Object.fromEntries([...skillSet].map((s) => [s, 1 as const]))
  sheet.speed = sub?.speed ?? species?.speed ?? 30
  const dv = sub?.darkvision ?? species?.darkvision ?? 0
  if (dv) sheet.senses = `Darkvision ${dv} ft`
  sheet.resist = [...new Set<DamageType>([...(species?.resist ?? []), ...(sub?.resist ?? [])])]
  const max = hitPointsFor(cls, level, conMod, c.hp, toughness(species, sub))
  sheet.hp = { current: max, max, temp: 0 }
  sheet.hitDice = [{ die: cls.hitDie, max: level, used: 0 }]
  // Spellcasting from the class table at this level.
  if (cls.spellAbility && top) {
    sheet.spellcasting.ability = cls.spellAbility
    sheet.spellcasting.slots = Array.from({ length: 9 }, (_, i) => ({ max: top.slots[i] ?? 0, used: 0 }))
    sheet.spellcasting.pact = top.pact ? { level: top.pact.level, max: top.pact.slots, used: 0 } : null
    sheet.spellcasting.spells = c.spells.slice(0, 300)
  }
  // Features: species, background (2024: its origin feat), class and subclass up to this level, and feats taken.
  const taken = c.asi.filter((x): x is { kind: 'feat'; featId: string } => x.kind === 'feat').map((x) => feats.find((f) => f.id === x.featId)).filter((f): f is BuilderFeat => !!f)
  const features = [
    ...featureList([...(species?.traits ?? []), ...(sub?.traits ?? [])], 's'),
    ...featureList([...(bg?.feature ? [bg.feature] : []), ...(bg?.feat ? [{ name: `${bg.feat.name} (feat)`, text: bg.feat.text }] : [])], 'b'),
    ...featureList(
      reached.flatMap((l) => l.features.filter((f) => !/^(Ability Score Improvement|Spellcasting)$/i.test(f.name) && !SUBCLASS_SLOT.test(f.name)).map((f) => ({ name: `${f.name} (${cls.name} ${l.level})`, text: f.text }))),
      'c'
    ),
    ...featureList((subclass?.features ?? []).filter((f) => f.level <= level).map((f) => ({ name: `${f.name} (${subclass!.name} ${f.level})`, text: f.text })), 'u'),
    ...featureList(taken.map((f) => ({ name: `${f.name} (feat)`, text: f.text })), 'f')
  ]
  sheet.features = features.slice(0, 100)
  // Equipment: armor and weapons are equipped; weapons become attacks; AC from what's worn.
  sheet.inventory = c.equipment.slice(0, 60).map((item, i) => inventoryFromItem(item, `i${i}`))
  sheet.attacks = c.equipment
    .map((item, i) => {
      const atk = attackFromItem(item, scores, `a${i}`)
      if (atk) sheet.inventory[i].attackId = atk.id
      return atk
    })
    .filter((a): a is SheetAttack => !!a)
  sheet.ac = armorClassFromItems(sheet) ?? 10 + abilityMod(scores.dex)
  const armor = sheet.inventory.find((i) => i.equipped && i.armor)
  if (armor) sheet.acNote = armor.name
  sheet.coins = { cp: 0, sp: 0, ep: 0, gp: bg?.gold ?? 0, pp: 0 }
  sheet.build = {
    species: c.speciesId,
    ...(c.subId ? { sub: c.subId } : {}),
    background: c.backgroundId,
    classId: c.classId,
    ...(subclass ? { subclass: subclass.id } : {}),
    ...(taken.length ? { feats: taken.map((f) => f.id) } : {})
  }
  return normalizeSheet(sheet)
}

// ───────────── Level up ─────────────

export type LevelUpChoice = {
  /** Hit points gained: a roll of the class die, or null for the average */
  rolled: number | null
  asi?: AsiChoice
  subclassId?: string | null
  /** Spells learned or prepared at this level */
  spells?: SheetSpell[]
}

/** What leveling this sheet's (first) class up one level brings. Null at 20 or for an unknown class. */
export function levelUpPreview(
  data: BuilderRules,
  sheet: Sheet5e
): { cls: BuilderClass; next: number; level: BuilderClass['levels'][number]; needsSubclass: boolean; subclass: BuilderClass['subclasses'][number] | null; newFeatures: { name: string; text: string }[] } | null {
  const own = sheet.classes[0]
  if (!own || own.level >= 20) return null
  const cls = data.classes.find((c) => c.id === sheet.build?.classId) ?? data.classes.find((c) => c.name.toLowerCase() === own.name.toLowerCase())
  if (!cls) return null
  const next = own.level + 1
  const level = cls.levels.find((l) => l.level === next)
  if (!level) return null
  const subclass = cls.subclasses.find((s) => s.id === sheet.build?.subclass) ?? cls.subclasses.find((s) => !!own.subclass && s.name.toLowerCase() === own.subclass.toLowerCase()) ?? null
  // The class table says "Fighter Subclass" where the subclass gives something: show what it gives.
  const newFeatures = [
    ...level.features.filter((f) => !/^(Ability Score Improvement|Spellcasting)$/i.test(f.name) && !SUBCLASS_SLOT.test(f.name)),
    ...(subclass?.features ?? []).filter((f) => f.level === next)
  ]
  return { cls, next, level, needsSubclass: next === cls.subclassLevel && !own.subclass, subclass, newFeatures }
}


/** Levels the sheet's first class up by one with the player's choices. */
export function levelUpSheet(data: BuilderRules, sheet: Sheet5e, choice: LevelUpChoice, feats: BuilderFeat[] = data.feats): Sheet5e {
  const p = levelUpPreview(data, sheet)
  if (!p) return sheet
  const out: Sheet5e = JSON.parse(JSON.stringify(sheet))
  const own = out.classes[0]
  own.level = p.next
  // Hit points: the gain uses Constitution after this level's improvement (5e: an increase to Constitution raises every level's HP).
  const beforeCon = abilityMod(out.abilities.con)
  if (choice.asi?.kind === 'asi') for (const a of ABILITIES) if (choice.asi.plus[a]) out.abilities[a] = Math.min(20, out.abilities[a] + choice.asi.plus[a]!)
  const afterCon = abilityMod(out.abilities.con)
  const tough = /dwar/i.test(out.race) && out.features.some((f) => /toughness/i.test(f.name)) ? 1 : 0
  const gain = Math.max(1, (choice.rolled ?? averageHitDie(p.cls.hitDie)) + afterCon + tough) + (afterCon - beforeCon) * (p.next - 1)
  out.hp = { ...out.hp, max: out.hp.max + gain, current: out.hp.current + gain }
  const dice = out.hitDice.find((d) => d.die === p.cls.hitDie)
  if (dice) dice.max = Math.min(20, dice.max + 1)
  else out.hitDice = [...out.hitDice, { die: p.cls.hitDie, max: 1, used: 0 }]
  if (choice.subclassId) {
    const sc = p.cls.subclasses.find((s) => s.id === choice.subclassId)
    if (sc) {
      own.subclass = sc.name
      out.build = { ...(out.build ?? {}), subclass: sc.id }
    }
  }
  const subclass = p.cls.subclasses.find((s) => s.id === out.build?.subclass) ?? p.subclass
  const added: { name: string; text: string }[] = [
    ...p.level.features.filter((f) => !/^(Ability Score Improvement|Spellcasting)$/i.test(f.name) && !SUBCLASS_SLOT.test(f.name)).map((f) => ({ name: `${f.name} (${p.cls.name} ${p.next})`, text: f.text })),
    ...(subclass?.features ?? []).filter((f) => f.level === p.next || (choice.subclassId && f.level <= p.next)).map((f) => ({ name: `${f.name} (${subclass!.name} ${f.level})`, text: f.text }))
  ]
  if (choice.asi?.kind === 'feat') {
    const feat = feats.find((f) => f.id === (choice.asi as { featId: string }).featId)
    if (feat) {
      added.push({ name: `${feat.name} (feat)`, text: feat.text })
      out.build = { ...(out.build ?? {}), feats: [...(out.build?.feats ?? []), feat.id] }
    }
  }
  const have = new Set(out.features.map((f) => f.name))
  out.features = [...out.features, ...added.filter((f) => !have.has(f.name)).map((f, i) => ({ id: `l${p.next}x${i}`, name: f.name.slice(0, 100), text: f.text.slice(0, 4000) }))].slice(0, 100)
  if (p.cls.spellAbility) {
    out.spellcasting.slots = Array.from({ length: 9 }, (_, i) => ({ max: p.level.slots[i] ?? 0, used: Math.min(out.spellcasting.slots[i]?.used ?? 0, p.level.slots[i] ?? 0) }))
    if (p.level.pact) out.spellcasting.pact = { level: p.level.pact.level, max: p.level.pact.slots, used: Math.min(out.spellcasting.pact?.used ?? 0, p.level.pact.slots) }
    if (choice.spells?.length) {
      const names = new Set(out.spellcasting.spells.map((s) => s.name))
      out.spellcasting.spells = [...out.spellcasting.spells, ...choice.spells.filter((s) => !names.has(s.name))]
    }
  }
  // AC follows Dexterity changes when it comes from worn armor.
  const ac = armorClassFromItems(out)
  if (ac !== null) out.ac = ac
  return normalizeSheet(out)
}

/** How many spells the class has (cantrips, and spells known or prepared) at a level, with this modifier. */
export function spellCounts(cls: BuilderClass, level: number, mod: number): { cantrips: number; spells: number } {
  const row = cls.levels.find((l) => l.level === level)
  if (!row) return { cantrips: 0, spells: 0 }
  const spells = row.spells ?? (cls.prepared ? Math.max(1, (cls.prepared === 'half' ? Math.floor(level / 2) : level) + mod) : 0)
  return { cantrips: row.cantrips ?? 0, spells }
}

/** A spell from the rules as a sheet spell (details filled in, roll from its damage). */
export function sheetSpellFrom(s: SrdSpell, prepared = true): SheetSpell {
  const dmg =
    s.damage?.bySlot?.[String(Math.max(s.level, 0))] ?? s.damage?.byCharacterLevel?.['1'] ?? null
  return {
    slug: s.slug,
    name: s.name,
    level: s.level,
    prepared,
    castingTime: s.castingTime.slice(0, 60),
    range: s.range.slice(0, 60),
    duration: s.duration.slice(0, 60),
    ...(s.concentration ? { concentration: true } : {}),
    ...(dmg && /^\d+d\d+([+-]\d+)?$/.test(dmg) ? { roll: dmg } : {}),
    notes: (s.desc.split(/(?<=\.)\s/)[0] ?? '').slice(0, 120)
  }
}

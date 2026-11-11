// Campfire Round A: bringing a character over from another tool. A filled-in 5e character sheet
// PDF (D&D Beyond's "Export to PDF", or the common fillable sheet) has form fields; the apps read
// them (pdf-lib, on the person's own device: the PDF never reaches the server) and turn them into
// a sheet here. Field names differ a little between exports, so each value is looked for under
// several names. Everything found is shown for checking before it's saved.

import { ABILITIES, type Ability, type CasterType, type Sheet5e, type SheetAttack, type SheetClass, type SkillId } from './types'
import { abilityMod, blankSheet, normalizeSheet, profBonus, SKILLS, slotsForClasses } from './rules5e'
import type { BuilderRules, RulesSet } from './rulesData'

export type PdfFields = Record<string, string | boolean>
export type ImportResult = {
  name: string
  sheet: Sheet5e
  /** What was found, in a few words each (for the check step) */
  found: string[]
  /** Things that couldn't be read or need a look */
  missing: string[]
  /** Spell names to look up in the rules (matched by the app) */
  spellNames: string[]
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** A value under any of these names (compared without case, spaces or punctuation). */
function finder(fields: PdfFields) {
  const map = new Map<string, string | boolean>()
  for (const [k, v] of Object.entries(fields)) {
    const key = norm(k)
    if (!map.has(key) || (typeof v === 'string' && v.trim())) map.set(key, v)
  }
  const text = (...names: string[]): string => {
    for (const n of names) {
      const v = map.get(norm(n))
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return ''
  }
  const flag = (...names: string[]): boolean => names.some((n) => map.get(norm(n)) === true)
  const all = (prefix: string): [string, string][] =>
    [...map.entries()].filter(([k, v]) => k.startsWith(norm(prefix)) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()])
  return { text, flag, all }
}

const num = (s: string): number | null => {
  const m = /-?\d+/.exec(s.replace(/[−–]/g, '-'))
  return m ? Number(m[0]) : null
}

const CASTER: Record<string, CasterType> = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full', paladin: 'half', ranger: 'half', warlock: 'pact', artificer: 'half'
}
const HIT_DIE: Record<string, number> = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10, bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8, sorcerer: 6, wizard: 6, artificer: 8
}
const ABILITY_WORDS: Record<string, Ability> = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha', str: 'str', dex: 'dex', con: 'con', int: 'int', wis: 'wis', cha: 'cha' }

/** "Ranger 5 / Fighter 2", "Cleric 6 (Life Domain)", "Level 5 Ranger" → classes. */
export function parseClassLevel(s: string, data?: BuilderRules | null): SheetClass[] {
  const out: SheetClass[] = []
  for (const part of s.split(/[/,;]/)) {
    const words = part.trim()
    if (!words) continue
    const level = num(words) ?? 1
    const sub = /\(([^)]+)\)/.exec(words)?.[1]?.trim()
    const name = words.replace(/\([^)]*\)/g, '').replace(/level/i, '').replace(/\d+/g, '').trim()
    if (!name) continue
    const key = name.toLowerCase().split(/\s+/)[0]
    const known = data?.classes.find((c) => c.id === key || c.name.toLowerCase() === name.toLowerCase())
    out.push({
      name: known?.name ?? name.replace(/\b\w/g, (c) => c.toUpperCase()),
      level: Math.max(1, Math.min(20, level)),
      hitDie: known?.hitDie ?? HIT_DIE[key] ?? 8,
      caster: known?.caster ?? CASTER[key] ?? 'none',
      ...(sub ? { subclass: sub.slice(0, 60) } : {})
    })
  }
  return out.slice(0, 6)
}

const SKILL_FIELDS: Record<SkillId, string[]> = {
  acrobatics: ['Acrobatics'],
  animalHandling: ['Animal', 'Animal Handling', 'AnimalHandling'],
  arcana: ['Arcana'],
  athletics: ['Athletics'],
  deception: ['Deception'],
  history: ['History'],
  insight: ['Insight'],
  intimidation: ['Intimidation'],
  investigation: ['Investigation'],
  medicine: ['Medicine'],
  nature: ['Nature'],
  perception: ['Perception'],
  performance: ['Performance'],
  persuasion: ['Persuasion'],
  religion: ['Religion'],
  sleightOfHand: ['SleightofHand', 'Sleight of Hand'],
  stealth: ['Stealth'],
  survival: ['Survival', 'Survivial']
}
const SAVE_FIELDS: Record<Ability, string[]> = {
  str: ['ST Strength', 'Strength Save', 'STR Save', 'StrSave'],
  dex: ['ST Dexterity', 'Dexterity Save', 'DEX Save', 'DexSave'],
  con: ['ST Constitution', 'Constitution Save', 'CON Save', 'ConSave'],
  int: ['ST Intelligence', 'Intelligence Save', 'INT Save', 'IntSave'],
  wis: ['ST Wisdom', 'Wisdom Save', 'WIS Save', 'WisSave'],
  cha: ['ST Charisma', 'Charisma Save', 'CHA Save', 'ChaSave']
}

/** Turns a PDF's form fields into a sheet (and what to check). */
export function sheetFromPdfFields(fields: PdfFields, rules: RulesSet, data?: BuilderRules | null): ImportResult {
  const f = finder(fields)
  const sheet = blankSheet()
  const found: string[] = []
  const missing: string[] = []
  sheet.rules = rules
  const name = f.text('CharacterName', 'Character Name', 'Name', 'CharacterName 2').slice(0, 60)
  if (!name) missing.push('Name')
  sheet.classes = parseClassLevel(f.text('ClassLevel', 'Class Level', 'CLASS  LEVEL', 'Class & Level', 'Class'), data)
  if (sheet.classes.length) found.push(sheet.classes.map((c) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass})` : ''}`).join(' / '))
  else missing.push('Class and level')
  sheet.race = f.text('Race ', 'Race', 'Species', 'RACE').slice(0, 60)
  sheet.background = f.text('Background', 'BACKGROUND').slice(0, 60)
  sheet.alignment = f.text('Alignment', 'ALIGNMENT').slice(0, 40)
  const xp = num(f.text('XP', 'Experience Points', 'EXPERIENCE POINTS'))
  if (xp !== null && xp > 0) sheet.xp = xp

  let scores = 0
  for (const a of ABILITIES) {
    const v = num(f.text(a.toUpperCase(), a, `${a.toUpperCase()}score`, Object.keys(ABILITY_WORDS).find((w) => ABILITY_WORDS[w] === a && w.length > 3) ?? a))
    if (v !== null && v >= 1 && v <= 30) {
      sheet.abilities[a] = v
      scores++
    }
  }
  if (scores === 6) found.push(ABILITIES.map((a) => `${a.toUpperCase()} ${sheet.abilities[a]}`).join(' · '))
  else missing.push('Ability scores')

  const ac = num(f.text('AC', 'ArmorClass', 'Armor Class'))
  const hpMax = num(f.text('HPMax', 'Max HP', 'MaxHP', 'Hit Point Maximum', 'HP Max'))
  const hpNow = num(f.text('HPCurrent', 'Current HP', 'CurrentHP'))
  const speed = num(f.text('Speed', 'SPEED', 'Walking Speed'))
  if (ac !== null) sheet.ac = Math.max(0, Math.min(40, ac))
  if (hpMax !== null && hpMax > 0) sheet.hp = { max: hpMax, current: hpNow !== null && hpNow >= 0 && hpNow <= hpMax ? hpNow : hpMax, temp: 0 }
  if (speed !== null && speed > 0) sheet.speed = speed
  if (ac !== null && hpMax !== null) found.push(`AC ${sheet.ac} · HP ${sheet.hp.max} · Speed ${sheet.speed} ft`)
  else missing.push('Armor class or hit points')

  // Hit dice from the classes.
  const byDie = new Map<number, number>()
  for (const c of sheet.classes) byDie.set(c.hitDie, (byDie.get(c.hitDie) ?? 0) + c.level)
  sheet.hitDice = [...byDie].map(([die, max]) => ({ die, max, used: 0 }))

  // Saves and skills: the sheet's totals tell proficiency (total − ability modifier = proficiency bonus, ×2 = expertise).
  const level = sheet.classes.reduce((n, c) => n + c.level, 0) || 1
  const pb = num(f.text('ProfBonus', 'Proficiency Bonus', 'PROFICIENCY BONUS')) ?? profBonus(level)
  let saves = 0
  for (const a of ABILITIES) {
    const v = num(f.text(...SAVE_FIELDS[a]))
    if (v === null) continue
    if (v - abilityMod(sheet.abilities[a]) >= pb) {
      sheet.saves[a] = true
      saves++
    }
  }
  let skills = 0
  for (const k of Object.keys(SKILL_FIELDS) as SkillId[]) {
    const v = num(f.text(...SKILL_FIELDS[k]))
    if (v === null) continue
    const extra = v - abilityMod(sheet.abilities[SKILLS[k].ability])
    if (extra >= pb * 2) sheet.skills[k] = 2
    else if (extra >= pb) sheet.skills[k] = 1
    if (extra >= pb) skills++
  }
  if (saves || skills) found.push(`${saves} saving throws, ${skills} skills, proficiency +${pb}`)

  // Attacks: three weapon rows on the common sheet (and DDB's).
  const attacks: SheetAttack[] = []
  const rows: [string[], string[], string[]][] = [
    [['Wpn Name', 'Weapon Name 1', 'Wpn1 Name'], ['Wpn1 AtkBonus', 'Wpn1 AtkBonus ', 'Weapon Attack 1'], ['Wpn1 Damage', 'Weapon Damage 1']],
    [['Wpn Name 2', 'Weapon Name 2', 'Wpn2 Name'], ['Wpn2 AtkBonus ', 'Wpn2 AtkBonus', 'Weapon Attack 2'], ['Wpn2 Damage ', 'Wpn2 Damage', 'Weapon Damage 2']],
    [['Wpn Name 3', 'Weapon Name 3', 'Wpn3 Name'], ['Wpn3 AtkBonus  ', 'Wpn3 AtkBonus', 'Weapon Attack 3'], ['Wpn3 Damage ', 'Wpn3 Damage', 'Weapon Damage 3']]
  ]
  for (const [i, [n, h, d]] of rows.entries()) {
    const wname = f.text(...n)
    if (!wname) continue
    const toHit = num(f.text(...h))
    const dmgText = f.text(...d)
    const dice = /(\d+d\d+(?:\s*[+-]\s*\d+)?)/.exec(dmgText)?.[1]?.replace(/\s+/g, '') ?? ''
    const type = /(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)/i.exec(dmgText)?.[1]?.toLowerCase()
    if (!dice) continue
    attacks.push({
      id: `w${i}`,
      name: wname.slice(0, 60),
      kind: /bow|crossbow|dart|sling|javelin/i.test(wname) ? 'ranged' : /bolt|blast|ray|spell/i.test(wname) ? 'spell' : 'melee',
      ability: null,
      proficient: false,
      bonus: 0,
      fixedToHit: toHit,
      damage: dice,
      damageAbility: false,
      damageType: (type ?? 'bludgeoning') as SheetAttack['damageType'],
      range: '',
      notes: 'Imported: the to-hit and damage are the sheet’s numbers.'
    })
  }
  sheet.attacks = attacks
  if (attacks.length) found.push(`${attacks.length} attack${attacks.length === 1 ? '' : 's'} (${attacks.map((a) => a.name).join(', ')})`)

  // Spellcasting: slots from the class table; the ability from the sheet; spell names to match.
  const slots = slotsForClasses(sheet.classes)
  sheet.spellcasting.slots = slots.slots.map((max) => ({ max, used: 0 }))
  sheet.spellcasting.pact = slots.pact ? { level: slots.pact.level, max: slots.pact.slots, used: 0 } : null
  const castAbility = ABILITY_WORDS[f.text('SpellcastingAbility 2', 'Spellcasting Ability', 'SPELLCASTING ABILITY').toLowerCase()]
  if (castAbility) sheet.spellcasting.ability = castAbility
  else if (sheet.classes.some((c) => c.caster !== 'none')) {
    const k = sheet.classes.find((c) => c.caster !== 'none')!.name.toLowerCase()
    sheet.spellcasting.ability = (({ bard: 'cha', paladin: 'cha', sorcerer: 'cha', warlock: 'cha', cleric: 'wis', druid: 'wis', ranger: 'wis', wizard: 'int', artificer: 'int' }) as Record<string, Ability>)[k] ?? null
  }
  const spellNames = [
    ...new Set(
      f
        .all('spells')
        .concat(f.all('spellname'))
        .map(([, v]) => v.replace(/\s*\[.*?\]|\(.*?\)/g, '').trim())
        .filter((v) => v.length >= 3 && v.length <= 60 && !/^\d+$/.test(v))
    )
  ].slice(0, 120)

  const coins = { cp: num(f.text('CP')) ?? 0, sp: num(f.text('SP')) ?? 0, ep: num(f.text('EP')) ?? 0, gp: num(f.text('GP')) ?? 0, pp: num(f.text('PP')) ?? 0 }
  if (Object.values(coins).some((v) => v > 0)) sheet.coins = coins
  const equipment = f.text('Equipment', 'EQUIPMENT', 'Inventory')
  sheet.inventory = equipment
    .split(/\n|,(?![^(]*\))/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
    .slice(0, 60)
    .map((line, i) => {
      const qty = /^(\d+)\s*[x×]?\s+/.exec(line)
      return { id: `i${i}`, name: line.replace(/^(\d+)\s*[x×]?\s+/, '').slice(0, 80), qty: qty ? Number(qty[1]) : 1, notes: '' }
    })
  if (sheet.inventory.length) found.push(`${sheet.inventory.length} items`)
  const features = f.text('Features and Traits', 'Features & Traits', 'FEATURES & TRAITS', 'Features')
  const more = f.text('Feat+Traits', 'Additional Features and Traits', 'ADDITIONAL FEATURES & TRAITS')
  sheet.features = [features, more]
    .filter(Boolean)
    .map((text, i) => ({ id: `p${i}`, name: i ? 'More features and traits (imported)' : 'Features and traits (imported)', text: text.slice(0, 4000) }))
  const profs = f.text('ProficienciesLang', 'Proficiencies & Languages', 'OTHER PROFICIENCIES & LANGUAGES')
  const notes = [profs ? `Proficiencies and languages: ${profs}` : '', f.text('PersonalityTraits ', 'Personality Traits') ? `Personality: ${f.text('PersonalityTraits ', 'Personality Traits')}` : '']
  sheet.notes = notes.filter(Boolean).join('\n\n').slice(0, 20000)
  return { name, sheet: normalizeSheet(sheet), found, missing, spellNames }
}

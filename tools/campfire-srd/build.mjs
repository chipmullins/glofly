// Builds Campfire's compendium files from the 5e-bits/5e-database project
// (https://github.com/5e-bits/5e-database; code MIT, game content = the SRDs, CC BY 4.0).
//
//   git clone --depth 1 https://github.com/5e-bits/5e-database /tmp/5e-database
//   node tools/campfire-srd/build.mjs /tmp/5e-database
//
// Writes, under apps/server/src/campfire/srd/:
//   2024/monsters.json, 2024/spells.json   SRD 5.2, the same trimmed shape as the 2014 files (srd.ts)
//   2014/builder.json, 2024/builder.json   species, classes, backgrounds, feats (BuilderRules)
//   2014/items.json, 2024/items.json       armor, weapons, gear and magic items (RulesItem[])
// The 2014 monsters.json/spells.json at the top of srd/ were made Nov 9 and are left as they are.
// Nothing is reworded: fields are renamed, flattened and trimmed to what Campfire uses.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = process.argv[2]
if (!src) {
  console.error('Usage: node tools/campfire-srd/build.mjs <path to a 5e-database checkout>')
  process.exit(1)
}
const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'apps', 'server', 'src', 'campfire', 'srd')
const read = (set, name) => JSON.parse(readFileSync(join(src, 'src', set, 'en', `5e-SRD-${name}.json`), 'utf8'))
const write = (rel, data) => {
  mkdirSync(dirname(join(out, rel)), { recursive: true })
  writeFileSync(join(out, rel), JSON.stringify(data))
  console.log(`${rel}: ${Array.isArray(data) ? data.length + ' entries' : 'written'}`)
}

const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha']
const SKILL_IDS = {
  acrobatics: 'acrobatics', 'animal-handling': 'animalHandling', arcana: 'arcana', athletics: 'athletics',
  deception: 'deception', history: 'history', insight: 'insight', intimidation: 'intimidation',
  investigation: 'investigation', medicine: 'medicine', nature: 'nature', perception: 'perception',
  performance: 'performance', persuasion: 'persuasion', religion: 'religion', 'sleight-of-hand': 'sleightOfHand',
  stealth: 'stealth', survival: 'survival'
}
const DAMAGE = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']
const skillOf = (index) => SKILL_IDS[String(index).replace(/^skill-/, '')] ?? null
const text = (d) => (Array.isArray(d) ? d.join('\n') : String(d ?? '')).trim()
const lower = (s) => String(s ?? '').toLowerCase()
const CASTER = {
  bard: 'full', cleric: 'full', druid: 'full', sorcerer: 'full', wizard: 'full',
  paladin: 'half', ranger: 'half', warlock: 'pact', barbarian: 'none', fighter: 'none', monk: 'none', rogue: 'none'
}
const SUBCLASS_LABEL = {
  barbarian: 'Primal Path', bard: 'Bard College', cleric: 'Divine Domain', druid: 'Druid Circle',
  fighter: 'Martial Archetype', monk: 'Monastic Tradition', paladin: 'Sacred Oath', ranger: 'Ranger Archetype',
  rogue: 'Roguish Archetype', sorcerer: 'Sorcerous Origin', warlock: 'Otherworldly Patron', wizard: 'Arcane Tradition'
}
const SUBCLASS_LABEL_2024 = {
  barbarian: 'Barbarian Subclass', bard: 'Bard Subclass', cleric: 'Cleric Subclass', druid: 'Druid Subclass',
  fighter: 'Fighter Subclass', monk: 'Monk Subclass', paladin: 'Paladin Subclass', ranger: 'Ranger Subclass',
  rogue: 'Rogue Subclass', sorcerer: 'Sorcerer Subclass', warlock: 'Warlock Subclass', wizard: 'Wizard Subclass'
}
// The 2014 data has no primary abilities: the class descriptions' ones.
const PRIMARY = {
  barbarian: ['str'], bard: ['cha'], cleric: ['wis'], druid: ['wis'], fighter: ['str', 'dex'], monk: ['dex', 'wis'],
  paladin: ['str', 'cha'], ranger: ['dex', 'wis'], rogue: ['dex'], sorcerer: ['cha'], warlock: ['cha'], wizard: ['int']
}
const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']
const sizeOf = (s) => (SIZES.includes(lower(s)) ? lower(s) : 'medium')

// ───────────── 2024 monsters and spells (same shape as the 2014 files) ─────────────

function monsters2024() {
  const feature = (f) => {
    const o = { name: f.name, desc: text(f.desc) }
    if (typeof f.attack_bonus === 'number') o.attackBonus = f.attack_bonus
    const dmg = (f.damage ?? []).filter((d) => d.damage_dice).map((d) => ({ dice: d.damage_dice.replace(/\s+/g, ''), type: d.damage_type ? lower(d.damage_type.index) : null }))
    if (dmg.length) o.damage = dmg
    return o
  }
  return read('2024', 'Monsters').map((m) => {
    const saves = {}
    const skills = {}
    for (const p of m.proficiencies ?? []) {
      const i = p.proficiency?.index ?? ''
      if (i.startsWith('saving-throw-')) saves[i.slice(13)] = p.value
      else if (i.startsWith('skill-')) {
        const k = skillOf(i)
        if (k) skills[k] = p.value
      }
    }
    const senses = Object.entries(m.senses ?? {})
      .map(([k, v]) => (k === 'passive_perception' ? `passive Perception ${v}` : `${k.replace(/_/g, ' ')} ${v}`))
      .join(', ')
    const list = (x) => (x ?? []).map((v) => (typeof v === 'string' ? lower(v) : lower(v.name ?? v.index)))
    return {
      slug: m.index,
      name: m.name,
      size: lower(m.size),
      type: m.subtype ? `${m.type} (${m.subtype})` : m.type,
      alignment: m.alignment,
      ac: m.armor_class?.[0]?.value ?? 10,
      hp: m.hit_points,
      hitDice: m.hit_dice,
      speed: m.speed ?? {},
      abilities: ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].map((k) => m[k] ?? 10),
      saves,
      skills,
      vulnerable: list(m.damage_vulnerabilities),
      resist: list(m.damage_resistances),
      immune: list(m.damage_immunities),
      conditionImmunities: list(m.condition_immunities),
      senses,
      languages: m.languages ?? '',
      cr: m.challenge_rating,
      xp: m.xp ?? 0,
      prof: m.proficiency_bonus ?? 2,
      traits: (m.special_abilities ?? []).map(feature),
      // 2024 stat blocks have Bonus Actions: kept with the actions, named so.
      actions: [...(m.actions ?? []).map(feature), ...(m.bonus_actions ?? []).map((f) => ({ ...feature(f), name: `${f.name} (Bonus Action)` }))],
      legendary: (m.legendary_actions ?? []).map(feature),
      reactions: (m.reactions ?? []).map(feature)
    }
  })
}

function spells2024() {
  const abilityWord = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' }
  return read('2024', 'Spells').map((s) => {
    const desc = text(s.description)
    const save = /(?:makes?|succeed on|make) an? (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i.exec(desc)
    let damage = null
    if (s.damage) {
      const type = s.damage.damage_type ? lower(s.damage.damage_type.index) : null
      let bySlot = s.damage.damage_at_slot_level ?? null
      const byCharacterLevel = s.damage.damage_at_character_level ?? null
      // SRD 5.2 lists only the spell's own level: the rest comes from "increases by NdX for each slot level above L".
      const up = /increases by (\d+)d(\d+) for each (?:spell )?slot level above (\d)/i.exec(String(s.higher_level ?? ''))
      if (bySlot && up && Object.keys(bySlot).length === 1) {
        const [lvl, base] = Object.entries(bySlot)[0]
        const m = /^(\d+)d(\d+)(.*)$/.exec(String(base).replace(/\s+/g, ''))
        if (m && m[2] === up[2]) {
          bySlot = {}
          for (let L = Number(lvl); L <= 9; L++) bySlot[L] = `${Number(m[1]) + (L - Number(lvl)) * Number(up[1])}d${m[2]}${m[3]}`
        }
      }
      // Cantrips: "increases by 1d10 when you reach levels 5 (2d10), 11 (3d10), and 17 (4d10)".
      let byLevel = byCharacterLevel
      const cu = /levels 5 \((\d+d\d+)\), 11 \((\d+d\d+)\),? and 17 \((\d+d\d+)\)/i.exec(desc)
      if (!byLevel && s.level === 0 && bySlot?.['0'] && cu) {
        byLevel = { 1: String(bySlot['0']).replace(/\s+/g, ''), 5: cu[1], 11: cu[2], 17: cu[3] }
        bySlot = null
      }
      if (byLevel !== byCharacterLevel) {
        damage = { type: DAMAGE.includes(type) ? type : null, bySlot, byCharacterLevel: byLevel }
        return finish(damage)
      }
      if (bySlot) bySlot = Object.fromEntries(Object.entries(bySlot).map(([k, v]) => [k, String(v).replace(/\s+/g, '')]))
      damage = { type: DAMAGE.includes(type) ? type : null, bySlot, byCharacterLevel }
    }
    return finish(damage)
    function finish(damage) {
    return {
      slug: s.index,
      name: s.name,
      level: s.level,
      school: s.school?.name ?? '',
      classes: (s.classes ?? []).map((c) => c.name),
      desc,
      higherLevel: text(s.higher_level),
      range: s.range ?? '',
      components: `${(s.components ?? []).join(', ')}${s.material ? ` (${s.material})` : ''}`,
      duration: s.duration ?? '',
      castingTime: s.casting_time ?? '',
      concentration: !!s.concentration,
      ritual: !!s.ritual,
      attack: s.attack_type === 'melee' || s.attack_type === 'ranged' ? s.attack_type : null,
      save: save ? { ability: abilityWord[save[1].toLowerCase()], half: /half as much/i.test(desc) } : null,
      damage
    }
    }
  })
}

// ───────────── Character builder data ─────────────

function speciesFor(set) {
  const traits = read(set, 'Traits')
  const traitText = (refs) => (refs ?? []).map((r) => traits.find((t) => t.index === r.index)).filter(Boolean).map((t) => ({ name: t.name, text: text(t.desc ?? t.description) }))
  const darkvision = (refs) => {
    const t = (refs ?? []).map((r) => traits.find((x) => x.index === r.index)).find((x) => x && /darkvision/i.test(x.name))
    const m = t && /(\d+)\s*feet/.exec(text(t.desc ?? t.description))
    return m ? Number(m[1]) : t ? 60 : 0
  }
  const resistOf = (refs) => {
    const out = []
    for (const r of refs ?? []) {
      const m = /damage-resistance-([a-z]+)/.exec(r.index)
      if (m && DAMAGE.includes(m[1])) out.push(m[1])
    }
    return out
  }
  const bonuses = (list) => {
    const o = {}
    for (const b of list ?? []) o[b.ability_score.index] = b.bonus
    return Object.keys(o).length ? o : undefined
  }
  const skillsFrom = (profs) => (profs ?? []).map((p) => skillOf(p.index)).filter(Boolean)
  const skillChoiceFrom = (choice) => {
    if (!choice) return undefined
    const from = (choice.from?.options ?? []).map((o) => skillOf(o.item?.index)).filter(Boolean)
    return from.length ? { count: choice.choose, from } : undefined
  }
  if (set === '2014') {
    const subs = read('2014', 'Subraces')
    return read('2014', 'Races').map((r) => {
      const traitRefs = r.traits ?? []
      const choice = r.ability_bonus_options
      return {
        id: r.index,
        name: r.name,
        size: sizeOf(r.size),
        speed: r.speed,
        darkvision: darkvision(traitRefs),
        traits: traitText(traitRefs),
        bonuses: bonuses(r.ability_bonuses),
        ...(choice ? { bonusChoice: { count: choice.choose, amount: 1, except: Object.keys(bonuses(r.ability_bonuses) ?? {}) } } : {}),
        skills: skillsFrom(r.starting_proficiencies),
        skillChoice: skillChoiceFrom(r.starting_proficiency_options),
        resist: resistOf(traitRefs),
        subs: subs
          .filter((s) => s.race.index === r.index)
          .map((s) => ({ id: s.index, name: s.name, traits: [{ name: s.name, text: text(s.desc) }, ...traitText(s.racial_traits)], bonuses: bonuses(s.ability_bonuses) }))
      }
    })
  }
  const subs = read('2024', 'Subspecies')
  return read('2024', 'Species').map((r) => {
    const ownRefs = (r.traits ?? []).map((t) => ({ index: t.index }))
    const own = ownRefs.map((x) => traits.find((t) => t.index === x.index)).filter(Boolean)
    const choice = own.map((t) => (Array.isArray(t.proficiency_choices) ? t.proficiency_choices[0] : t.proficiency_choices)).find(Boolean)
    return {
      id: r.index,
      name: r.name,
      size: sizeOf(r.size ?? 'medium'),
      ...(r.size_options ? { sizeOptions: (r.size_options.from?.options ?? []).map((o) => sizeOf(o.size)) } : {}),
      speed: r.speed,
      darkvision: darkvision(ownRefs),
      traits: own.map((t) => ({ name: t.name, text: text(t.description) })),
      skillChoice: skillChoiceFrom(choice),
      resist: resistOf(ownRefs),
      subs: subs
        .filter((s) => s.species.index === r.index)
        .map((s) => {
          const refs = s.traits ?? []
          const st = traitText(refs)
          const speedTrait = refs.map((x) => traits.find((t) => t.index === x.index)).find((t) => t?.speed)
          const dv = darkvision(refs)
          return {
            id: s.index,
            name: s.name,
            traits: st,
            ...(speedTrait ? { speed: speedTrait.speed } : {}),
            ...(dv ? { darkvision: dv } : {}),
            resist: resistOf(refs)
          }
        })
    }
  })
}

function classesFor(set) {
  const classes = read(set, 'Classes')
  const levels = read(set, 'Levels')
  const features = read(set, 'Features')
  const subclasses = read(set, 'Subclasses')
  const featText = (ref) => {
    const f = features.find((x) => x.index === ref.index)
    return { name: ref.name, text: f ? text(f.desc ?? f.description) : '' }
  }
  return classes.map((c) => {
    const ls = levels.filter((l) => l.class.index === c.index && !l.subclass).sort((a, b) => a.level - b.level)
    const caster = CASTER[c.index] ?? 'none'
    const skillChoice = c.proficiency_choices?.find((p) => (p.from?.options ?? []).some((o) => String(o.item?.index).startsWith('skill-')))
    const subLevels = levels.filter((l) => l.class.index === c.index && l.subclass)
    const firstSub = Math.min(...subLevels.map((l) => l.level).filter((n) => n > 0), 3)
    return {
      id: c.index,
      name: c.name,
      hitDie: c.hit_die,
      primary: (c.primary_ability?.ability_scores ?? []).map((a) => a.index).concat(c.primary_ability ? [] : PRIMARY[c.index] ?? []),
      saves: (c.saving_throws ?? []).map((a) => a.index),
      armor: (c.proficiencies ?? []).filter((p) => /armor|shield/i.test(p.name) && !/saving/i.test(p.name)).map((p) => p.name),
      weapons: (c.proficiencies ?? []).filter((p) => /weapon/i.test(p.name)).map((p) => p.name),
      skillChoice: skillChoice
        ? { count: skillChoice.choose, from: skillChoice.from.options.map((o) => skillOf(o.item?.index)).filter(Boolean) }
        : { count: 2, from: [] },
      caster,
      spellAbility: c.spellcasting?.spellcasting_ability?.index ?? null,
      ...(set === '2014' && ['cleric', 'druid', 'wizard'].includes(c.index) ? { prepared: 'level' } : {}),
      ...(set === '2014' && c.index === 'paladin' ? { prepared: 'half' } : {}),
      subclassLevel: firstSub,
      subclassLabel: (set === '2024' ? SUBCLASS_LABEL_2024 : SUBCLASS_LABEL)[c.index] ?? 'Subclass',
      subclasses: subclasses
        .filter((s) => s.class.index === c.index)
        .map((s) => ({
          id: s.index,
          name: s.name,
          summary: text(s.summary ?? s.desc),
          features:
            set === '2024'
              ? (s.features ?? []).map((f) => ({ level: f.level, name: f.name, text: text(f.description) }))
              : features.filter((f) => f.subclass?.index === s.index).map((f) => ({ level: f.level, name: f.name, text: text(f.desc) }))
        })),
      levels: ls.map((l) => {
        const sc = l.spellcasting ?? {}
        const slots = Array.from({ length: 9 }, (_, i) => sc[`spell_slots_level_${i + 1}`] ?? 0)
        const isPact = caster === 'pact'
        const pactLevel = isPact ? slots.reduce((top, n, i) => (n ? i + 1 : top), 0) : 0
        const feats = (l.features ?? []).map(featText)
        return {
          level: l.level,
          features: feats,
          asi: feats.some((f) => /Ability Score Improvement/i.test(f.name)),
          ...(sc.cantrips_known ? { cantrips: sc.cantrips_known } : {}),
          ...(sc.prepared_spells ? { spells: sc.prepared_spells } : sc.spells_known ? { spells: sc.spells_known } : {}),
          slots: isPact ? Array(9).fill(0) : slots,
          ...(isPact && pactLevel ? { pact: { level: pactLevel, slots: slots[pactLevel - 1] } } : {})
        }
      })
    }
  })
}

function backgroundsFor(set) {
  const feats = set === '2024' ? read('2024', 'Feats') : []
  return read(set, 'Backgrounds').map((b) => {
    const profs = b.proficiencies ?? b.starting_proficiencies ?? []
    const feat = b.feat ? feats.find((f) => f.index === b.feat.index) : null
    const tools = [...profs.filter((p) => /^tool-|^Tool/i.test(p.index ?? p.name)).map((p) => p.name.replace(/^Tool: /, '')), ...(b.proficiency_choices ?? []).map((c) => c.desc).filter(Boolean)]
    return {
      id: b.index,
      name: b.name,
      skills: profs.map((p) => skillOf(p.index)).filter(Boolean),
      ...(b.ability_scores ? { abilities: b.ability_scores.map((a) => a.index) } : {}),
      ...(feat ? { feat: { id: feat.index, name: feat.name, text: text(feat.description) } } : {}),
      tools: tools.join('; '),
      ...(b.feature ? { feature: { name: b.feature.name, text: text(b.feature.desc) } } : {}),
      gold: b.starting_gold?.quantity ?? (set === '2024' ? 50 : 10)
    }
  })
}

function featsFor(set) {
  return read(set, 'Feats').map((f) => ({
    id: f.index,
    name: f.name,
    type: f.type ?? 'general',
    text: text(f.description ?? f.desc),
    repeatable: !!f.repeatable,
    prerequisite: [
      ...(Array.isArray(f.prerequisites) ? f.prerequisites : f.prerequisites ? [f.prerequisites] : []).flatMap((p) => [
        p.ability_score ? `${p.ability_score.name} ${p.minimum_score}+` : '',
        p.minimum_level ? `Level ${p.minimum_level}+` : '',
        p.feature_named ? `${p.feature_named} feature` : ''
      ]),
      f.prerequisite_options?.desc ?? ''
    ]
      .filter(Boolean)
      .join(', ')
  }))
}

function itemsFor(set) {
  const eq = read(set, 'Equipment')
  const magic = read(set, 'Magic-Items')
  const cats = (e) => [...(e.equipment_categories ?? []), e.equipment_category].filter(Boolean).map((c) => c.index)
  const cost = (c) => (c ? c.quantity * ({ cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 }[c.unit] ?? 1) : 0)
  const out = []
  for (const e of eq) {
    const cs = cats(e)
    const base = { id: e.index, name: e.name, weight: e.weight ?? 0, cost: Math.round(cost(e.cost) * 100) / 100 }
    if (e.armor_class) {
      const shield = cs.includes('shields') || e.index === 'shield'
      const cat = lower(e.armor_category ?? (cs.find((c) => /light|medium|heavy/.test(c)) ?? 'light')).replace('-armor', '')
      if (shield) out.push({ ...base, kind: 'shield' })
      else
        out.push({
          ...base,
          kind: 'armor',
          armor: {
            base: e.armor_class.base,
            dex: !!e.armor_class.dex_bonus,
            maxDex: e.armor_class.max_bonus ?? null,
            category: ['light', 'medium', 'heavy'].includes(cat) ? cat : 'light',
            stealthDis: !!e.stealth_disadvantage,
            strMin: e.str_minimum ?? 0
          }
        })
      continue
    }
    if (e.damage) {
      const props = (e.properties ?? []).map((p) => p.name)
      const ranged = lower(e.weapon_range ?? '') === 'ranged' || cs.includes('ranged-weapons') || cs.some((c) => /ranged/.test(c))
      const type = lower(e.damage.damage_type?.index)
      out.push({
        ...base,
        kind: 'weapon',
        weapon: {
          damage: e.damage.damage_dice,
          type: DAMAGE.includes(type) ? type : 'bludgeoning',
          ...(e.two_handed_damage ? { versatile: e.two_handed_damage.damage_dice } : {}),
          ranged,
          range: e.range?.long ? `${e.range.normal}/${e.range.long} ft.` : e.throw_range ? `${e.throw_range.normal}/${e.throw_range.long} ft.` : `${e.range?.normal ?? 5} ft.`,
          finesse: props.some((p) => /finesse/i.test(p)),
          properties: props,
          ...(e.mastery ? { mastery: e.mastery.name } : {}),
          category: lower(e.weapon_category ?? (cs.some((c) => c.startsWith('martial')) ? 'martial' : 'simple')) === 'martial' ? 'martial' : 'simple'
        }
      })
      continue
    }
    out.push({ ...base, kind: cs.includes('ammunition') ? 'ammo' : 'gear', ...(e.description || e.desc ? { text: text(e.description ?? e.desc).slice(0, 600) } : {}) })
  }
  for (const m of magic) {
    if (m.variant) continue
    const desc = text(m.desc)
    out.push({
      id: `magic-${m.index}`,
      name: m.name,
      kind: 'magic',
      weight: 0,
      cost: 0,
      magic: { rarity: m.rarity?.name ?? '', attunement: m.attunement ?? /requires attunement/i.test(desc), text: desc }
    })
  }
  return out
}

for (const set of ['2014', '2024']) {
  write(`${set}/builder.json`, {
    rules: set,
    species: speciesFor(set),
    classes: classesFor(set),
    backgrounds: backgroundsFor(set),
    feats: featsFor(set),
    credit: ''
  })
  write(`${set}/items.json`, itemsFor(set))
}
write('2024/monsters.json', monsters2024())
write('2024/spells.json', spells2024())

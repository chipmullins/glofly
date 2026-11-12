// 0.11.3 (Chip: "each class has its own set of starting gear, not access to all of the gear"):
// what a new character of each class starts with, from the SRD (5.1 for the 2014 rules, 5.2 for
// 2024). 2014 classes choose between (a) and (b) for each line, some lines say "any simple weapon";
// 2024 classes take package A, or the gold instead and buy their own gear (the shop).
// The builders (desktop/web and phones) show these; `resolveGear` turns the choices into the
// sheet's equipment and coins.

import type { RulesItem, RulesSet } from './rulesData'

export type GearGrant = { id: string; qty?: number }
/** "Any simple weapon", "a holy symbol"…: the player picks the item. */
export type GearPick = {
  from: 'simple' | 'martial' | 'simple-melee' | 'martial-melee' | 'holy-symbol' | 'arcane-focus' | 'druidic-focus'
  count?: number
}
export type GearOption = {
  label: string
  items: GearGrant[]
  picks?: GearPick[]
  gold?: number
  /** 2024's "or the gold": buy your own gear with it */
  shop?: boolean
}
export type GearChoice = { options: GearOption[] }
export type ClassGear = { choices: GearChoice[]; always: GearGrant[]; alwaysPicks?: GearPick[] }

const g = (id: string, qty?: number): GearGrant => (qty && qty > 1 ? { id, qty } : { id })
const opt = (label: string, items: GearGrant[], extra: Partial<GearOption> = {}): GearOption => ({ label, items, ...extra })
const gold = (n: number): GearOption => ({ label: `${n} GP to buy your own gear`, items: [], gold: n, shop: true })

// SRD 5.1 (2014): one line per (a)/(b) choice, then what everyone of the class gets.
const SRD_2014: Record<string, ClassGear> = {
  barbarian: {
    choices: [
      { options: [opt('A greataxe', [g('greataxe')]), opt('Any martial melee weapon', [], { picks: [{ from: 'martial-melee' }] })] },
      { options: [opt('Two handaxes', [g('handaxe', 2)]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
    ],
    always: [g('explorers-pack'), g('javelin', 4)],
  },
  bard: {
    choices: [
      { options: [opt('A rapier', [g('rapier')]), opt('A longsword', [g('longsword')]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
      { options: [opt("A diplomat's pack", [g('diplomats-pack')]), opt("An entertainer's pack", [g('entertainers-pack')])] },
    ],
    always: [g('lute'), g('leather-armor'), g('dagger')],
  },
  cleric: {
    choices: [
      { options: [opt('A mace', [g('mace')]), opt('A warhammer (if proficient)', [g('warhammer')])] },
      { options: [opt('Scale mail', [g('scale-mail')]), opt('Leather armor', [g('leather-armor')]), opt('Chain mail (if proficient)', [g('chain-mail')])] },
      { options: [opt('A light crossbow and 20 bolts', [g('crossbow-light'), g('crossbow-bolt', 20)]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
      { options: [opt("A priest's pack", [g('priests-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('shield')],
    alwaysPicks: [{ from: 'holy-symbol' }],
  },
  druid: {
    choices: [
      { options: [opt('A wooden shield', [g('shield')]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
      { options: [opt('A scimitar', [g('scimitar')]), opt('Any simple melee weapon', [], { picks: [{ from: 'simple-melee' }] })] },
    ],
    always: [g('leather-armor'), g('explorers-pack')],
    alwaysPicks: [{ from: 'druidic-focus' }],
  },
  fighter: {
    choices: [
      { options: [opt('Chain mail', [g('chain-mail')]), opt('Leather armor, a longbow and 20 arrows', [g('leather-armor'), g('longbow'), g('arrow', 20)])] },
      { options: [opt('A martial weapon and a shield', [g('shield')], { picks: [{ from: 'martial' }] }), opt('Two martial weapons', [], { picks: [{ from: 'martial', count: 2 }] })] },
      { options: [opt('A light crossbow and 20 bolts', [g('crossbow-light'), g('crossbow-bolt', 20)]), opt('Two handaxes', [g('handaxe', 2)])] },
      { options: [opt("A dungeoneer's pack", [g('dungeoneers-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [],
  },
  monk: {
    choices: [
      { options: [opt('A shortsword', [g('shortsword')]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
      { options: [opt("A dungeoneer's pack", [g('dungeoneers-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('dart', 10)],
  },
  paladin: {
    choices: [
      { options: [opt('A martial weapon and a shield', [g('shield')], { picks: [{ from: 'martial' }] }), opt('Two martial weapons', [], { picks: [{ from: 'martial', count: 2 }] })] },
      { options: [opt('Five javelins', [g('javelin', 5)]), opt('Any simple melee weapon', [], { picks: [{ from: 'simple-melee' }] })] },
      { options: [opt("A priest's pack", [g('priests-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('chain-mail')],
    alwaysPicks: [{ from: 'holy-symbol' }],
  },
  ranger: {
    choices: [
      { options: [opt('Scale mail', [g('scale-mail')]), opt('Leather armor', [g('leather-armor')])] },
      { options: [opt('Two shortswords', [g('shortsword', 2)]), opt('Two simple melee weapons', [], { picks: [{ from: 'simple-melee', count: 2 }] })] },
      { options: [opt("A dungeoneer's pack", [g('dungeoneers-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('longbow'), g('quiver'), g('arrow', 20)],
  },
  rogue: {
    choices: [
      { options: [opt('A rapier', [g('rapier')]), opt('A shortsword', [g('shortsword')])] },
      { options: [opt('A shortbow and a quiver of 20 arrows', [g('shortbow'), g('quiver'), g('arrow', 20)]), opt('A shortsword', [g('shortsword')])] },
      { options: [opt("A burglar's pack", [g('burglars-pack')]), opt("A dungeoneer's pack", [g('dungeoneers-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('leather-armor'), g('dagger', 2), g('thieves-tools')],
  },
  sorcerer: {
    choices: [
      { options: [opt('A light crossbow and 20 bolts', [g('crossbow-light'), g('crossbow-bolt', 20)]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
      { options: [opt('A component pouch', [g('component-pouch')]), opt('An arcane focus', [], { picks: [{ from: 'arcane-focus' }] })] },
      { options: [opt("A dungeoneer's pack", [g('dungeoneers-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('dagger', 2)],
  },
  warlock: {
    choices: [
      { options: [opt('A light crossbow and 20 bolts', [g('crossbow-light'), g('crossbow-bolt', 20)]), opt('Any simple weapon', [], { picks: [{ from: 'simple' }] })] },
      { options: [opt('A component pouch', [g('component-pouch')]), opt('An arcane focus', [], { picks: [{ from: 'arcane-focus' }] })] },
      { options: [opt("A scholar's pack", [g('scholars-pack')]), opt("A dungeoneer's pack", [g('dungeoneers-pack')])] },
    ],
    always: [g('leather-armor'), g('dagger', 2)],
    alwaysPicks: [{ from: 'simple' }],
  },
  wizard: {
    choices: [
      { options: [opt('A quarterstaff', [g('quarterstaff')]), opt('A dagger', [g('dagger')])] },
      { options: [opt('A component pouch', [g('component-pouch')]), opt('An arcane focus', [], { picks: [{ from: 'arcane-focus' }] })] },
      { options: [opt("A scholar's pack", [g('scholars-pack')]), opt("An explorer's pack", [g('explorers-pack')])] },
    ],
    always: [g('spellbook')],
  },
}

// SRD 5.2 (2024): package A (gear and a little gold), or all gold to buy your own.
const pack = (label: string, items: GearGrant[], gp: number, picks?: GearPick[]): GearChoice['options'][number] =>
  opt(label, items, { gold: gp, ...(picks ? { picks } : {}) })
const SRD_2024: Record<string, ClassGear> = {
  barbarian: { choices: [{ options: [pack('Greataxe, 4 handaxes, explorer’s pack and 15 GP', [g('greataxe'), g('handaxe', 4), g('explorers-pack')], 15), gold(75)] }], always: [] },
  bard: { choices: [{ options: [pack('Leather armor, 2 daggers, a lute, entertainer’s pack and 19 GP', [g('leather-armor'), g('dagger', 2), g('lute'), g('entertainers-pack')], 19), gold(90)] }], always: [] },
  cleric: {
    choices: [{ options: [pack('Chain shirt, shield, mace, holy symbol, priest’s pack and 7 GP', [g('chain-shirt'), g('shield'), g('mace'), g('priests-pack')], 7, [{ from: 'holy-symbol' }]), gold(110)] }],
    always: [],
  },
  druid: {
    choices: [{ options: [pack('Leather armor, shield, sickle, quarterstaff (druidic focus), explorer’s pack, herbalism kit and 9 GP', [g('leather-armor'), g('shield'), g('sickle'), g('quarterstaff'), g('explorers-pack'), g('herbalism-kit')], 9), gold(50)] }],
    always: [],
  },
  fighter: {
    choices: [
      {
        options: [
          pack('Chain mail, greatsword, flail, 8 javelins, dungeoneer’s pack and 4 GP', [g('chain-mail'), g('greatsword'), g('flail'), g('javelin', 8), g('dungeoneer-pack')], 4),
          pack('Studded leather, scimitar, shortsword, longbow, 20 arrows, quiver, dungeoneer’s pack and 11 GP', [g('studded-leather-armor'), g('scimitar'), g('shortsword'), g('longbow'), g('arrows', 20), g('quiver'), g('dungeoneer-pack')], 11),
          gold(155),
        ],
      },
    ],
    always: [],
  },
  monk: { choices: [{ options: [pack('Spear, 5 daggers, a lute, explorer’s pack and 11 GP', [g('spear'), g('dagger', 5), g('lute'), g('explorers-pack')], 11), gold(50)] }], always: [] },
  paladin: {
    choices: [{ options: [pack('Chain mail, shield, longsword, 6 javelins, holy symbol, priest’s pack and 9 GP', [g('chain-mail'), g('shield'), g('longsword'), g('javelin', 6), g('priests-pack')], 9, [{ from: 'holy-symbol' }]), gold(150)] }],
    always: [],
  },
  ranger: {
    choices: [{ options: [pack('Studded leather, scimitar, shortsword, longbow, 20 arrows, quiver, sprig of mistletoe, explorer’s pack and 7 GP', [g('studded-leather-armor'), g('scimitar'), g('shortsword'), g('longbow'), g('arrows', 20), g('quiver'), g('sprig-of-mistletoe'), g('explorers-pack')], 7), gold(150)] }],
    always: [],
  },
  rogue: {
    choices: [{ options: [pack('Leather armor, 2 daggers, shortsword, shortbow, 20 arrows, quiver, thieves’ tools, burglar’s pack and 8 GP', [g('leather-armor'), g('dagger', 2), g('shortsword'), g('shortbow'), g('arrows', 20), g('quiver'), g('thieves-tools'), g('burglars-pack')], 8), gold(100)] }],
    always: [],
  },
  sorcerer: { choices: [{ options: [pack('Spear, 2 daggers, crystal (arcane focus), dungeoneer’s pack and 28 GP', [g('spear'), g('dagger', 2), g('crystal'), g('dungeoneer-pack')], 28), gold(50)] }], always: [] },
  warlock: {
    choices: [{ options: [pack('Leather armor, sickle, 2 daggers, orb (arcane focus), book, scholar’s pack and 15 GP', [g('leather-armor'), g('sickle'), g('dagger', 2), g('orb'), g('book'), g('scholars-pack')], 15), gold(100)] }],
    always: [],
  },
  wizard: { choices: [{ options: [pack('2 daggers, quarterstaff (arcane focus), robe, spellbook, scholar’s pack and 5 GP', [g('dagger', 2), g('quarterstaff'), g('robe'), g('spellbook'), g('scholars-pack')], 5), gold(55)] }], always: [] },
}

export const STARTING_GEAR: Record<RulesSet, Record<string, ClassGear>> = { '2014': SRD_2014, '2024': SRD_2024 }
export const gearFor = (rules: RulesSet, classId: string): ClassGear | null => STARTING_GEAR[rules]?.[classId] ?? null

/** What a pick may be: weapons by category, or the focus / holy symbol items. */
export function pickChoices(pick: GearPick, items: readonly RulesItem[]): RulesItem[] {
  const ids: Record<string, string[]> = {
    'holy-symbol': ['amulet', 'emblem', 'reliquary'],
    'arcane-focus': ['crystal', 'orb', 'rod', 'staff', 'wand'],
    'druidic-focus': ['sprig-of-mistletoe', 'totem', 'wooden-staff', 'yew-wand'],
  }
  if (ids[pick.from]) return ids[pick.from].map((id) => items.find((i) => i.id === id)).filter((i): i is RulesItem => !!i)
  const [cat, melee] = pick.from.split('-') as ['simple' | 'martial', string | undefined]
  return items
    .filter((i) => i.kind === 'weapon' && i.weapon?.category === cat && (!melee || !i.weapon.ranged))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Every item id the class's gear can need (to load them before showing the choices). */
export function gearItemIds(gear: ClassGear): string[] {
  const ids = new Set<string>(gear.always.map((x) => x.id))
  for (const c of gear.choices) for (const o of c.options) for (const x of o.items) ids.add(x.id)
  return [...ids]
}

/**
 * The player's choices: one option per line, the picked items (key `c<line>.<pick>.<n>`, or
 * `a.<pick>.<n>` for the class's own picks), and what they bought with the gold.
 */
export type GearSelection = { options: (number | null)[]; picks: Record<string, string>; bought: string[] }
export const emptyGear = (): GearSelection => ({ options: [], picks: {}, bought: [] })
export const pickKeys = (prefix: string, picks: readonly GearPick[] = []): { key: string; pick: GearPick }[] =>
  picks.flatMap((p, i) => Array.from({ length: p.count ?? 1 }, (_, n) => ({ key: `${prefix}.${i}.${n}`, pick: p })))

export type ResolvedGear = {
  equipment: (RulesItem & { qty?: number })[]
  gold: number
  /** The gold left to spend in the shop (a gold option) */
  budget: number
  shopping: boolean
  /** What's still to choose (null: done) */
  open: string | null
}

export function resolveGear(gear: ClassGear | null, sel: GearSelection, items: readonly RulesItem[]): ResolvedGear {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out = new Map<string, RulesItem & { qty?: number }>()
  const add = (id: string, qty = 1): void => {
    const item = byId.get(id)
    if (!item) return
    const had = out.get(id)
    out.set(id, { ...item, qty: (had?.qty ?? 0) + qty })
  }
  if (!gear) return { equipment: [], gold: 0, budget: 0, shopping: false, open: null }
  let goldGp = 0
  let shopGold = 0
  let open: string | null = null
  gear.choices.forEach((c, ci) => {
    const o = sel.options[ci]
    const chosen = o === null || o === undefined ? null : c.options[o]
    if (!chosen) {
      open ??= gear.choices.length > 1 ? `Choose line ${ci + 1} of your starting equipment.` : 'Choose your starting equipment.'
      return
    }
    for (const x of chosen.items) add(x.id, x.qty ?? 1)
    for (const { key } of pickKeys(`c${ci}`, chosen.picks)) {
      const id = sel.picks[key]
      if (id) add(id)
      else open ??= 'Pick the items marked “Choose”.'
    }
    if (chosen.shop) shopGold += chosen.gold ?? 0
    else goldGp += chosen.gold ?? 0
  })
  for (const x of gear.always) add(x.id, x.qty ?? 1)
  for (const { key } of pickKeys('a', gear.alwaysPicks)) {
    const id = sel.picks[key]
    if (id) add(id)
    else open ??= 'Pick the items marked “Choose”.'
  }
  let budget = shopGold
  if (shopGold > 0)
    for (const id of sel.bought) {
      const item = byId.get(id)
      if (!item || item.cost > budget + 1e-9) continue
      budget = Math.round((budget - item.cost) * 100) / 100
      add(id)
    }
  return { equipment: [...out.values()], gold: goldGp + Math.floor(budget), budget, shopping: shopGold > 0, open }
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ABILITIES,
  blankSheet,
  crLabel,
  isDamageType,
  normalizeSheet,
  SKILL_IDS,
  creditFor,
  type Ability,
  type BuilderRules,
  type RulesItem,
  type RulesSet,
  type CreatureSize,
  type DamageType,
  type Sheet5e,
  type SheetAttack,
  type SkillId,
  type SrdMonster,
  type SrdMonsterSummary,
  type SrdSpell,
  type SrdSpellSummary,
} from "@glofly/shared";

// Campfire's compendium: SRD 5.1 monsters and spells (CC BY 4.0, see srd/README.md), read once
// from the trimmed JSON next to this file (the Docker image copies srd/ next to dist/campfire).

type RawFeature = { name: string; desc: string; attackBonus?: number; damage?: { dice: string; type: string | null }[] };
type RawMonster = {
  slug: string;
  name: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  hp: number;
  hitDice: string;
  speed: Record<string, string | boolean>;
  abilities: number[];
  saves: Record<string, number>;
  skills: Record<string, number>;
  vulnerable: string[];
  resist: string[];
  immune: string[];
  conditionImmunities: string[];
  senses: string;
  languages: string;
  cr: number;
  xp: number;
  prof: number;
  traits: RawFeature[];
  actions: RawFeature[];
  legendary: RawFeature[];
  reactions: RawFeature[];
};
type RawSpell = Omit<SrdSpell, "credit" | "save" | "damage" | "attack"> & {
  attack: string | null;
  save: { ability: string; half: boolean } | null;
  damage: { type: string | null; bySlot: Record<string, string> | null; byCharacterLevel: Record<string, string> | null } | null;
};

function loadOne<T>(file: string): T | null {
  const places = [join(__dirname, "srd", file), join(__dirname, "..", "..", "src", "campfire", "srd", file)];
  const path = places.find((p) => existsSync(p));
  if (!path) {
    console.error(`Campfire compendium: ${file} is missing.`);
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function load<T>(file: string): T[] {
  const places = [join(__dirname, "srd", file), join(__dirname, "..", "..", "src", "campfire", "srd", file)];
  const path = places.find((p) => existsSync(p));
  if (!path) {
    console.error(`Campfire compendium: ${file} is missing, so the compendium is empty.`);
    return [];
  }
  return JSON.parse(readFileSync(path, "utf8")) as T[];
}

// SRD 5.1 (2014 rules) monsters and spells sit at the top of srd/; SRD 5.2 (2024 rules) in srd/2024/.
// Builder data and items for both are in srd/<rules>/ (tools/campfire-srd/build.mjs).
const monsters = new Map<RulesSet, Map<string, RawMonster>>();
const spells = new Map<RulesSet, Map<string, RawSpell>>();
const fileFor = (rules: RulesSet, name: string) => (rules === "2024" ? `2024/${name}` : name);
const monstersBySlug = (rules: RulesSet = "2014") => {
  let m = monsters.get(rules);
  if (!m) monsters.set(rules, (m = new Map(load<RawMonster>(fileFor(rules, "monsters.json")).map((x) => [x.slug, x]))));
  return m;
};
const spellsBySlug = (rules: RulesSet = "2014") => {
  let m = spells.get(rules);
  if (!m) spells.set(rules, (m = new Map(load<RawSpell>(fileFor(rules, "spells.json")).map((x) => [x.slug, x]))));
  return m;
};

const builders = new Map<RulesSet, BuilderRules>();
/** The character builder's data for a rule set (species, classes, backgrounds, feats). */
export function builderData(rules: RulesSet): BuilderRules {
  let b = builders.get(rules);
  if (!b) {
    const raw = loadOne<BuilderRules>(`${rules}/builder.json`);
    b = { rules, species: raw?.species ?? [], classes: raw?.classes ?? [], backgrounds: raw?.backgrounds ?? [], feats: raw?.feats ?? [], credit: creditFor(rules) };
    builders.set(rules, b);
  }
  return b;
}

const items = new Map<RulesSet, RulesItem[]>();
const itemsOf = (rules: RulesSet) => {
  let i = items.get(rules);
  if (!i) items.set(rules, (i = load<RulesItem>(`${rules}/items.json`)));
  return i;
};
/** Armor, weapons, gear and magic items by name ("Add from the rules" in the inventory). */
export function searchItems(rules: RulesSet, q: string, kind: string | null, limit = 60): RulesItem[] {
  const needle = fold(q.trim());
  const hits = itemsOf(rules).filter((i) => (!needle || fold(i.name).includes(needle)) && (!kind || i.kind === kind));
  hits.sort((a, b) => Number(!fold(a.name).startsWith(needle)) - Number(!fold(b.name).startsWith(needle)) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
export const itemById = (rules: RulesSet, id: string): RulesItem | null => itemsOf(rules).find((i) => i.id === id) ?? null;

const SIZES: CreatureSize[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const sizeOf = (s: string): CreatureSize => (SIZES.includes(s as CreatureSize) ? (s as CreatureSize) : "medium");
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const monsterSummary = (m: RawMonster): SrdMonsterSummary => ({ slug: m.slug, name: m.name, cr: m.cr, type: m.type, size: sizeOf(m.size) });

/** Name search ("gob" finds Goblin), at most 50, best matches (name starts with it) first. */
export function searchMonsters(q: string, limit = 50, rules: RulesSet = "2014"): SrdMonsterSummary[] {
  const needle = fold(q.trim());
  const all = [...monstersBySlug(rules).values()];
  const hits = needle ? all.filter((m) => fold(m.name).includes(needle) || fold(m.type).includes(needle) || crLabel(m.cr) === needle) : all;
  hits.sort((a, b) => Number(!fold(a.name).startsWith(needle)) - Number(!fold(b.name).startsWith(needle)) || a.name.localeCompare(b.name));
  return hits.slice(0, limit).map(monsterSummary);
}

export function searchSpells(q: string, level: number | null, cls: string | null, limit = 100, rules: RulesSet = "2014"): SrdSpellSummary[] {
  const needle = fold(q.trim());
  const c = cls ? fold(cls) : null;
  const hits = [...spellsBySlug(rules).values()].filter(
    (s) => (!needle || fold(s.name).includes(needle)) && (level === null || s.level === level) && (!c || s.classes.some((x) => fold(x) === c)),
  );
  hits.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  return hits.slice(0, limit).map((s) => ({ slug: s.slug, name: s.name, level: s.level, school: s.school, classes: s.classes }));
}

export function spellBySlug(slug: string, rules: RulesSet = "2014"): SrdSpell | null {
  const s = spellsBySlug(rules).get(slug);
  if (!s) return null;
  const ability = s.save && (ABILITIES as readonly string[]).includes(s.save.ability) ? (s.save.ability as Ability) : null;
  return {
    ...s,
    attack: s.attack === "melee" || s.attack === "ranged" ? s.attack : null,
    save: ability ? { ability, half: s.save!.half } : null,
    damage: s.damage ? { type: isDamageType(s.damage.type) ? s.damage.type : null, bySlot: s.damage.bySlot, byCharacterLevel: s.damage.byCharacterLevel } : null,
    credit: creditFor(rules),
  };
}

/** Only exact damage types count ("fire"); conditional ones ("…from nonmagical weapons") stay as text. */
function damageTypes(list: string[]): { types: DamageType[]; other: string[] } {
  const types: DamageType[] = [];
  const other: string[] = [];
  for (const d of list) (isDamageType(d) ? types : other).push(d as DamageType);
  return { types, other };
}

/** A monster's stat block as a sheet, ready to roll. */
export function monsterSheet(m: RawMonster): Sheet5e {
  const sheet = blankSheet();
  const abilities = Object.fromEntries(ABILITIES.map((a, i) => [a, m.abilities[i] ?? 10])) as Record<Ability, number>;
  const resist = damageTypes(m.resist);
  const vulnerable = damageTypes(m.vulnerable);
  const immune = damageTypes(m.immune);
  const notes = [
    resist.other.length ? `Damage resistances: ${resist.other.join("; ")}` : "",
    vulnerable.other.length ? `Damage vulnerabilities: ${vulnerable.other.join("; ")}` : "",
    immune.other.length ? `Damage immunities: ${immune.other.join("; ")}` : "",
  ].filter(Boolean);
  const attacks: SheetAttack[] = [];
  for (const [i, a] of m.actions.entries()) {
    if (a.attackBonus === undefined || !a.damage?.length) continue;
    const first = a.damage[0];
    const ranged = /^Ranged/i.test(a.desc);
    const spell = /Spell Attack/i.test(a.desc);
    attacks.push({
      id: `m${i}`,
      name: a.name,
      kind: spell ? "spell" : ranged ? "ranged" : "melee",
      ability: null,
      proficient: false,
      bonus: 0,
      fixedToHit: a.attackBonus,
      damage: first.dice.replace(/\s+/g, ""),
      damageAbility: false,
      damageType: isDamageType(first.type) ? first.type : "bludgeoning",
      range: /range ([\d/]+ ft\.)/.exec(a.desc)?.[1] ?? /reach ([\d]+ ft\.)/.exec(a.desc)?.[1] ?? "",
      notes: a.damage.length > 1 ? `Also ${a.damage.slice(1).map((d) => `${d.dice} ${d.type ?? ""}`.trim()).join(", ")}` : "",
    });
  }
  const walk = typeof m.speed.walk === "string" ? Number.parseInt(m.speed.walk, 10) : 0;
  const other = Object.entries(m.speed)
    .filter(([k]) => k !== "walk")
    .map(([k, v]) => (typeof v === "string" ? `${k} ${v}` : k))
    .join(", ");
  const skills: Partial<Record<SkillId, number>> = {};
  for (const [k, v] of Object.entries(m.skills)) if ((SKILL_IDS as string[]).includes(k)) skills[k as SkillId] = v;
  const saves: Partial<Record<Ability, number>> = {};
  for (const [k, v] of Object.entries(m.saves)) if ((ABILITIES as readonly string[]).includes(k)) saves[k as Ability] = v;
  const hitDie = /^(\d+)d(\d+)/.exec(m.hitDice);
  const feature = (f: RawFeature, i: number, p: string) => ({ id: `${p}${i}`, name: f.name, text: f.desc });
  return normalizeSheet({
    ...sheet,
    size: sizeOf(m.size),
    alignment: m.alignment,
    abilities,
    saveOverrides: saves,
    skillOverrides: skills,
    profOverride: m.prof,
    ac: m.ac,
    speed: Number.isFinite(walk) ? walk : 0,
    otherSpeeds: other,
    hp: { current: m.hp, max: m.hp, temp: 0 },
    hitDice: hitDie && [6, 8, 10, 12].includes(Number(hitDie[2])) ? [{ die: Number(hitDie[2]), max: Math.min(20, Number(hitDie[1])), used: 0 }] : [],
    attacks,
    resist: resist.types,
    vulnerable: vulnerable.types,
    immune: immune.types,
    notes: notes.join("\n"),
    monster: {
      cr: m.cr,
      xp: m.xp,
      type: m.type,
      alignment: m.alignment,
      senses: m.senses,
      languages: m.languages,
      traits: m.traits.map((f, i) => feature(f, i, "t")),
      actions: m.actions.map((f, i) => feature(f, i, "x")),
      legendary: m.legendary.map((f, i) => feature(f, i, "l")),
      reactions: m.reactions.map((f, i) => feature(f, i, "e")),
      conditionImmunities: m.conditionImmunities,
    },
  });
}

export function monsterBySlug(slug: string, rules: RulesSet = "2014"): SrdMonster | null {
  const m = monstersBySlug(rules).get(slug);
  return m ? { ...monsterSummary(m), sheet: monsterSheet(m), credit: creditFor(rules) } : null;
}

export const isSrdSlug = (x: unknown): x is string => typeof x === "string" && /^[a-z0-9-]{1,80}$/.test(x);

// Campfire (phase 1, Nov 2026): a virtual tabletop for fifth edition rules inside Glofly calls.
// Every API type the server and the apps agree on. The server filters everything per viewer
// (fog of war, GM-only layers, notes, NPC sheets, monster numbers, GM-only rolls), so a player's
// app only ever receives what that player may see.

import type { PublicUser } from '../types'

// ───────────── Basics ─────────────

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'
export const ABILITIES: readonly Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']
export const ABILITY_NAMES: Record<Ability, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma'
}

export type SkillId =
  | 'acrobatics'
  | 'animalHandling'
  | 'arcana'
  | 'athletics'
  | 'deception'
  | 'history'
  | 'insight'
  | 'intimidation'
  | 'investigation'
  | 'medicine'
  | 'nature'
  | 'perception'
  | 'performance'
  | 'persuasion'
  | 'religion'
  | 'sleightOfHand'
  | 'stealth'
  | 'survival'

/** 0 = not proficient, 1 = proficient, 2 = expertise (double proficiency). */
export type SkillLevel = 0 | 1 | 2

export type DamageType =
  | 'acid'
  | 'bludgeoning'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'piercing'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'slashing'
  | 'thunder'
export const DAMAGE_TYPES: readonly DamageType[] = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder'
]

export type ConditionId =
  | 'blinded'
  | 'charmed'
  | 'deafened'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'petrified'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious'
  | 'exhaustion'

export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan'
export type AttackKind = 'melee' | 'ranged' | 'spell'
export type CasterType = 'none' | 'full' | 'half' | 'third' | 'pact'

// ───────────── Character sheets ─────────────

export type SheetClass = {
  name: string
  level: number
  /** 6, 8, 10 or 12 */
  hitDie: number
  caster: CasterType
  /** "Hunter" (optional, shown as "Ranger 5 (Hunter)") */
  subclass?: string
}

export type SheetAttack = {
  id: string
  name: string
  kind: AttackKind
  /** Ability the attack uses ('spell' = the spellcasting ability). Null: none (monsters' fixed numbers). */
  ability: Ability | 'spell' | null
  proficient: boolean
  /** Extra to-hit (a +1 weapon) */
  bonus: number
  /** Monsters: the stat block's to-hit, used as-is (ability/proficiency ignored) */
  fixedToHit: number | null
  /** The damage dice, maybe with a flat part: "1d8", "2d6+5" */
  damage: string
  /** Add the ability modifier to damage (weapons yes, most cantrips no) */
  damageAbility: boolean
  damageType: DamageType
  range: string
  notes: string
}

export type SheetSpell = {
  /** SRD slug when picked from the compendium */
  slug: string | null
  name: string
  /** 0 = cantrip */
  level: number
  prepared: boolean
  /** Optional details shown on the sheet (filled from the SRD when picked from the rules) */
  castingTime?: string
  range?: string
  duration?: string
  concentration?: boolean
  /** Dice rolled when it's cast ("2d4", "1d8+3"); damage or healing */
  roll?: string
  notes?: string
}

export type SpellSlots = { max: number; used: number }

export type SheetResource = {
  id: string
  name: string
  max: number
  used: number
  reset: 'short' | 'long' | 'none'
}

export type SheetItem = {
  id: string
  name: string
  qty: number
  notes: string
  /** Optional (Round A, Nov 2026): weight in lb each, worn/held, attuned, and what the item is */
  weight?: number
  equipped?: boolean
  attuned?: boolean
  kind?: 'armor' | 'shield' | 'weapon' | 'gear' | 'magic' | 'ammo'
  /** Armor: base AC, adds Dexterity (up to maxDex) */
  armor?: { base: number; dex: boolean; maxDex: number | null }
  /** A shield's (or a magic item's) bonus to AC while equipped */
  acBonus?: number
  /** Magic: needs attunement to work */
  attunement?: boolean
  rarity?: string
  /** The attack this weapon added to Actions */
  attackId?: string
  /** From the campaign's homebrew library */
  homebrewId?: string
}
export type SheetFeature = { id: string; name: string; text: string }
export type DeathSaves = { successes: number; failures: number; stable: boolean; dead: boolean }

/** Stat block details for NPCs and SRD monsters. */
export type MonsterInfo = {
  cr: number
  xp: number
  type: string
  alignment: string
  senses: string
  languages: string
  /** Special abilities */
  traits: SheetFeature[]
  /** Actions, as the stat block words them */
  actions: SheetFeature[]
  legendary: SheetFeature[]
  reactions: SheetFeature[]
  conditionImmunities: string[]
}

export type Sheet5e = {
  version: 1
  race: string
  background: string
  alignment: string
  classes: SheetClass[]
  size: CreatureSize
  abilities: Record<Ability, number>
  /** Saving throw proficiencies */
  saves: Partial<Record<Ability, boolean>>
  skills: Partial<Record<SkillId, SkillLevel>>
  /** Totals that win over the computed ones (monsters' stat blocks) */
  saveOverrides: Partial<Record<Ability, number>>
  skillOverrides: Partial<Record<SkillId, number>>
  /** Monsters: the stat block's proficiency bonus (null: from level) */
  profOverride: number | null
  ac: number
  /** Walking speed in feet; others free text ("fly 60 ft.") */
  speed: number
  otherSpeeds: string
  hp: { current: number; max: number; temp: number }
  /** Per die size: { die: 8, max: 5, used: 1 } */
  hitDice: { die: number; max: number; used: number }[]
  /** Extra initiative (Alert feat) */
  initiativeBonus: number
  attacks: SheetAttack[]
  spellcasting: {
    ability: Ability | null
    /** Index 0 = 1st level … 8 = 9th level */
    slots: SpellSlots[]
    /** Warlock pact slots (all the same level) */
    pact: { level: number; max: number; used: number } | null
    spells: SheetSpell[]
  }
  resources: SheetResource[]
  deathSaves: DeathSaves
  conditions: ConditionId[]
  /** 0–6 */
  exhaustion: number
  /** The spell being concentrated on (null: none) */
  concentration: string | null
  resist: DamageType[]
  vulnerable: DamageType[]
  immune: DamageType[]
  inventory: SheetItem[]
  features: SheetFeature[]
  notes: string
  /** The GM locked it: players can't change HP max or AC */
  locked: boolean
  monster: MonsterInfo | null
  /** Optional (Nov 10, 2026; older sheets don't have them) */
  /** Experience points */
  xp?: number
  /** Heroic inspiration */
  inspiration?: boolean
  /** What the AC comes from ("Leather", "hide armor") */
  acNote?: string
  /** Senses for player characters ("Darkvision 60 ft"); monsters keep theirs in `monster.senses` */
  senses?: string
  /** Round A (Nov 2026): coins, and how the character was made */
  coins?: { cp: number; sp: number; ep: number; gp: number; pp: number }
  /** Which 5e rules it was built with ("2014" / "2024") */
  rules?: '2014' | '2024'
  /** Builder ids, so level-up knows the class, species and background */
  build?: { species?: string; sub?: string; background?: string; classId?: string; subclass?: string; feats?: string[] }
}

export type CharacterKind = 'pc' | 'npc'

/** What everyone at the table sees of a PC (no sheet). */
export type CharacterPublic = {
  id: string
  campaignId: string
  ownerId: string | null
  kind: CharacterKind
  name: string
  portraitFileId: string | null
  ddbUrl: string | null
  summary: {
    race: string
    classLine: string
    level: number
    ac: number
    hp: { current: number; max: number; temp: number }
    conditions: ConditionId[]
    concentration: string | null
    deathSaves: DeathSaves
  }
  updatedAt: string
}

/** The owner's and GMs' view: everything. */
export type Character = CharacterPublic & { sheet: Sheet5e; srdMonster: string | null; full: true }
export type CharacterView = CharacterPublic | Character
export const isFullCharacter = (c: CharacterView): c is Character => (c as Character).full === true

// ───────────── Campaigns ─────────────

export type CampaignHomeKind = 'nebula' | 'chat'
export type CampaignHome = { kind: CampaignHomeKind; id: string }

export type CampaignSettings = {
  /** Damage waits for a GM to apply, change or skip it */
  gmApprovesDamage: boolean
  /** What players see of monsters' HP: numbers, only bloodied/defeated, or nothing */
  showMonsterHp: 'bloodied' | 'exact' | 'none'
  /** 'all': players pick who sees each roll. 'gm': players' rolls only go to GMs */
  diceVisibility: 'all' | 'gm'
  /** GMs only (never sent to players): new monsters go on the GM layer, hidden */
  placeHidden?: boolean
  /** Round A (Nov 2026; older campaigns don't have them) */
  /** Which 5e rules: '2014' (SRD 5.1, older campaigns) or '2024' (SRD 5.2) */
  rules?: '2014' | '2024'
  /** During a fight, players move their tokens only on their own turn */
  moveOnTurn?: boolean
  /** How the party levels up */
  leveling?: 'milestone' | 'xp'
  /** How the ruler and movement count diagonals on squares */
  diagonal?: '5' | '5-10'
  /** Round B: every token stays where it is (players can't move any) */
  tokensLocked?: boolean
}
export const DEFAULT_CAMPAIGN_SETTINGS: CampaignSettings = { gmApprovesDamage: true, showMonsterHp: 'bloodied', diceVisibility: 'all' }

export type CampaignRole = 'gm' | 'player'

export type CampaignSummary = {
  id: string
  name: string
  home: CampaignHome
  createdBy: string | null
  activeSceneId: string | null
  /** Open ("Campfire is lit") in this call right now */
  openInCallId: string | null
  myRole: CampaignRole
  updatedAt: string
  /** The Start board's "Your character": my player character in this campaign, if I have one */
  myCharacter?: CampaignCharacterCard | null
}

/** A player character in a few words (Start board). */
export type CampaignCharacterCard = { id: string; name: string; portraitFileId: string | null; line: string }

export type Campaign = CampaignSummary & {
  settings: CampaignSettings
  createdAt: string
  live?: TableLive
  /** 0.11.2: whoever made it, or a constellation admin, may delete it (only in the table's own answer) */
  canDelete?: boolean
}

/** Round B: the table's live state (pause, spotlight). */
export type TableLive = {
  paused: { by: string; message: string; at: string } | null
  spotlight: string | null
}
export const NO_LIVE: TableLive = { paused: null, spotlight: null }

export type CampaignMember = { userId: string; role: CampaignRole; user: PublicUser | null }

// ───────────── Scenes ─────────────

export type GridSettings = {
  type: 'square' | 'hex'
  /** Cell size in px */
  size: number
  /** Feet per cell */
  feet: number
  color: string
  opacity: number
  offsetX: number
  offsetY: number
}
export type MapTheme = 'stone' | 'wood' | 'grass' | 'cave' | 'snow' | 'sand' | 'night'
export const MAP_THEMES: readonly MapTheme[] = ['stone', 'wood', 'grass', 'cave', 'snow', 'sand', 'night']

export type Point = [number, number]
/**
 * 0.11.2: what every built piece may carry. `hidden`: the game master hid it from players until
 * they reveal it. `layer`: the map layer (BuiltMap.layers) it's on; a hidden layer hides all of
 * its pieces. Players never receive hidden pieces, layer names or these two fields.
 */
export type PieceShown = { hidden?: true; layer?: string }
export type BuiltFloor = { id: string; points: Point[]; material: string } & PieceShown
export type DoorState = 'open' | 'closed' | 'locked'
export type BuiltWall = { id: string; points: Point[]; door?: { state: DoorState } } & PieceShown
export type BuiltObject = { id: string; kind: string; x: number; y: number; w: number; h: number; rotation: number } & PieceShown
export type BuiltNote = { id: string; x: number; y: number; text: string } & PieceShown
/** Round B: painted terrain (movement costs double in it) */
export type TerrainKind = 'difficult' | 'water'
export type BuiltTerrain = { id: string; kind: TerrainKind; points: Point[] } & PieceShown
/** 0.11.2: a named map layer ("Upstairs", "Secret vault"). Hidden layers aren't sent to players. */
export type MapLayer = { id: string; name: string; hidden?: true }
export type BuiltMap = {
  floors: BuiltFloor[]
  walls: BuiltWall[]
  objects: BuiltObject[]
  notes: BuiltNote[]
  terrain?: BuiltTerrain[]
  /** 0.11.2: GM-only (players get none) */
  layers?: MapLayer[]
}

/**
 * Fog of war. With it on, everything is fogged except what the shapes reveal; shapes are applied
 * in order, and a shape with mode 'hide' fogs again what earlier shapes revealed (the latest shape
 * covering a point decides).
 */
export type FogShape = { id: string; kind: 'rect' | 'poly'; points: Point[]; mode?: 'reveal' | 'hide' }
export type FogState = { enabled: boolean; revealed: FogShape[] }

export type SceneSummary = { id: string; name: string; position: number; active: boolean }

export type Scene = {
  id: string
  campaignId: string
  name: string
  position: number
  widthPx: number
  heightPx: number
  grid: GridSettings
  backgroundFileId: string | null
  theme: MapTheme
  built: BuiltMap
  fog: FogState
  musicTrackId: string | null
  updatedAt: string
}

// ───────────── Tokens ─────────────

export type TokenLayer = 'map' | 'tokens' | 'gm'
export type BarShow = 'all' | 'owner' | 'gm'
/**
 * One of a token's three bars (bar 0 is HP; linked to the sheet when the token has a character).
 * Players may get `value`/`max` null with only `state` (monsters' HP with "bloodied" on).
 */
export type TokenBar = { value: number | null; max: number | null; color: string; show: BarShow; state?: 'healthy' | 'bloodied' | 'defeated' }
export type TokenAura = { radiusFt: number; color: string }

export type Token = {
  id: string
  sceneId: string
  layer: TokenLayer
  /** Null for players when it's an NPC's (its sheet is GM-only) */
  characterId: string | null
  name: string
  imageFileId: string | null
  /** px, top-left */
  x: number
  y: number
  /** cells */
  w: number
  h: number
  rotation: number
  bars: (TokenBar | null)[]
  conditions: string[]
  aura: TokenAura | null
  showName: boolean
  controlledBy: string[]
  z: number
  updatedAt: string
  /** Round B (optional for older servers): height in feet (flying, climbing) */
  elevation?: number
  /** Round B: the game master locked it (players can't move it) */
  locked?: boolean
  /** Round B: rounds left on timed conditions (condition → rounds) */
  conditionTimers?: Record<string, number>
}

// ───────────── Dice and rolls ─────────────

export type RollDie = {
  value: number
  kept: boolean
  /** Exploded (rolled its max, an extra die follows) */
  exploded?: boolean
  /** This die was added by an explosion */
  extra?: boolean
  /** Earlier values it was rerolled from */
  rerolled?: number[]
  /** Counted as a success (success counting) */
  success?: boolean
  /** Natural 20 / natural 1 on a d20 */
  crit?: boolean
  fumble?: boolean
}

export type RollTerm =
  | {
      kind: 'dice'
      /** "2d20kh1" */
      notation: string
      count: number
      /** 'F' = Fudge */
      sides: number | 'F'
      dice: RollDie[]
      total: number
      /** Success counting: total is how many succeeded */
      successes: boolean
      label: string | null
    }
  | { kind: 'number'; value: number; label: string | null }

export type RollResult = {
  /** Cleaned up: lower case, no spaces, no labels ("1d20+7") */
  expression: string
  /** From "#…" (or the only [label]) */
  label: string | null
  total: number
  terms: RollTerm[]
  /** "1d20+7 → (14) + 7 = 21" */
  breakdown: string
  /** The first kept d20's natural value (null: no d20) */
  natural: number | null
  crit: boolean
  fumble: boolean
  /** Explosions stopped at the dice limit */
  capped: boolean
}

export type RollVisibility = 'all' | 'gm' | 'whisper'

export type Roll = {
  id: string
  campaignId: string
  userId: string | null
  characterId: string | null
  label: string | null
  expression: string
  result: RollResult
  total: number
  visibility: RollVisibility
  whisperTo: string[]
  createdAt: string
}

/** `/roll` in chats: the optional `roll` field on a message (older apps show the body). */
export type ChatRoll = { expression: string; label: string | null; total: number; breakdown: string; dice: RollDie[] }

// ───────────── Attacks, pending damage, combat ─────────────

export type PendingDamage = {
  id: string
  campaignId: string
  attackerTokenId: string | null
  targetTokenId: string
  amount: number
  damageType: DamageType | null
  kind: AttackKind
  crit: boolean
  createdBy: string | null
  createdAt: string
}

/** `campfire:hit`: drives the bump / arrow / spell animation, the floating number and the bar. */
export type HitEvent = {
  attackerTokenId: string | null
  targetTokenId: string
  amount: number
  kind: AttackKind
  crit: boolean
  defeated: boolean
  bloodied: boolean
  /** A miss (amount 0): the arrow flies wide */
  miss?: boolean
  /** The target concentrates: a Constitution save at this DC (owner and GMs only) */
  concentrationDc?: number
  /**
   * The damage number isn't for this viewer (a monster whose exact HP the campaign hides): amount is 0;
   * apps show "Hit!" instead of a number.
   */
  amountHidden?: boolean
}

export type AttackInput = {
  attackerTokenId: string
  targetTokenId: string
  attack: { id?: string; name: string; toHit: string; damage: string; damageType: DamageType; kind: AttackKind }
  advantage?: 'adv' | 'dis'
}

export type AttackResult = {
  hit: boolean
  crit: boolean
  toHit: Roll
  damage: Roll | null
  /** GMs only (players get null) */
  pending: PendingDamage | null
  applied: HitEvent | null
}

export type SaveSpellResult = {
  damage: Roll
  targets: { tokenId: string; save: Roll; saved: boolean; amount: number; pending: PendingDamage | null; applied: HitEvent | null }[]
}

export type CombatEntry = {
  tokenId: string
  name: string
  init: number | null
  dex: number
  hidden: boolean
  /** Round B: feet moved this turn, Dash taken, the last move (for Undo), legendary actions used this round */
  moved?: number
  dashed?: boolean
  lastMove?: { x: number; y: number; cost: number } | null
  legendaryUsed?: number
  /** 0.11.3: a player's token (they roll their own initiative) */
  player?: boolean
}
/** rolling (0.11.3): players are still rolling initiative; the first turn starts once they all have. */
export type CombatState = { round: number; turn: number; entries: CombatEntry[]; rolling?: boolean }
/** What a viewer gets: hidden entries left out for players; `current` null when it's hidden. */
export type CombatView = CombatState & { current: string | null }

// ───────────── Handouts, files, music ─────────────

export type HandoutShare = 'all' | 'gm' | 'some'
export type HandoutSummary = { id: string; title: string; imageFileId: string | null; shared: HandoutShare; updatedAt: string }
export type Handout = HandoutSummary & { campaignId: string; body: string; sharedWith: string[]; createdBy: string | null; createdAt: string }

export type CampfireFileKind = 'map' | 'token' | 'portrait' | 'handout' | 'audio'
export type CampfireFile = { id: string; kind: CampfireFileKind; mime: string; bytes: number; width: number | null; height: number | null; createdAt: string }

export type Track = { id: string; campaignId: string; fileId: string; title: string; durationSec: number | null; createdAt: string }
/** Synced by server time: when playing, the track is at `position + (serverNow - startedAt) / 1000`. */
export type MusicState = { trackId: string; playing: boolean; startedAt: number; position: number; loop: boolean; volume: number }

// ───────────── The table ─────────────

/** GET /campfire/campaigns/:id: everything this viewer may see. */
export type TableState = {
  campaign: Campaign
  myRole: CampaignRole
  /** The live event sequence for me (gaps → load this again) */
  seq: number
  members: CampaignMember[]
  scenes: SceneSummary[]
  scene: Scene | null
  tokens: Token[]
  characters: CharacterView[]
  combat: CombatView | null
  music: MusicState | null
  /** GMs only */
  pending: PendingDamage[]
  rolls: Roll[]
  handouts: HandoutSummary[]
  tracks: Track[]
  present: string[]
  serverNow: number
}

// ───────────── Compendium (SRD 5.1) ─────────────

export const SRD_CREDIT =
  'Includes material from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC BY 4.0.'

export type SrdMonsterSummary = { slug: string; name: string; cr: number; type: string; size: CreatureSize }
export type SrdMonster = SrdMonsterSummary & { sheet: Sheet5e; credit: string }
export type SrdSpellSummary = { slug: string; name: string; level: number; school: string; classes: string[] }
export type SrdSpell = SrdSpellSummary & {
  desc: string
  higherLevel: string
  range: string
  components: string
  duration: string
  castingTime: string
  concentration: boolean
  ritual: boolean
  attack: 'melee' | 'ranged' | null
  save: { ability: Ability; half: boolean } | null
  damage: { type: DamageType | null; bySlot: Record<string, string> | null; byCharacterLevel: Record<string, string> | null } | null
  credit: string
}

// ───────────── Live events (socket feature `campfire`) ─────────────

/** The live-connection feature apps send to get Campfire events. */
export const CAMPFIRE_FEATURE = 'campfire'
/** 0.11.2: apps that keep built pieces' hidden marks and map layers when they save a map. */
export const CAMPFIRE_HIDE_FEATURE = 'campfire2'

/** Every event carries these; a gap in `seq` means "load the table again". */
export type CampfireEventBase = { campaignId: string; seq: number }
export type CampfireEvents = {
  'campfire:opened': CampfireEventBase & { callId: string; name: string; by: string }
  'campfire:closed': CampfireEventBase & { callId: string }
  'campfire:state': CampfireEventBase & { reason: string }
  /** Round A: the campaign hub changed (sessions, RSVPs, quests, journal, loot, homebrew) */
  'campfire:hub': CampfireEventBase & { reason: string }
  'campfire:token': CampfireEventBase & ({ op: 'upsert'; token: Token } | { op: 'delete'; tokenId: string; sceneId: string })
  'campfire:scene': CampfireEventBase & { op: 'upsert' | 'activate' | 'delete'; scene: Scene | null; sceneId: string; scenes: SceneSummary[]; tokens?: Token[] }
  'campfire:fog': CampfireEventBase & { sceneId: string; fog: FogState; built: BuiltMap; tokens: Token[] }
  'campfire:roll': CampfireEventBase & { roll: Roll }
  'campfire:pending': CampfireEventBase & { pending: PendingDamage[] }
  'campfire:hit': CampfireEventBase & HitEvent
  'campfire:combat': CampfireEventBase & { combat: CombatView | null }
  'campfire:character': CampfireEventBase & ({ op: 'upsert'; character: CharacterView } | { op: 'delete'; characterId: string })
  'campfire:handout': CampfireEventBase & ({ op: 'upsert'; handout: HandoutSummary } | { op: 'delete'; handoutId: string })
  'campfire:music': CampfireEventBase & { music: MusicState | null; tracks?: Track[]; serverNow: number }
  'campfire:ping': CampfireEventBase & { userId: string; sceneId: string; x: number; y: number }
  'campfire:presence': CampfireEventBase & { present: string[] }
  'campfire:members': CampfireEventBase & { members: CampaignMember[] }
  /** Round B: pause / spotlight changed */
  'campfire:live': CampfireEventBase & { live: TableLive }
  /** Round B: the game master moved everyone's view */
  'campfire:view': CampfireEventBase & { sceneId: string; x: number; y: number; by: string }
  /** Round B: a sound board sound (built-in id or an uploaded sound's file) */
  'campfire:sound': CampfireEventBase & { builtin: string | null; fileId: string | null; volume: number }
  /** Round B: the game master is (or stopped) whispering to you */
  'campfire:whisper': CampfireEventBase & { from: string; to: string; on: boolean }
  /** Round B: a short line for everyone ("Bless ended on Wren") */
  'campfire:notice': CampfireEventBase & { text: string }
  /** Round B: the game master removed you from this table */
  'campfire:removed': CampfireEventBase & { userId: string }
}

// ───────────── Limits ─────────────

export const CAMPFIRE_LIMITS = {
  campaignsPerHome: 20,
  scenesPerCampaign: 30,
  tokensPerScene: 500,
  characters: 300,
  handouts: 200,
  tracks: 50,
  campaignName: 60,
  sceneName: 60,
  tokenName: 60,
  characterName: 60,
  handoutTitle: 120,
  handoutBody: 20_000,
  trackTitle: 120,
  mapBytes: 25 * 1024 * 1024,
  mapSide: 8192,
  imageBytes: 8 * 1024 * 1024,
  audioBytes: 20 * 1024 * 1024,
  campaignBytes: 1024 * 1024 * 1024,
  fogShapes: 500,
  /** Corners of every fog shape together (keeps fog checks cheap) */
  fogPoints: 5000,
  builtPieces: 2000,
  /** 0.11.2 */
  mapLayers: 20,
  mapLayerName: 40,
  noteText: 1000,
  rollsKept: 2000,
  rollsPerMinute: 60,
  movesPerSecond: 30
} as const

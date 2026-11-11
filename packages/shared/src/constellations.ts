// Constellations (Glofly 2.0): communities with text and voice nebulas, categories, members and
// roles. The rules every app and the server agree on: limits, permissions, colors, templates.
//
// A Constellation has nebulas (its channels): text nebulas are chat rooms (each one is a
// conversation of kind "nebula" on the server, so every chat feature works in them) and voice
// nebulas are drop-in voice/video rooms (a LiveKit room per nebula, no ringing).

import type { PublicUser, ServerEvent } from './types'

// ───────────── Limits ─────────────

export const CONSTELLATION_NAME_MAX = 40
export const CONSTELLATION_DESCRIPTION_MAX = 300
export const NEBULA_NAME_MAX = 32
export const NEBULA_TOPIC_MAX = 120
export const CATEGORY_NAME_MAX = 32
export const ROLE_NAME_MAX = 24
/** People in one constellation */
export const CONSTELLATION_MEMBERS_MAX = 250
/** Nebulas (text + voice) in one constellation */
export const NEBULAS_MAX = 50
export const CATEGORIES_MAX = 20
/** Roles besides Owner and Member */
export const CUSTOM_ROLES_MAX = 15
/** Constellations one person can own */
export const CONSTELLATIONS_OWNED_MAX = 10
/** Constellations one person can be in */
export const CONSTELLATIONS_JOINED_MAX = 100
/** People in one voice nebula at once */
export const VOICE_NEBULA_MAX = 50
/** Genre tags on a public constellation */
export const CONSTELLATION_TAGS_MAX = 5
export const CONSTELLATION_TAG_MAX = 20
/** A note sent with a request to join */
export const JOIN_REQUEST_NOTE_MAX = 200
export const MODERATION_REASON_MAX = 200

// ───────────── Who can join ─────────────

/**
 * invite: only people with an invite (never in the directory).
 * public: listed in the directory; anyone can join.
 * approval: listed in the directory; people ask to join and someone with
 *   "Approve join requests" lets them in.
 */
export type ConstellationVisibility = 'invite' | 'public' | 'approval'
export const CONSTELLATION_VISIBILITIES: readonly ConstellationVisibility[] = ['invite', 'public', 'approval']

export const VISIBILITY_LABELS: Record<ConstellationVisibility, { name: string; what: string }> = {
  invite: { name: 'Invite only', what: 'Only people with an invite can join' },
  public: { name: 'Public', what: 'Listed in the directory · anyone can join' },
  approval: { name: 'Public, approval needed', what: 'Listed in the directory · a moderator lets people in' },
}

/** What kind of community it is (directory filter). */
export type ConstellationType = 'gaming' | 'study' | 'friends' | 'music' | 'art' | 'sports' | 'tech' | 'other'
export const CONSTELLATION_TYPES: readonly { id: ConstellationType; name: string }[] = [
  { id: 'gaming', name: 'Gaming' },
  { id: 'study', name: 'Study' },
  { id: 'friends', name: 'Friends & hangout' },
  { id: 'music', name: 'Music' },
  { id: 'art', name: 'Art & creative' },
  { id: 'sports', name: 'Sports' },
  { id: 'tech', name: 'Tech' },
  { id: 'other', name: 'Other' },
]
export const isConstellationType = (x: unknown): x is ConstellationType =>
  typeof x === 'string' && CONSTELLATION_TYPES.some((t) => t.id === x)

/** A genre tag as stored: trimmed, lower case, letters/numbers/spaces/dashes, up to 20 characters. */
export function cleanTag(raw: string): string | null {
  const t = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
  if (!t || t.length > CONSTELLATION_TAG_MAX) return null
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '&+-]*$/u.test(t)) return null
  return t
}

// ───────────── Colors ─────────────

/**
 * A constellation's color: its card banner and stars on the dashboard, its sidebar banner, and
 * the color of its icon when it has no photo.
 */
export type ConstellationColor = 'ember' | 'lagoon' | 'violet' | 'green' | 'red'
export const CONSTELLATION_COLORS: readonly ConstellationColor[] = ['ember', 'lagoon', 'violet', 'green', 'red']
export const CONSTELLATION_THEME: Record<
  ConstellationColor,
  {
    name: string
    /** Card banner on the dashboard */
    banner: string
    /** Sidebar banner inside the constellation */
    sideBanner: string
    /** Stars on the banners: small, then the glowing one */
    star: string
    glow: string
    /** Text accents on dark backgrounds (your role on its card) */
    accent: string
    /** The icon's background when there's no photo, and its letters */
    icon: string
    iconText: string
    /** The "6 new" / "@you" badge on its card */
    badge: string
    badgeText: string
  }
> = {
  ember: {
    name: 'Ember',
    banner: '#2a1c17',
    sideBanner: '#241712',
    star: '#e9d5c4',
    glow: '#ffb347',
    accent: '#ffb347',
    icon: '#f47a1f',
    iconText: '#2a1406',
    badge: '#f47a1f',
    badgeText: '#2a1406',
  },
  lagoon: {
    name: 'Lagoon',
    banner: '#173944',
    sideBanner: '#132f38',
    star: '#b5e7f6',
    glow: '#8ad8ef',
    accent: '#8ad8ef',
    icon: '#1789ad',
    iconText: '#ffffff',
    badge: '#1789ad',
    badgeText: '#ffffff',
  },
  violet: {
    name: 'Violet',
    banner: '#3a2552',
    sideBanner: '#2f1e43',
    star: '#e2c9ff',
    glow: '#cfa8ff',
    accent: '#cfa8ff',
    icon: '#8b3fd9',
    iconText: '#ffffff',
    badge: '#b57cff',
    badgeText: '#1d0a33',
  },
  green: {
    name: 'Green',
    banner: '#173a26',
    sideBanner: '#13301f',
    star: '#c4f0d6',
    glow: '#6fd39a',
    accent: '#6fd39a',
    icon: '#2e9e5b',
    iconText: '#ffffff',
    badge: '#2e9e5b',
    badgeText: '#ffffff',
  },
  red: {
    name: 'Red',
    banner: '#45192a',
    sideBanner: '#3a1523',
    star: '#ffc9d3',
    glow: '#ff8a9b',
    accent: '#ff8a9b',
    icon: '#e0193a',
    iconText: '#ffffff',
    badge: '#e0193a',
    badgeText: '#ffffff',
  },
}
export const isConstellationColor = (x: unknown): x is ConstellationColor =>
  typeof x === 'string' && (CONSTELLATION_COLORS as readonly string[]).includes(x)

/** A color picked from the name, for new constellations (the Owner can change it). */
export function colorForName(name: string): ConstellationColor {
  let h = 0
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return CONSTELLATION_COLORS[h % CONSTELLATION_COLORS.length]
}

/** "NO" for Night Owls, "LC" for Lexington Climbing, "S" for Study. */
export function constellationInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  const first = (w: string) => [...w][0]?.toUpperCase() ?? ''
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1])
}

/**
 * A role's color. `dot` is the swatch; `light`/`dark` are names on white and on the dark sidebar;
 * `badgeBg`/`badgeText` the little OWNER / ADMIN badge by names in the chat.
 */
export type RoleColor = 'ember' | 'lagoon' | 'violet' | 'green' | 'red' | 'gray'
/** The colors a role can be given (Owner is always ember, Member always gray). */
export const ROLE_COLOR_CHOICES: readonly RoleColor[] = ['violet', 'lagoon', 'green', 'red']
export const ROLE_COLORS: Record<
  RoleColor,
  { name: string; dot: string; light: string; heading: string; dark: string; badgeBg: string; badgeText: string }
> = {
  ember: { name: 'Ember', dot: '#e2650f', light: '#b8430a', heading: '#8a3005', dark: '#ffb347', badgeBg: '#fbdcc4', badgeText: '#8a3005' },
  lagoon: { name: 'Lagoon', dot: '#1789ad', light: '#127596', heading: '#0f6f8f', dark: '#8ad8ef', badgeBg: '#cfe8f1', badgeText: '#0f6f8f' },
  violet: { name: 'Violet', dot: '#8b3fd9', light: '#6b2fae', heading: '#6b2fae', dark: '#cfa8ff', badgeBg: '#ead9fb', badgeText: '#5a2496' },
  green: { name: 'Green', dot: '#2e9e5b', light: '#1f7a45', heading: '#1a6a3b', dark: '#6fd39a', badgeBg: '#d3f0de', badgeText: '#1a6a3b' },
  red: { name: 'Red', dot: '#e0193a', light: '#b3132f', heading: '#930f27', dark: '#ff8a9b', badgeBg: '#fbd3da', badgeText: '#930f27' },
  gray: { name: 'Gray', dot: '#b4a296', light: '#24170f', heading: '#6b5547', dark: '#f5ede6', badgeBg: '#efe6de', badgeText: '#4a372b' },
}
export const isRoleColor = (x: unknown): x is RoleColor => typeof x === 'string' && x in ROLE_COLORS

// ───────────── Roles and permissions ─────────────

/**
 * What a role lets people do. The Owner can do everything (and transfer ownership or delete the
 * constellation, which nobody else can). People get everything their highest role allows; the
 * "Member" role (everyone) sets what everyone can do.
 */
export type ConstellationPermission =
  | 'deleteMessages'
  | 'timeoutKick'
  | 'ban'
  | 'muteVoice'
  | 'manageNebulas'
  | 'invite'
  | 'approveRequests'
  | 'manageRoles'
  | 'manageConstellation'
  | 'events'
  | 'mentionEveryone'
  | 'manageEmoji'
  | 'manageStages'

export const PERMISSIONS: readonly { id: ConstellationPermission; name: string; what: string | null }[] = [
  { id: 'deleteMessages', name: 'Delete messages', what: "Anyone's, in every nebula" },
  { id: 'timeoutKick', name: 'Time out and kick members', what: 'Members only, never Admins or the Owner' },
  { id: 'ban', name: 'Ban people', what: "They can't come back until they're unbanned" },
  { id: 'muteVoice', name: 'Mute people in voice nebulas', what: null },
  { id: 'manageNebulas', name: 'Manage nebulas and categories', what: 'Create, rename, reorder, delete' },
  { id: 'invite', name: 'Invite people', what: null },
  { id: 'approveRequests', name: 'Approve join requests', what: 'When people ask to join from the directory' },
  { id: 'manageRoles', name: 'Manage roles below this one', what: null },
  { id: 'manageConstellation', name: 'Edit constellation settings', what: 'Name, icon, color, description, who can join' },
  // 0.8.0: everyone can by default (approved board 13: "anyone allowed to post can make an event").
  { id: 'events', name: 'Create events', what: 'Plan events with RSVP in nebulas they can post in' },
  // Communities round 4.2 (approved board 24): off for Members by default. Without it, @everyone
  // is plain text (the server checks every mention).
  { id: 'mentionEveryone', name: 'Mention @everyone, @here and all roles', what: 'Without it, @everyone is plain text' },
  // Communities round 2 (Nov 2026): Admins get both; Moderators get Manage stages.
  { id: 'manageEmoji', name: 'Manage emoji & stickers', what: 'Add, rename and remove the constellation’s own' },
  { id: 'manageStages', name: 'Manage stages', what: 'Start and end stages, invite people up to speak, move speakers to the audience' },
]
export const ALL_PERMISSIONS: readonly ConstellationPermission[] = PERMISSIONS.map((p) => p.id)
/** Any of these opens Settings from the constellation's main view (0.7.1: the gear by its name). */
export const SETTINGS_PERMISSIONS: readonly ConstellationPermission[] = [
  'manageConstellation',
  'manageNebulas',
  'manageRoles',
  'approveRequests',
  'ban',
  'timeoutKick',
]

export const isPermission = (x: unknown): x is ConstellationPermission =>
  typeof x === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(x)

/** The roles every constellation starts with (besides the Owner). */
export const DEFAULT_ROLES: readonly { kind: 'admin' | 'moderator' | 'member'; name: string; color: RoleColor; permissions: ConstellationPermission[] }[] = [
  { kind: 'admin', name: 'Admin', color: 'lagoon', permissions: [...ALL_PERMISSIONS] },
  {
    kind: 'moderator',
    name: 'Moderator',
    color: 'violet',
    permissions: ['deleteMessages', 'timeoutKick', 'muteVoice', 'invite', 'approveRequests', 'events', 'mentionEveryone', 'manageStages'],
  },
  { kind: 'member', name: 'Member', color: 'gray', permissions: ['invite', 'events'] },
]

/** How long a time-out lasts. */
export type TimeoutLength = '5m' | '1h' | '1d' | '1w'
export const TIMEOUT_LENGTHS: readonly { id: TimeoutLength; name: string; ms: number }[] = [
  { id: '5m', name: '5 minutes', ms: 5 * 60_000 },
  { id: '1h', name: '1 hour', ms: 60 * 60_000 },
  { id: '1d', name: '1 day', ms: 24 * 60 * 60_000 },
  { id: '1w', name: '1 week', ms: 7 * 24 * 60 * 60_000 },
]

// ───────────── Templates ─────────────

export type ConstellationTemplate = 'friends' | 'gaming' | 'study' | 'blank'

/** 0.8.0: a role a template starts with. Members pick these themselves (labels, never permissions). */
export type TemplateRole = { name: string; color: RoleColor; selfAssign: boolean }
/** A template's nebula. `roles`: only people with one of these (template role names) see it. */
export type TemplateNebula = { name: string; kind: NebulaKind; topic?: string; roles?: string[] }

/**
 * What a new constellation starts with. 0.8.0 (approved Templates board): besides nebulas, the
 * starter roles members can pick, house rules, the welcome text (the about new members see, also
 * the description), and an accent. Older apps send only the id and get all of it.
 */
export const CONSTELLATION_TEMPLATES: readonly {
  id: ConstellationTemplate
  name: string
  what: string
  categories: { name: string; nebulas: TemplateNebula[] }[]
  /** 0.8.0 (missing from older apps' copy) */
  accent: ConstellationAccent
  roles: TemplateRole[]
  rules: string[]
  /** The about new members see on the welcome screen (null = they write it themselves) */
  welcome: string | null
}[] = [
  {
    id: 'blank',
    name: 'Start empty',
    what: 'Just a general nebula',
    categories: [{ name: 'General', nebulas: [{ name: 'general', kind: 'text' }] }],
    accent: 'gold',
    roles: [],
    rules: [],
    welcome: null,
  },
  {
    id: 'friends',
    name: 'Friends hangout',
    what: 'Chill spot for your crew',
    categories: [
      {
        name: 'Hangout',
        nebulas: [
          { name: 'general', kind: 'text', topic: 'Say hi!' },
          { name: 'clips', kind: 'text' },
          { name: 'memes', kind: 'text' },
        ],
      },
      { name: 'Voice nebulas', nebulas: [{ name: 'Campfire', kind: 'voice' }] },
    ],
    // The board's "Glow Orange" is closest to the firefly gold accent.
    accent: 'gold',
    roles: [
      { name: 'Night owl', color: 'violet', selfAssign: true },
      { name: 'Early bird', color: 'red', selfAssign: true },
    ],
    rules: ['Be kind. This is a hangout, not a debate club.', 'Keep it fun for everyone in the room.', "Ask before sharing someone's photo."],
    welcome: 'Welcome to the hangout! Say hi in #general and tell us what you’re up to.',
  },
  {
    id: 'gaming',
    name: 'Gaming squad',
    what: 'Find teammates, hop in voice',
    categories: [
      {
        name: 'Hangout',
        nebulas: [
          { name: 'general', kind: 'text', topic: "Say hi, share what you're playing" },
          { name: 'looking-for-group', kind: 'text' },
          { name: 'clips', kind: 'text' },
        ],
      },
      {
        name: 'Games',
        nebulas: [
          { name: 'rocket-league', kind: 'text', roles: ['Rocket League'] },
          { name: 'valorant', kind: 'text', roles: ['Valorant'] },
          { name: 'minecraft', kind: 'text', roles: ['Minecraft'] },
        ],
      },
      { name: 'Voice nebulas', nebulas: [{ name: 'Campfire', kind: 'voice' }, { name: 'Squad Up', kind: 'voice' }] },
    ],
    accent: 'violet',
    roles: [
      { name: 'Rocket League', color: 'lagoon', selfAssign: true },
      { name: 'Valorant', color: 'red', selfAssign: true },
      { name: 'Minecraft', color: 'green', selfAssign: true },
    ],
    rules: ['Be a good teammate. No flaming.', 'No cheats, hacks or selling accounts.', 'Put spoilers and clips in the right nebula.'],
    welcome: 'Welcome to the squad! Pick the games you play and their nebulas show up for you.',
  },
  {
    id: 'study',
    name: 'Study group',
    what: 'Share notes, study together',
    categories: [
      {
        name: 'Study',
        nebulas: [
          { name: 'resources', kind: 'text' },
          { name: 'homework-help', kind: 'text' },
          { name: 'off-topic', kind: 'text' },
        ],
      },
      { name: 'Voice nebulas', nebulas: [{ name: 'Study room', kind: 'voice' }] },
    ],
    accent: 'lagoon',
    roles: [
      { name: 'Math', color: 'red', selfAssign: true },
      { name: 'Science', color: 'green', selfAssign: true },
      { name: 'Writing', color: 'violet', selfAssign: true },
    ],
    rules: ["Help each other understand. Don't just post answers.", 'Keep #homework-help for questions.', 'Quiet in the Study room unless everyone agrees.'],
    welcome: 'Welcome to the study group! Drop useful links in #resources and ask anything in #homework-help.',
  },
]

// ───────────── Role-only nebulas (0.8.0) ─────────────

/**
 * Who can see a nebula or a category: everyone in the constellation, or only people with one of
 * `roleIds` (roles members pick themselves count too, though they never give permissions). The
 * Owner and anyone whose roles can manage nebulas always see everything. A nebula in a role-only
 * category needs both: one of the category's roles AND its own setting.
 */
export type NebulaVisibility = 'everyone' | 'roles'
export type VisibilityGate = { visibility?: NebulaVisibility | null; roleIds?: readonly string[] | null }

/** Does someone holding `held` (role ids) get through this gate? Missing / "everyone" = yes. */
export function gateOpen(gate: VisibilityGate | null | undefined, held: ReadonlySet<string>): boolean {
  if (!gate || gate.visibility !== 'roles') return true
  return (gate.roleIds ?? []).some((id) => held.has(id))
}

/** Can someone see this nebula? `seesAll`: the Owner, or roles that can manage nebulas. */
export function canSeeNebula(
  seesAll: boolean,
  held: ReadonlySet<string>,
  nebula: VisibilityGate,
  category: VisibilityGate | null | undefined,
): boolean {
  return seesAll || (gateOpen(category, held) && gateOpen(nebula, held))
}

/** A nebula's name as people type it: "#valorant" for text, "Campfire" for voice. */
export const nebulaLabel = (n: { kind: NebulaKind; name: string }): string => (n.kind !== 'voice' ? `#${n.name}` : n.name)

// ───────────── What the API sends ─────────────

/** Communities round: 'forum' (posts with titles and tags). Older apps are sent forums as read-only text. */
export type NebulaKind = 'text' | 'voice' | 'forum'

/** Who's in a voice nebula right now. */
export type VoiceNebulaState = {
  nebulaId: string
  /** The call behind it (its LiveKit room); null when nobody's in */
  callId: string | null
  /** People in it, in the order they joined */
  userIds: string[]
  /** Someone in it is sharing their screen */
  live: boolean
  /** People sharing their screen right now */
  sharing: string[]
  /** People a moderator muted (they can't unmute until they rejoin or are unmuted) */
  muted: string[]
}

/**
 * 0.7.5: a watch-only pass to peek at a screen share in a voice nebula before joining (the LIVE
 * preview). It can't send anything, the person stays hidden, and it's ended after a short while.
 */
export type VoicePreviewPass = {
  url: string
  token: string
  /** People sharing their screen right now */
  sharing: string[]
  /** The server ends the peek after this long */
  lastsMs: number
}
/** How long a LIVE preview may stay connected */
export const VOICE_PREVIEW_MS = 90_000

/** A card on the dashboard. */
export type ConstellationCard = {
  id: string
  name: string
  color: ConstellationColor
  /** The icon photo's version (null = initials) */
  iconVersion: string | null
  memberCount: number
  onlineCount: number
  visibility: ConstellationVisibility
  /** Unread messages in its nebulas */
  unreadCount: number
  /** Unread messages that @mention you */
  mentionCount: number
  /** Your highest role (Owner first) */
  role: { name: string; color: RoleColor; owner: boolean }
  /** "Maya, Jacob and Sam in Campfire" (the busiest voice nebula), or null */
  voice: { nebulaName: string; people: PublicUser[]; live: boolean; total: number } | null
  /** The latest mention of you: "Dana mentioned you in exam-prep" */
  lastMention: { by: PublicUser; nebulaName: string } | null
  /** When something last happened in it (ISO date) */
  activityAt: string
  /** 0.7.5 living sky: its nebulas as stars (missing from older servers) */
  sky?: NebulaStar[]
  /** 0.7.5 identity: its accent color (null/missing = the classic firefly gold) */
  accent?: ConstellationAccent | null
  /** 0.7.5 identity: its banner photo's version (null/missing = the drawn sky) */
  bannerVersion?: string | null
  /** Where you dragged it on the dashboard and the icon strip (lower first; null = never moved) */
  position: number | null
  /** 0.9.3: pinned to your desktop sidebar (its place among your pins; null/missing = not pinned) */
  sidebarPin?: number | null
  /** 0.9.3: you muted it (the sidebar pin fades and shows no badge) */
  muted?: boolean
}

/** 0.9.3: how many constellations the desktop sidebar holds. */
export const SIDEBAR_PINS_MAX = 5

export type ConstellationInvite = {
  id: string
  constellation: DirectoryEntry
  by: PublicUser
  createdAt: string
}

/** A constellation in the directory, a link preview, or an invite. */
export type DirectoryEntry = {
  id: string
  name: string
  description: string | null
  color: ConstellationColor
  iconVersion: string | null
  memberCount: number
  onlineCount: number
  visibility: ConstellationVisibility
  type: ConstellationType | null
  tags: string[]
  /** Friends of yours in it (up to 3) */
  friends: PublicUser[]
  /** You're already in it */
  joined: boolean
  /** You asked to join and are waiting */
  requested: boolean
  /** 0.7.5 identity (missing from older servers) */
  accent?: ConstellationAccent | null
  bannerVersion?: string | null
}

export type ConstellationRole = {
  id: string
  /** Owner isn't a stored role: it's who owns it. "member" is everyone's role. */
  kind: 'owner' | 'admin' | 'moderator' | 'member' | 'custom'
  name: string
  color: RoleColor
  /** Higher = more powerful (Owner is above everything) */
  position: number
  permissions: ConstellationPermission[]
  memberCount: number
  /** 0.7.5: members can pick this role themselves (welcome screen, "Your roles") */
  selfAssign?: boolean
  /** Communities round 4.2: anyone can @mention it (missing = no) */
  mentionable?: boolean
}

export type ConstellationCategory = {
  id: string
  name: string
  position: number
  /** 0.8.0 role-only: sent only to people who can manage nebulas (missing = everyone) */
  visibility?: NebulaVisibility
  roleIds?: string[]
}

export type Nebula = {
  id: string
  kind: NebulaKind
  name: string
  topic: string | null
  categoryId: string | null
  position: number
  /** The conversation holding its messages (text nebulas, and a voice nebula's chat) */
  conversationId: string
  /** Only people who can manage nebulas or delete messages can post (announcements) */
  readOnly: boolean
  unreadCount: number
  mentionCount: number
  /** Your notification setting for it (null = the constellation's default for you) */
  notify: NotifyLevel | null
  /** Muted for a while (ISO; @mentions still get through), or null. Missing from older servers. */
  mutedUntil?: string | null
  /** 0.7.5: when you last read it (ISO): the "New since you left" line. Missing from older servers. */
  lastReadAt?: string | null
  /** 0.7.5: how many people posted in it in the last few minutes (the sky's "chatting" pulse) */
  chatting?: number
  /** 0.8.0 role-only: sent only to people who can manage nebulas (missing = everyone) */
  visibility?: NebulaVisibility
  roleIds?: string[]
  /** Communities round: integrations (bridges) that read its messages, by name. Members see a notice. */
  sharedWith?: string[]
  /** Communities round 4.3: only people who picked it see it (managers see the flag) */
  optional?: boolean
  /** Communities round: threads (text nebulas) and forum settings */
  threadsStaffOnly?: boolean
  threadCloseDays?: number
  forum?: import('./threads').ForumSettings
  /** Your followed threads here that are still open (the sidebar list under the nebula) */
  threads?: import('./threads').ThreadSummary[]
}

/** 0.7.5 living sky: one star per nebula, in sidebar order (dashboard cards). */
export type NebulaStar = {
  kind: NebulaKind
  /** Unread messages you'd be told about */
  news: boolean
  /** Two or more people chatting in it right now */
  chatting: boolean
  /** People in it (voice nebulas) */
  voice: number
}

/** 0.7.5: who counts as "chatting now": this many people … */
export const CHATTING_PEOPLE = 2
/** … posting within this long */
export const CHATTING_WINDOW_MS = 3 * 60_000

export type NotifyLevel = 'all' | 'mentions' | 'none'

/**
 * Communities round 4.2 (approved board 23): your notification window for a constellation, on
 * top of "Notify me about" (`me.notify`) and each nebula's own choice.
 */
export type ConstellationNotifySettings = {
  /** Muted until then (ISO; 2100 = until you turn it on). No sounds, pop-ups or badges; @mentions of you still get through. */
  mutedUntil: string | null
  /** @everyone and @here show in the chat but don't notify you */
  ignoreEveryone: boolean
  /** @Raiders, @Police… don't notify you */
  ignoreRoles: boolean
  /** New replies in trails and signals you follow notify you (by your level) */
  followAlerts: boolean
}

export type ConstellationMember = {
  user: PublicUser
  /** Role ids (not the "member" role, which everyone has) */
  roleIds: string[]
  joinedAt: string
  /** Timed out until then (ISO), or null */
  timedOutUntil: string | null
  /** online / away / dnd / offline (invisible shows as offline) */
  status: 'online' | 'away' | 'dnd' | 'offline'
  /** "Playing …" or a custom status, for the member list */
  activity: string | null
  /** 0.7.5: the game they're playing and since when (ISO), for "Rocket League · 42 min" */
  playing?: { name: string; since: string } | null
  /** 0.7.5: when they were last here (offline members only, when they share it) */
  lastSeenAt?: string | null
}

/** Everything the app needs to show a constellation. */
export type ConstellationDetail = {
  id: string
  name: string
  description: string | null
  color: ConstellationColor
  iconVersion: string | null
  ownerId: string
  visibility: ConstellationVisibility
  type: ConstellationType | null
  tags: string[]
  createdAt: string
  categories: ConstellationCategory[]
  nebulas: Nebula[]
  roles: ConstellationRole[]
  members: ConstellationMember[]
  voice: VoiceNebulaState[]
  /** What you can do here */
  me: {
    owner: boolean
    permissions: ConstellationPermission[]
    /** Your highest role's position (Owner: Infinity is sent as 1e9) */
    rank: number
    timedOutUntil: string | null
    notify: NotifyLevel
    /** Communities round 4.2: the rest of the notification window (missing from older servers) */
    notifications?: ConstellationNotifySettings
    /** Communities round 4.3: my answers (when the constellation has onboarding) */
    onboarding?: MyOnboarding
    /** 0.9.3: pinned to my desktop sidebar */
    sidebarPinned?: boolean
    /** Communities round 2: why I can't chat yet (the verification level), null = I can */
    verification?: string | null
    /** Communities round 2: I joined during a raid; my messages wait for a moderator */
    raidHold?: boolean
  }
  /** Communities round 2: Night watch for moderators (null for everyone else) */
  watch?: { open: number; pausedUntil: string | null } | null
  /** Communities round 4.3: the questions (null/missing = none) */
  onboarding?: OnboardingSettings | null
  /** Communities round 4.3: optional nebulas I don't see yet (Browse nebulas) */
  browse?: BrowseNebula[]
  /** Open join requests (only for people who can approve them) */
  pendingRequests: number
  /** 0.7.5 identity: accent color and banner photo (missing from older servers) */
  accent?: ConstellationAccent | null
  bannerVersion?: string | null
  /** 0.7.5: the house rules (empty = none) */
  rules?: string[]
  /** 0.7.5: what new members see and what gets posted */
  welcome?: WelcomeSettings
  /** 0.7.5: you saw the welcome (null = show it now) and agreed to the rules */
  welcomedAt?: string | null
  /** 0.9.3: members may forward its messages to other chats (owners can turn it off) */
  forwarding?: boolean
  rulesAgreedAt?: string | null
  /**
   * 0.8.0: for each role you can pick yourself, the role-only nebulas picking it would show you
   * ("You'll see: #valorant"). Only roles that unlock something are listed.
   */
  unlocks?: Record<string, string[]>
}

/** 0.7.5: a constellation's welcome settings (Settings → Overview → Welcome). */
export type WelcomeSettings = {
  /** Show new members the welcome screen (about, rules, pick your roles) */
  screen: boolean
  /** Post "Priya joined. Say hi!" in the first text nebula */
  joinLines: boolean
  /** Post member milestones and the yearly birthday */
  milestones: boolean
  /** Invite links show a preview (name, picture, about, counts). Off: invite-only ones show nothing */
  preview: boolean
}
export const DEFAULT_WELCOME: WelcomeSettings = { screen: true, joinLines: true, milestones: true, preview: true }

export const RULES_MAX = 10
export const RULE_MAX = 200
/** Member counts that get a celebration (the yearly birthday too). */
export const MEMBER_MILESTONES: readonly number[] = [10, 50, 100, 250, 500, 1000]

/** The milestone just reached when the count went from `before` to `after` (null if none). */
export function milestoneReached(before: number, after: number): number | null {
  let hit: number | null = null
  for (const m of MEMBER_MILESTONES) if (before < m && after >= m) hit = m
  return hit
}

/**
 * 0.7.5 identity: a constellation's accent color. It tints that constellation only: the open
 * nebula, badges, Join buttons, the message box ring. Missing/null = the classic firefly gold.
 */
export type ConstellationAccent = 'gold' | 'ember' | 'lagoon' | 'violet' | 'mint' | 'rose'
export const CONSTELLATION_ACCENTS: readonly ConstellationAccent[] = ['gold', 'ember', 'lagoon', 'violet', 'mint', 'rose']
export const ACCENT_THEME: Record<
  ConstellationAccent,
  {
    name: string
    /** The accent itself (on the dark sidebar and as button fill) */
    color: string
    /** "r,g,b" for see-through tints */
    rgb: string
    /** Soft fill on white (the members button) */
    soft: string
    /** Text on `soft` */
    ink: string
    /** Text on `color` (buttons, badges) */
    on: string
    /** The closest older color, for apps before 0.7.5 */
    legacy: ConstellationColor
  }
> = {
  gold: { name: 'Firefly gold', color: '#ffb347', rgb: '255,179,71', soft: '#fde9d7', ink: '#8a3005', on: '#1c1210', legacy: 'ember' },
  ember: { name: 'Ember red', color: '#ff5a4e', rgb: '255,90,78', soft: '#fde0dd', ink: '#9c1f16', on: '#2a0906', legacy: 'red' },
  lagoon: { name: 'Lagoon', color: '#2fb7c9', rgb: '47,183,201', soft: '#d8f1f4', ink: '#0e626b', on: '#06262a', legacy: 'lagoon' },
  violet: { name: 'Violet', color: '#a98bff', rgb: '169,139,255', soft: '#ebe4ff', ink: '#4b32b0', on: '#160c33', legacy: 'violet' },
  mint: { name: 'Mint', color: '#5ad69a', rgb: '90,214,154', soft: '#daf5e8', ink: '#1d6b45', on: '#062616', legacy: 'green' },
  rose: { name: 'Rose', color: '#ff7fb6', rgb: '255,127,182', soft: '#ffe1ee', ink: '#9c2a64', on: '#2a0716', legacy: 'red' },
}
export const isConstellationAccent = (x: unknown): x is ConstellationAccent =>
  typeof x === 'string' && (CONSTELLATION_ACCENTS as readonly string[]).includes(x)
/** The accent to show (gold when none was picked). */
export const accentOf = (x: { accent?: ConstellationAccent | null }): (typeof ACCENT_THEME)[ConstellationAccent] =>
  ACCENT_THEME[x.accent && isConstellationAccent(x.accent) ? x.accent : 'gold']

/** 0.7.5: what an invite link shows (the card in chats, the join screen). */
export type InvitePreview = {
  constellation: DirectoryEntry
  /** Who made the link (null if they left Glofly) */
  by?: PublicUser | null
  /** When the link stops working (ISO), null = never */
  expiresAt?: string | null
}

/** 0.7.5: the member card's extras (GET /constellations/:id/members/:uid/card). */
export type MemberCardInfo = {
  /** Friends you both have (up to 3 shown), and how many in all */
  mutualFriends: PublicUser[]
  mutualCount: number
  /** You two are friends */
  friend: boolean
}

/** "Rocket League · 42 min", "Minecraft · 2 h" (since = when they started). */
export function playingFor(sinceIso: string, now = Date.now()): string {
  const min = Math.max(1, Math.floor((now - new Date(sinceIso).getTime()) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m && h < 10 ? `${h} h ${m} min` : `${h} h`
}

/** "RL" for Rocket League, "VAL" for Valorant-like single words, "MC" for Minecraft. */
export function gameInitials(name: string): string {
  const words = name.trim().split(/[\s:]+/).filter(Boolean)
  if (words.length >= 2) return words.slice(0, 3).map((w) => [...w][0]?.toUpperCase() ?? '').join('')
  const w = words[0] ?? '?'
  return w.slice(0, 3).toUpperCase()
}

export type JoinRequest = { user: PublicUser; note: string | null; createdAt: string }
export type ConstellationBan = { user: PublicUser; by: PublicUser | null; reason: string | null; createdAt: string }
export type ConstellationLink = {
  id: string
  code: string
  createdBy: PublicUser | null
  createdAt: string
  expiresAt: string | null
  maxUses: number | null
  uses: number
}
export type ModerationEntry = {
  id: string
  actor: PublicUser | null
  action: string
  target: PublicUser | null
  details: Record<string, unknown> | null
  createdAt: string
}

/** How long a new invite link works. */
export type LinkLifetime = '1d' | '7d' | '30d' | 'never'
export const LINK_LIFETIMES: readonly { id: LinkLifetime; name: string; ms: number | null }[] = [
  { id: '1d', name: '1 day', ms: 24 * 60 * 60_000 },
  { id: '7d', name: '7 days', ms: 7 * 24 * 60 * 60_000 },
  { id: '30d', name: '30 days', ms: 30 * 24 * 60 * 60_000 },
  { id: 'never', name: 'Never', ms: null },
]
export const DEFAULT_LINK_LIFETIME: LinkLifetime = '7d'

/** The link people share: glofly.app/c/<code>. */
export const constellationLink = (code: string): string => `glofly.app/c/${code}`

/** The code in something someone pasted: a full link, glofly.app/c/AbC123, or just AbC123. */
export function inviteCodeFrom(text: string): string | null {
  const t = text.trim()
  const m = t.match(/(?:^|\/)c\/([A-Za-z0-9]{6,16})(?:[/?#].*)?$/) ?? t.match(/^([A-Za-z0-9]{6,16})$/)
  return m ? m[1] : null
}

/** "Maya, Jacob and Sam in Campfire" */
export function voiceLine(people: PublicUser[], nebulaName: string, total = people.length): string {
  const names = people.map((p) => p.displayName.trim().split(/\s+/)[0] || p.username)
  const extra = total - names.length
  const who =
    extra > 0
      ? `${names.join(', ')} and ${extra} ${extra === 1 ? 'other' : 'others'}`
      : names.length <= 1
        ? (names[0] ?? '')
        : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${who} in ${nebulaName}`
}

/** A nebula's name as stored: text nebulas are lower-case-with-dashes, voice nebulas as typed. */
export function cleanNebulaName(raw: string, kind: NebulaKind): string | null {
  const hidden = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁩﻿]/g
  let t = raw.normalize('NFKC').replace(hidden, '').trim()
  if (kind !== 'voice') {
    t = t
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{L}\p{N}_-]/gu, '')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
  } else {
    t = t.replace(/\s+/g, ' ')
  }
  if (!t || [...t].length > NEBULA_NAME_MAX) return null
  return t
}

// ───────────── My games (2.0) ─────────────

/** Who can see someone's My games. */
export type MyGamesVisibility = 'everyone' | 'friends' | 'only_me'
export const MY_GAMES_VISIBILITY: readonly { id: MyGamesVisibility; name: string }[] = [
  { id: 'everyone', name: 'Everyone' },
  { id: 'friends', name: 'Friends' },
  { id: 'only_me', name: 'Only me' },
]

/** A game someone has played. */
export type MyGame = {
  /** The game's id in their list (its name, lower case) */
  key: string
  name: string
  /** Total playtime in seconds (counted a minute at a time) */
  seconds: number
  firstPlayedAt: string
  lastPlayedAt: string
  /** Starred: pinned at the top */
  favorite: boolean
  /** Hidden from everyone else (only in your own list) */
  hidden: boolean
  /** 0.9.1: box art's image id (IGDB), from GET /games/cover/:id; missing = letter tile */
  cover?: string
  /** 0.9.3: Steam counted (some or all) of this game's time (Steam linked, "Show in My games" on) */
  steam?: boolean
}

/** How games with slightly different names count as one: lower case, ™/® and extra spaces gone. */
export function gameKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[™®©]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

/** "312 hours", "45 minutes", "Under a minute" */
export function playtimeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return 'Under a minute'
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.round((seconds / 3600) * 10) / 10
  const shown = hours >= 10 ? Math.round(hours) : hours
  return `${shown} ${shown === 1 ? 'hour' : 'hours'}`
}

// ───────────── Live events (the apps' realtime forwarders pass on only these, checked) ─────────────

/** Free text from the server, cut to a length ('' if missing). */
const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.slice(0, max) : '')
const str = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64
const strList = (x: unknown): string[] => (Array.isArray(x) ? x.filter(str).slice(0, 300) : [])

/** The live events Constellations and My games add (the forwarder subscribes to these names). */
export const CONSTELLATION_EVENT_NAMES = [
  'constellations:changed',
  'constellation:updated',
  'constellation:activity',
  'constellation:voice',
  'constellation:removed',
  'constellation:invited',
  'games:changed',
  // 0.8.0 community tools: an event changed / is about to start / started, and the Inbox changed
  'constellation:event',
  'inbox:changed',
  // Communities round: threads + forum posts
  'thread:message',
  'thread:updated',
  'thread:deleted',
  // 0.9.3 Connections: Steam/Twitch/Kick linked or changed; a friend live on Twitch or Kick
  'connections:changed',
  'friend:live',
  // Communities round 2: Night watch
  'nightwatch:changed',
  'constellation:raid',
  'constellation:appeal',
  'emoji:changed',
] as const

/** A thread summary from the server, checked (null if it doesn't look right). */
function cleanThread(x: unknown): import('./threads').ThreadSummary | null {
  const t = (x ?? {}) as Record<string, unknown>
  if (!str(t.id) || !str(t.nebulaId) || typeof t.title !== 'string') return null
  const n = (v: unknown) => (typeof v === 'number' && v >= 0 ? Math.floor(v) : 0)
  return {
    id: t.id,
    nebulaId: t.nebulaId,
    parentMessageId: str(t.parentMessageId) ? t.parentMessageId : null,
    title: text(t.title, 120),
    tagIds: strList(t.tagIds).slice(0, 10),
    authorId: str(t.authorId) ? t.authorId : null,
    replyCount: n(t.replyCount),
    createdAt: text(t.createdAt, 40),
    lastMessageAt: text(t.lastMessageAt, 40),
    closed: t.closed === true,
    pinned: t.pinned === true,
    answerMessageId: str(t.answerMessageId) ? t.answerMessageId : null,
    preview: typeof t.preview === 'string' ? t.preview.slice(0, 200) : null,
    recentIds: strList(t.recentIds).slice(0, 3),
    following: false,
    unread: 0,
  }
}

/** One of those events, checked field by field (null if it doesn't look right). */
export function cleanConstellationEvent(name: string, payload: unknown): ServerEvent | null {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (name) {
    case 'constellations:changed':
      return { type: 'constellations:changed' }
    case 'games:changed':
      return { type: 'games:changed' }
    case 'connections:changed':
      return { type: 'connections:changed' }
    case 'friend:live': {
      const source: 'twitch' | 'kick' | null = p.source === 'twitch' || p.source === 'kick' ? p.source : null
      if (!str(p.userId) || !source) return null
      const l = (p.live ?? null) as Record<string, unknown> | null
      const url = l && typeof l.url === 'string' ? l.url : ''
      // Only the stream's own page on that site (never any other link).
      const okUrl = source === 'twitch' ? /^https:\/\/www\.twitch\.tv\/[a-z0-9_]{2,25}$/.test(url) : /^https:\/\/kick\.com\/[a-z0-9_-]{2,40}$/.test(url)
      const live =
        l && okUrl
          ? {
              userId: p.userId,
              source,
              title: text(l.title, 140),
              game: typeof l.game === 'string' ? text(l.game, 80) : null,
              url,
              startedAt: text(l.startedAt, 40),
            }
          : null
      return {
        type: 'friend:live',
        userId: p.userId,
        source,
        live,
        alert: p.alert === true && !!live,
        showLive: p.showLive !== false,
        headerVersion: typeof p.headerVersion === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.headerVersion) ? p.headerVersion : null,
      }
    }
    case 'constellation:updated':
      return str(p.constellationId) ? { type: 'constellation:updated', constellationId: p.constellationId } : null
    case 'constellation:removed': {
      if (!str(p.constellationId)) return null
      const reason = p.reason === 'kicked' || p.reason === 'banned' || p.reason === 'taken_down' ? p.reason : 'deleted'
      return {
        type: 'constellation:removed',
        constellationId: p.constellationId,
        reason,
        ...(reason === 'banned' && typeof p.banReason === 'string' ? { banReason: text(p.banReason, 200) } : {}),
      }
    }
    case 'emoji:changed':
      return str(p.constellationId) ? { type: 'emoji:changed', constellationId: p.constellationId } : null
    case 'nightwatch:changed':
      return str(p.constellationId) ? { type: 'nightwatch:changed', constellationId: p.constellationId } : null
    case 'constellation:raid':
      return str(p.constellationId) && typeof p.pausedUntil === 'string'
        ? {
            type: 'constellation:raid',
            constellationId: p.constellationId,
            pausedUntil: text(p.pausedUntil, 40),
            joins: typeof p.joins === 'number' ? p.joins : 0,
            newAccounts: typeof p.newAccounts === 'number' ? p.newAccounts : 0,
            seconds: typeof p.seconds === 'number' ? p.seconds : 60,
          }
        : null
    case 'constellation:appeal':
      return str(p.constellationId) && (p.decision === 'accept' || p.decision === 'deny')
        ? { type: 'constellation:appeal', constellationId: p.constellationId, decision: p.decision }
        : null
    case 'constellation:activity':
      return str(p.constellationId) && str(p.nebulaId) && str(p.conversationId) && str(p.senderId)
        ? {
            type: 'constellation:activity',
            constellationId: p.constellationId,
            nebulaId: p.nebulaId,
            conversationId: p.conversationId,
            senderId: p.senderId,
            mentions: strList(p.mentions),
            ...(p.alert === 'message' || p.alert === 'mention'
              ? {
                  alert: p.alert,
                  nebulaName: text(p.nebulaName, 100),
                  constellationName: text(p.constellationName, 100),
                  senderName: text(p.senderName, 100) || 'Someone',
                  preview: text(p.preview, 200),
                  senderAvatarVersion: str(p.senderAvatarVersion) ? text(p.senderAvatarVersion, 40) : null,
                }
              : { alert: null }),
          }
        : null
    case 'constellation:voice': {
      const v = (p.voice ?? {}) as Record<string, unknown>
      if (!str(p.constellationId) || !str(v.nebulaId)) return null
      return {
        type: 'constellation:voice',
        constellationId: p.constellationId,
        voice: {
          nebulaId: v.nebulaId,
          callId: str(v.callId) ? v.callId : null,
          userIds: strList(v.userIds),
          live: v.live === true,
          sharing: strList(v.sharing),
          muted: strList(v.muted),
        },
      }
    }
    case 'constellation:invited': {
      // 0.7.1: someone just invited you (the pop-up). Only the bits the pop-up shows.
      const inv = (p.invite ?? {}) as Record<string, unknown>
      const c = (inv.constellation ?? {}) as Record<string, unknown>
      const by = (inv.by ?? {}) as Record<string, unknown>
      if (!str(inv.id) || !str(c.id) || !str(by.id)) return null
      return {
        type: 'constellation:invited',
        invite: {
          id: inv.id,
          constellationId: c.id,
          name: text(c.name, 100) || 'A constellation',
          color: isConstellationColor(c.color) ? c.color : 'ember',
          iconVersion: str(c.iconVersion) ? c.iconVersion : null,
          memberCount: typeof c.memberCount === 'number' && c.memberCount >= 0 ? Math.floor(c.memberCount) : 0,
          by: {
            id: by.id,
            username: text(by.username, 40),
            displayName: text(by.displayName, 100) || 'Someone',
            avatarVersion: str(by.avatarVersion) ? by.avatarVersion : null,
          },
        },
      }
    }
    case 'constellation:event': {
      // 0.8.0: an event was made, changed or cancelled ("changed"), starts in 15 minutes
      // ("reminder", to people going or maybe) or just started ("started").
      if (!str(p.constellationId) || !str(p.eventId)) return null
      const phase = p.phase === 'reminder' || p.phase === 'started' ? p.phase : 'changed'
      return {
        type: 'constellation:event',
        constellationId: p.constellationId,
        eventId: p.eventId,
        phase,
        ...(phase === 'changed'
          ? {}
          : {
              title: text(p.title, 100) || 'An event',
              constellationName: text(p.constellationName, 100),
              voiceNebulaId: str(p.voiceNebulaId) ? p.voiceNebulaId : null,
              voiceName: text(p.voiceName, 100),
              nebulaId: str(p.nebulaId) ? p.nebulaId : null,
              conversationId: str(p.conversationId) ? p.conversationId : null,
              inVoice: typeof p.inVoice === 'number' && p.inVoice >= 0 ? Math.floor(p.inVoice) : 0,
            }),
      }
    }
    case 'inbox:changed':
      return { type: 'inbox:changed' }
    case 'thread:updated': {
      const thread = cleanThread(p.thread)
      return thread && str(p.constellationId) ? { type: 'thread:updated', constellationId: p.constellationId, thread } : null
    }
    case 'thread:message': {
      const thread = cleanThread(p.thread)
      const m = (p.message ?? {}) as Record<string, unknown>
      if (!thread || !str(p.constellationId) || !str(m.id) || !str(m.conversationId) || !str(m.senderId)) return null
      return { type: 'thread:message', constellationId: p.constellationId, thread, message: p.message as import('./types').Message }
    }
    case 'thread:deleted':
      return str(p.constellationId) && str(p.nebulaId) && str(p.threadId)
        ? { type: 'thread:deleted', constellationId: p.constellationId, nebulaId: p.nebulaId, threadId: p.threadId, parentMessageId: str(p.parentMessageId) ? p.parentMessageId : null }
        : null
    default:
      return null
  }
}

/** The pop-up for a new constellation invite (0.7.1). */
export type InvitePopup = {
  id: string
  constellationId: string
  name: string
  color: ConstellationColor
  iconVersion: string | null
  memberCount: number
  by: PublicUser
}

// ---- The nebula dock on Glofly home (2.0) ----

/** A nebula pinned to the dock on Glofly home ("Pin to Glofly dock"). */
export type PinnedNebula = {
  constellationId: string
  constellationName: string
  color: ConstellationColor
  iconVersion: string | null
  nebula: {
    id: string
    name: string
    kind: NebulaKind
    conversationId: string
    unreadCount: number
    mentionCount: number
  }
}

/** Someone @mentioned you in a nebula (the dock's Mentions, newest first). */
export type NebulaMention = {
  /** The message */
  id: string
  conversationId: string
  constellation: { id: string; name: string; color: ConstellationColor; iconVersion: string | null }
  nebula: { id: string; name: string }
  sender: PublicUser
  /** The message as one line of text */
  text: string
  createdAt: string
  /** Newer than when you last read that nebula */
  unread: boolean
}

/**
 * 0.7.1: a nebula with news for you (unread messages it would notify you about, or @mentions),
 * for the phone's Chats list: a tap flies straight into it.
 */
export type NebulaNews = {
  constellation: { id: string; name: string; color: ConstellationColor; iconVersion: string | null }
  nebula: { id: string; name: string; conversationId: string; unreadCount: number; mentionCount: number }
  /** The newest unread message as one line, and who sent it */
  last: { text: string; sender: PublicUser | null; at: string } | null
}

/** How many nebulas one person can pin to the home dock. */
export const PINNED_NEBULAS_MAX = 8

// ───────────── Nov 6, 2026: the dashboard card's star pattern ─────────────

/** One constellation's own little star pattern (coordinates 0–1), for its dashboard card. */
export type StarChart = {
  stars: { x: number; y: number; big: boolean; bright: boolean }[]
  /** Pairs of star indexes joined by a line */
  links: [number, number][]
}

/**
 * The same pattern every time for the same constellation, on every app (it comes from the id).
 * With the living sky (`sky`), there's a star per nebula (3–7 shown): a nebula with news glows,
 * one where people are chatting or in voice is a bigger star.
 */
export function starChartFor(id: string, sky?: NebulaStar[] | null): StarChart {
  let seed = 2166136261
  for (let i = 0; i < id.length; i++) seed = Math.imul(seed ^ id.charCodeAt(i), 16777619) >>> 0
  const rnd = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const count = sky && sky.length ? Math.min(7, Math.max(3, sky.length)) : 4 + Math.floor(rnd() * 3)
  const stars: StarChart['stars'] = []
  for (let i = 0; i < count; i++) {
    // Spread left to right so lines never cross back over each other; jitter keeps it hand-drawn.
    const x = 0.08 + (0.84 * (i + 0.5)) / count + (rnd() - 0.5) * (0.5 / count)
    const y = 0.15 + rnd() * 0.7
    const nebula = sky?.[i]
    stars.push({
      x: Math.round(x * 1000) / 1000,
      y: Math.round(y * 1000) / 1000,
      big: nebula ? nebula.chatting || nebula.voice > 0 : i === 0,
      bright: nebula ? nebula.news : false
    })
  }
  const links: [number, number][] = []
  // One unbroken line left to right: a branch back to the end crossed over the others.
  for (let i = 0; i < count - 1; i++) links.push([i, i + 1])
  return { stars, links }
}

// ───────────── Onboarding (Communities round 4.3, approved boards 25–28) ─────────────

/**
 * Questions new members answer right after the welcome screen. Each answer can give roles
 * members may pick themselves (labels, never permissions) and show optional nebulas (ones for
 * everyone that people only see once they pick them). Role-only nebulas a given role unlocks come
 * along by themselves.
 */
export type OnboardingAnswer = {
  id: string
  emoji: string
  label: string
  description: string
  roleIds: string[]
  nebulaIds: string[]
}
export type OnboardingQuestion = {
  id: string
  title: string
  /** "Pick any" (true) or "Pick one" */
  multi: boolean
  required: boolean
  answers: OnboardingAnswer[]
}
export type OnboardingSettings = {
  enabled: boolean
  questions: OnboardingQuestion[]
}
/** Your side of it (in ConstellationDetail.me) */
export type MyOnboarding = {
  /** questionId → the answer ids you picked */
  answers: Record<string, string[]>
  /** When you finished it (null = show the questions after the welcome screen) */
  onboardedAt: string | null
}
/** An optional nebula you don't see yet ("Browse nebulas") */
export type BrowseNebula = { id: string; name: string; kind: NebulaKind; topic: string | null }

export const ONBOARDING_QUESTIONS_MAX = 6
export const ONBOARDING_ANSWERS_MAX = 10
export const ONBOARDING_TITLE_MAX = 100
export const ONBOARDING_LABEL_MAX = 40
export const ONBOARDING_DESCRIPTION_MAX = 80
/** Roles one answer gives, and optional nebulas it shows */
export const ONBOARDING_ANSWER_ROLES_MAX = 5
export const ONBOARDING_ANSWER_NEBULAS_MAX = 10

/** "Pick any · 4 answers · required" */
export function onboardingQuestionLine(q: Pick<OnboardingQuestion, 'multi' | 'required' | 'answers'>): string {
  const n = q.answers.length
  return [q.multi ? 'Pick any' : 'Pick one', `${n} ${n === 1 ? 'answer' : 'answers'}`, ...(q.required ? ['required'] : [])].join(' · ')
}

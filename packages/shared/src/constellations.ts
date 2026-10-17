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
]
export const ALL_PERMISSIONS: readonly ConstellationPermission[] = PERMISSIONS.map((p) => p.id)
export const isPermission = (x: unknown): x is ConstellationPermission =>
  typeof x === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(x)

/** The roles every constellation starts with (besides the Owner). */
export const DEFAULT_ROLES: readonly { kind: 'admin' | 'moderator' | 'member'; name: string; color: RoleColor; permissions: ConstellationPermission[] }[] = [
  { kind: 'admin', name: 'Admin', color: 'lagoon', permissions: [...ALL_PERMISSIONS] },
  {
    kind: 'moderator',
    name: 'Moderator',
    color: 'violet',
    permissions: ['deleteMessages', 'timeoutKick', 'muteVoice', 'invite', 'approveRequests'],
  },
  { kind: 'member', name: 'Member', color: 'gray', permissions: ['invite'] },
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
export const CONSTELLATION_TEMPLATES: readonly {
  id: ConstellationTemplate
  name: string
  what: string
  categories: { name: string; nebulas: { name: string; kind: NebulaKind; topic?: string }[] }[]
}[] = [
  {
    id: 'friends',
    name: 'Friends hangout',
    what: 'general, clips · voice: Campfire',
    categories: [
      { name: 'Hangout', nebulas: [{ name: 'general', kind: 'text', topic: 'Say hi!' }, { name: 'clips', kind: 'text' }] },
      { name: 'Voice nebulas', nebulas: [{ name: 'Campfire', kind: 'voice' }] },
    ],
  },
  {
    id: 'gaming',
    name: 'Gaming squad',
    what: 'general, looking-for-group · 2 voice nebulas',
    categories: [
      {
        name: 'Hangout',
        nebulas: [
          { name: 'general', kind: 'text', topic: "Say hi, share what you're playing" },
          { name: 'looking-for-group', kind: 'text' },
        ],
      },
      { name: 'Voice nebulas', nebulas: [{ name: 'Campfire', kind: 'voice' }, { name: 'Squad Up', kind: 'voice' }] },
    ],
  },
  {
    id: 'study',
    name: 'Study group',
    what: 'resources, homework-help · voice: Study room',
    categories: [
      { name: 'Study', nebulas: [{ name: 'resources', kind: 'text' }, { name: 'homework-help', kind: 'text' }] },
      { name: 'Voice nebulas', nebulas: [{ name: 'Study room', kind: 'voice' }] },
    ],
  },
  {
    id: 'blank',
    name: 'Start empty',
    what: 'Just a general nebula',
    categories: [{ name: 'Text nebulas', nebulas: [{ name: 'general', kind: 'text' }] }],
  },
]

// ───────────── What the API sends ─────────────

export type NebulaKind = 'text' | 'voice'

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
  /** Where you dragged it on the dashboard and the icon strip (lower first; null = never moved) */
  position: number | null
}

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
}

export type ConstellationCategory = { id: string; name: string; position: number }

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
}

export type NotifyLevel = 'all' | 'mentions' | 'none'

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
  }
  /** Open join requests (only for people who can approve them) */
  pendingRequests: number
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
  if (kind === 'text') {
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
  'games:changed',
] as const

/** One of those events, checked field by field (null if it doesn't look right). */
export function cleanConstellationEvent(name: string, payload: unknown): ServerEvent | null {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (name) {
    case 'constellations:changed':
      return { type: 'constellations:changed' }
    case 'games:changed':
      return { type: 'games:changed' }
    case 'constellation:updated':
      return str(p.constellationId) ? { type: 'constellation:updated', constellationId: p.constellationId } : null
    case 'constellation:removed': {
      if (!str(p.constellationId)) return null
      const reason = p.reason === 'kicked' || p.reason === 'banned' || p.reason === 'taken_down' ? p.reason : 'deleted'
      return { type: 'constellation:removed', constellationId: p.constellationId, reason }
    }
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
    default:
      return null
  }
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

/** How many nebulas one person can pin to the home dock. */
export const PINNED_NEBULAS_MAX = 8

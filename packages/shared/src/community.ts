// Constellations community tools (0.8.0, approved Oct 20 boards 9, 13, 14, 15): search across a
// constellation, events with RSVP, AutoMod lite and the Inbox. The rules the server enforces and
// every app shows the same way.

import type { PublicUser } from './types'
import type { ConstellationColor, NebulaKind } from './constellations'

// ───────────── AutoMod lite ─────────────

/** Words or phrases a constellation blocks (each up to 40 characters, up to 100 of them). */
export const BLOCKED_WORD_MAX = 40
export const BLOCKED_WORDS_MAX = 100
/** Slow mode choices per nebula, in seconds (0 = off). */
export const SLOW_MODE_CHOICES: readonly { seconds: number; name: string }[] = [
  { seconds: 0, name: 'Off' },
  { seconds: 5, name: '5 s' },
  { seconds: 30, name: '30 s' },
  { seconds: 120, name: '2 min' },
]
export const isSlowModeChoice = (x: unknown): x is number =>
  typeof x === 'number' && SLOW_MODE_CHOICES.some((c) => c.seconds === x)
/** How long people who just joined wait before posting (minutes). */
export const NEW_MEMBER_WAIT_CHOICES: readonly number[] = [5, 10, 30, 60]
/** Link-spam guard: more than this many links in LINK_SPAM_SECONDS is held for a moderator… */
export const LINK_SPAM_LINKS = 3
export const LINK_SPAM_SECONDS = 10
/** …and so is the same link posted in this many different nebulas within LINK_REPEAT_MINUTES. */
export const LINK_REPEAT_NEBULAS = 3
export const LINK_REPEAT_MINUTES = 10

export type AutoModSettings = {
  /** Blocked words: messages with them are held (hidden) and moderators are told */
  wordsOn: boolean
  words: string[]
  linkGuardOn: boolean
  /** Slow mode on/off for the whole constellation; each nebula's seconds are in `slowMode` */
  slowModeOn: boolean
  /** nebulaId → seconds between messages (missing = off) */
  slowMode: Record<string, number>
  /** New members can post after this many minutes (0 = off) */
  newMemberWaitMinutes: number
}

export const DEFAULT_AUTOMOD: AutoModSettings = {
  wordsOn: false,
  words: [],
  linkGuardOn: false,
  slowModeOn: false,
  slowMode: {},
  newMemberWaitMinutes: 0,
}

/** What AutoMod did, as the moderation log names it. */
export type AutoModAction = 'automod_hidden' | 'automod_links' | 'automod_wait' | 'automod_mentions' | 'automod_raid'
export const AUTOMOD_ACTIONS: readonly AutoModAction[] = ['automod_hidden', 'automod_links', 'automod_wait', 'automod_mentions', 'automod_raid']

/** Look-alike characters people use to sneak words past a filter ("fr33 n1tro"). */
const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i',
  '€': 'e',
  '£': 'l',
}

/**
 * Text as the filter compares it: lower case, accents and look-alikes folded ("Fr€€ N1tr0" →
 * "free nitro"), anything else that isn't a letter or number becomes a space. `squashed` also
 * drops punctuation inside words ("fr.ee" → "free", "onlyf*ns" → "onlyfns").
 */
export function filterText(raw: string): { spaced: string; squashed: string } {
  const chars = [...raw.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()]
  // "!" and "|" only count as an i inside a word ("n!tro"), not as punctuation ("nitro!!").
  const folded = chars
    .map((ch, i) => ((ch === '!' || ch === '|') && !/[\p{L}\p{N}]/u.test(chars[i + 1] ?? '') ? ch : (LEET[ch] ?? ch)))
    .join('')
  const spaced = folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const squashed = folded
    .replace(/(?<=[\p{L}\p{N}])[^\p{L}\p{N}\s]+(?=[\p{L}\p{N}])/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return { spaced, squashed }
}

/** A blocked word as stored: trimmed, lower case, spaces squeezed; `*` stands for any letters. */
export function cleanBlockedWord(raw: string): string | null {
  const t = raw.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!t || t.length > BLOCKED_WORD_MAX) return null
  // Needs at least two real letters/numbers (so "*" alone can't block everything).
  if ((t.match(/[\p{L}\p{N}]/gu) ?? []).length < 2) return null
  return t
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The pattern for one blocked word: whole words only, `*` = any letters, look-alikes folded. */
function wordPattern(word: string): RegExp | null {
  const parts = word
    .split(' ')
    .map((w) =>
      w
        .split('*')
        .map((piece) => escapeRe(filterText(piece).squashed.replace(/ /g, '')))
        .join('[\\p{L}\\p{N}]*'),
    )
    .filter((p) => p.replace(/\[\\p\{L\}\\p\{N\}\]\*/g, '').length > 0)
  if (!parts.length) return null
  return new RegExp(`(?:^| )${parts.join(' ')}(?= |$)`, 'u')
}

/** The first blocked word found in a message, or null. Whole words only, any case, l33t too. */
export function blockedWordIn(text: string, words: readonly string[]): string | null {
  if (!words.length || !text.trim()) return null
  const { spaced, squashed } = filterText(text)
  for (const w of words) {
    const re = wordPattern(w)
    if (re && (re.test(spaced) || re.test(squashed))) return w
  }
  return null
}

/** Links in a message, normalized (scheme and "www." dropped, lower-case host, no trailing slash). */
export function linksIn(text: string): string[] {
  const found = text.match(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi) ?? []
  return found.map((l) =>
    l
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/[.,!?)\]]+$/, '')
      .replace(/\/$/, '')
      .replace(/^[^/]+/, (host) => host.toLowerCase()),
  )
}

/** "30 s", "2 min" */
export function slowModeLabel(seconds: number): string {
  return seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`
}

/** "Slow mode is on: you can post again in 12 seconds." */
export function slowModeWait(secondsLeft: number): string {
  const s = Math.max(1, Math.ceil(secondsLeft))
  return `Slow mode is on here: you can post again in ${s} ${s === 1 ? 'second' : 'seconds'}.`
}

/** "New members can post after 10 minutes. You can post in 6 minutes." */
export function newMemberWait(minutesLeft: number, waitMinutes: number): string {
  const m = Math.max(1, Math.ceil(minutesLeft))
  return `New members can post after ${waitMinutes} minutes. You can post in ${m} ${m === 1 ? 'minute' : 'minutes'}.`
}

// ───────────── Events with RSVP ─────────────

export const EVENT_TITLE_MAX = 80
export const EVENT_DESCRIPTION_MAX = 500
/** Going and Maybe get a reminder this long before it starts. */
export const EVENT_REMINDER_MINUTES = 15
/** An event without an end counts as happening for this long. */
export const EVENT_DEFAULT_HOURS = 3
/** Events can be planned up to a year ahead. */
export const EVENT_MAX_AHEAD_DAYS = 366

export type RsvpAnswer = 'going' | 'maybe' | 'no'
export const RSVP_ANSWERS: readonly { id: RsvpAnswer; name: string }[] = [
  { id: 'going', name: 'Going' },
  { id: 'maybe', name: 'Maybe' },
  { id: 'no', name: "Can't go" },
]
export const isRsvpAnswer = (x: unknown): x is RsvpAnswer => x === 'going' || x === 'maybe' || x === 'no'

export type ConstellationEvent = {
  id: string
  constellationId: string
  /** The text nebula its card was posted in, and that card message */
  nebulaId: string
  messageId: string | null
  /** The voice nebula it happens in (opens itself when it starts), or null */
  voiceNebulaId: string | null
  title: string
  description: string | null
  /** ISO, UTC */
  startsAt: string
  endsAt: string | null
  /** The time zone it was planned in (for "8:30 PM Eastern") */
  timeZone: string | null
  host: PublicUser | null
  createdAt: string
  cancelledAt: string | null
  /** When it actually started (the server marks it), or null */
  startedAt: string | null
  going: number
  maybe: number
  /** Up to 6 faces of people going (then maybe) */
  faces: PublicUser[]
  /** Your answer */
  mine: RsvpAnswer | null
  /** You can edit or cancel it (the host, or a moderator who outranks them) */
  canManage: boolean
}

export type EventPhase = 'upcoming' | 'soon' | 'live' | 'ended' | 'cancelled'

/** When an event ends (its end, or EVENT_DEFAULT_HOURS after it starts). */
export function eventEnd(e: Pick<ConstellationEvent, 'startsAt' | 'endsAt'>): number {
  return e.endsAt ? Date.parse(e.endsAt) : Date.parse(e.startsAt) + EVENT_DEFAULT_HOURS * 3_600_000
}

export function eventPhase(e: Pick<ConstellationEvent, 'startsAt' | 'endsAt' | 'cancelledAt'>, now = Date.now()): EventPhase {
  if (e.cancelledAt) return 'cancelled'
  const start = Date.parse(e.startsAt)
  if (now >= eventEnd(e)) return 'ended'
  if (now >= start) return 'live'
  if (start - now <= EVENT_REMINDER_MINUTES * 60_000) return 'soon'
  return 'upcoming'
}

/** "In 4 days", "Tomorrow", "In 3 hours", "Starts in 15 min", "Happening now", "Ended", "Cancelled" */
export function eventWhenLabel(e: Pick<ConstellationEvent, 'startsAt' | 'endsAt' | 'cancelledAt'>, now = Date.now()): string {
  const phase = eventPhase(e, now)
  if (phase === 'cancelled') return 'Cancelled'
  if (phase === 'ended') return 'Ended'
  if (phase === 'live') return 'Happening now'
  const ms = Date.parse(e.startsAt) - now
  const min = Math.max(1, Math.ceil(ms / 60_000))
  if (min < 60) return `Starts in ${min} min`
  const hours = Math.round(ms / 3_600_000)
  const start = new Date(e.startsAt)
  const today = new Date(now)
  const dayDiff = Math.round(
    (new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  )
  if (dayDiff <= 0) return `In ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  if (dayDiff === 1) return 'Tomorrow'
  return `In ${dayDiff} days`
}

/** The date tile: { weekday: 'FRI', day: '24', month: 'OCT' } in the viewer's time zone. */
export function eventDateTile(iso: string, timeZone?: string): { weekday: string; day: string; month: string } {
  const d = new Date(iso)
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-US', { ...o, timeZone }).toUpperCase()
  return { weekday: part({ weekday: 'short' }), day: String(Number(part({ day: 'numeric' }))), month: part({ month: 'short' }) }
}

/** "8:30 PM Eastern" (the viewer's own time, with the zone's short name). */
export function eventTimeLabel(iso: string, timeZone?: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone })
  return `${time} ${zoneName(d, timeZone)}`.trim()
}

/** "Eastern", "Central", "Pacific", "Mountain", else the short name ("GMT+1"). */
export function zoneName(d: Date, timeZone?: string): string {
  const long = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? ''
  const m = long.match(/^(Eastern|Central|Mountain|Pacific|Alaska|Hawaii)/)
  if (m) return m[1]
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? ''
}

/** The plain-text card older apps show: "📅 Game Night · Fri, Oct 24, 8:30 PM EDT · in Campfire". */
export function eventFallbackText(e: { title: string; startsAt: string; timeZone: string | null; voiceName: string | null }): string {
  const d = new Date(e.startsAt)
  const tz = e.timeZone ?? 'UTC'
  let when: string
  try {
    when = d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' })
  } catch {
    when = d.toUTCString()
  }
  return `📅 ${e.title} · ${when}${e.voiceName ? ` · in ${e.voiceName}` : ''}`
}

/** A calendar file (.ics) for "Add to calendar". */
export function eventIcs(e: Pick<ConstellationEvent, 'id' | 'title' | 'description' | 'startsAt' | 'endsAt'>, where: string): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Glofly//Events//EN',
    'BEGIN:VEVENT',
    `UID:${e.id}@glofly.app`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(Date.parse(e.startsAt))}`,
    `DTEND:${stamp(eventEnd(e))}`,
    `SUMMARY:${esc(e.title)}`,
    ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
    `LOCATION:${esc(where)}`,
    'BEGIN:VALARM',
    `TRIGGER:-PT${EVENT_REMINDER_MINUTES}M`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(e.title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n')
}

/** "11 going · 4 maybe" */
export function rsvpSummary(going: number, maybe: number): string {
  const parts = [`${going} going`]
  if (maybe) parts.push(`${maybe} maybe`)
  return parts.join(' · ')
}

// ───────────── Search across a constellation ─────────────

export type SearchHas = 'image' | 'link' | 'file'
export const SEARCH_HAS: readonly { id: SearchHas; name: string }[] = [
  { id: 'image', name: 'image' },
  { id: 'link', name: 'link' },
  { id: 'file', name: 'file' },
]
export const isSearchHas = (x: unknown): x is SearchHas => x === 'image' || x === 'link' || x === 'file'

/** Words to highlight in a result ("rocket league" → ["rocket", "league"]). */
export function searchWords(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2))].slice(0, 8)
}

/** A message split into plain and highlighted pieces for the words searched for. */
export function highlightPieces(text: string, words: readonly string[]): { text: string; hit: boolean }[] {
  if (!words.length) return [{ text, hit: false }]
  const re = new RegExp(`(${words.map(escapeRe).join('|')})`, 'gi')
  return text
    .split(re)
    .filter((p) => p.length)
    .map((p) => ({ text: p, hit: words.some((w) => w.toLowerCase() === p.toLowerCase()) }))
}

/** "Friday" → the start of the most recent Friday before today (for "before: Friday"). */
export function lastWeekday(weekday: number, now = new Date()): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  let back = (d.getDay() - weekday + 7) % 7
  if (back === 0) back = 7
  d.setDate(d.getDate() - back)
  return d
}

// ───────────── Inbox ─────────────

export type InboxTab = 'all' | 'mentions' | 'replies' | 'events' | 'requests'
export const INBOX_TABS: readonly { id: InboxTab; name: string }[] = [
  { id: 'all', name: 'All' },
  { id: 'mentions', name: 'Mentions' },
  { id: 'replies', name: 'Replies' },
  { id: 'events', name: 'Events' },
  { id: 'requests', name: 'Requests' },
]
export const isInboxTab = (x: unknown): x is InboxTab => INBOX_TABS.some((t) => t.id === x)

type InboxWhere = { id: string; name: string; color: ConstellationColor; iconVersion: string | null }

export type InboxItem = {
  /** Stable key ("m:<messageId>", "r:<messageId>", "e:<eventId>:<phase>", "j:<constellationId>:<userId>") */
  key: string
  kind: 'mention' | 'reply' | 'event' | 'request'
  createdAt: string
  unread: boolean
  constellation: InboxWhere
  /** Mentions and replies: where, who and what */
  nebula?: { id: string; name: string; conversationId: string; kind: NebulaKind }
  messageId?: string
  sender?: PublicUser
  text?: string
  /** Replies: what of yours they replied to */
  repliedTo?: string
  /** Events */
  event?: { id: string; title: string; startsAt: string; going: number; mine: RsvpAnswer | null; where: string; started: boolean }
  /** Join requests */
  request?: { user: PublicUser; note: string | null }
}

export type InboxPage = {
  items: InboxItem[]
  counts: Record<InboxTab, number>
  more: boolean
}

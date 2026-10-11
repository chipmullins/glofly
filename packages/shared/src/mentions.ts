// @mentions and muted chats.
//
// A group message mentions someone when it contains "@theirusername" and they're in the group
// (the server decides who, with the same pattern). Mentions of you
// are highlighted and always make a sound and a notification, even in a chat you muted.

import type {
  ConversationSummary,
  Message,
  MuteDuration,
  PublicUser
} from './types'

/** "@maya.p" anywhere a word could start (not inside an email address like a@b.com). */
export const MENTION_PATTERN = /(?<![\w@.])@([a-zA-Z0-9](?:[a-zA-Z0-9._]*[a-zA-Z0-9])?)/g

/** The usernames a text mentions (lower case, each once, at most 50). */
export function mentionedNames(body: string): string[] {
  const names = new Set<string>()
  for (const match of body.matchAll(MENTION_PATTERN)) names.add(match[1].toLowerCase())
  return [...names].slice(0, 50)
}

export type TextPiece = { text: string; user: PublicUser | null }

/** Splits message text so "@username" of someone in the chat can be shown as a mention. */
export function splitMentions(text: string, people: PublicUser[]): TextPiece[] {
  if (!text.includes('@') || people.length === 0) return [{ text, user: null }]
  const byName = new Map(people.map((p) => [p.username.toLowerCase(), p]))
  const pieces: TextPiece[] = []
  let last = 0
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const user = byName.get(match[1].toLowerCase())
    if (!user || match.index === undefined) continue
    if (match.index > last) pieces.push({ text: text.slice(last, match.index), user: null })
    pieces.push({ text: match[0], user })
    last = match.index + match[0].length
  }
  if (last < text.length) pieces.push({ text: text.slice(last), user: null })
  return pieces.length ? pieces : [{ text, user: null }]
}

/** Does this message @mention me? */
export const mentionsMe = (m: Pick<Message, 'mentions'>, meId: string): boolean =>
  !!m.mentions?.includes(meId)

/**
 * While typing: "@ma" right before the cursor (at the start or after a space) means you're
 * mentioning someone. Returns what's typed after the @ and where the @ is.
 */
export function mentionQuery(
  text: string,
  cursor: number
): { query: string; start: number } | null {
  const before = text.slice(0, cursor)
  const match = /(?:^|[\s(])@([a-zA-Z0-9._]{0,20})$/.exec(before)
  if (!match) return null
  return { query: match[1], start: cursor - match[1].length - 1 }
}

/** People to suggest for "@query": username or name starting with it, best first. */
export function mentionSuggestions(query: string, people: PublicUser[], limit = 6): PublicUser[] {
  const q = query.toLowerCase()
  const score = (p: PublicUser): number => {
    const user = p.username.toLowerCase()
    const name = p.displayName.toLowerCase()
    if (!q) return 3
    if (user.startsWith(q)) return 0
    if (name.startsWith(q)) return 1
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 2
    return -1
  }
  return people
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s || a.p.displayName.localeCompare(b.p.displayName))
    .slice(0, limit)
    .map((x) => x.p)
}

// ---------------------------------------------------------------------------------------
// Closing a chat in the sidebar

/**
 * True while you've closed this chat and nothing newer has arrived since. Closed chats keep
 * their history; they're just left out of the sidebar's Chats list.
 */
export function isClosed(c: Pick<ConversationSummary, 'closedAt' | 'lastMessage'>): boolean {
  if (!c.closedAt) return false
  const last = c.lastMessage?.createdAt
  return !last || new Date(last).getTime() <= new Date(c.closedAt).getTime()
}

// ---------------------------------------------------------------------------------------
// Muting

/** True while you've muted this chat. */
export const isMuted = (c: Pick<ConversationSummary, 'mutedUntil'>, now = Date.now()): boolean =>
  !!c.mutedUntil && new Date(c.mutedUntil).getTime() > now

/** "Until I turn it back on" is stored as a date this far ahead. */
const FOREVER_AFTER = new Date('2090-01-01T00:00:00Z').getTime()

/** "Muted until you unmute it", "Muted until 3:40 PM", "Muted until Mon 9:00 AM" */
export function mutedLabel(until: string): string {
  const t = new Date(until)
  if (t.getTime() > FOREVER_AFTER) return 'Muted until you unmute it'
  const sameDay = t.toDateString() === new Date().toDateString()
  const time = t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return sameDay
    ? `Muted until ${time}`
    : `Muted until ${t.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}

export const MUTE_CHOICES: { duration: MuteDuration; label: string }[] = [
  { duration: '1h', label: 'For 1 hour' },
  { duration: '8h', label: 'For 8 hours' },
  { duration: '24h', label: 'For 24 hours' },
  { duration: 'forever', label: 'Until I turn it back on' }
]

/** The mute's end, worked out here so the change shows right away (the server's comes after). */
export function muteUntil(duration: MuteDuration): string {
  const hours = { '1h': 1, '8h': 8, '24h': 24 } as const
  return duration === 'forever'
    ? '2100-01-01T00:00:00.000Z'
    : new Date(Date.now() + hours[duration] * 60 * 60 * 1000).toISOString()
}

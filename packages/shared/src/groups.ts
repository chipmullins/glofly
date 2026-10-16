// Group chat helpers: what to call a chat, and the lines shown when something happens in a
// group ("Chip added Maya and Jacob").

import type { ChatEvent, ConversationSummary, PublicUser } from './types'

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username

/** "Maya", "Maya and Jacob", "Maya, Jacob and Tyler", "Maya, Jacob and 3 others" */
export function listNames(names: string[], max = 3): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  const rest = names.length - (max - 1)
  return `${names.slice(0, max - 1).join(', ')} and ${rest} others`
}

/** What a chat is called: the person, the group's name, or the members' first names. */
export function chatTitle(c: ConversationSummary): string {
  if (c.kind === 'dm') return c.partner.displayName
  if (c.name) return c.name
  if (c.members.length === 0) return 'Just you'
  return listNames(c.members.map(firstName))
}

/** "3 members" */
export const memberCountLabel = (n: number): string => (n === 1 ? '1 member' : `${n} members`)

/**
 * The line for a group event. `actor` is who did it ("You" for you); `nameOf` names
 * anyone else mentioned.
 */
export function eventText(
  event: ChatEvent,
  actorId: string,
  meId: string,
  nameOf: (userId: string) => string
): string {
  const actor = actorId === meId ? 'You' : nameOf(actorId)
  const who = (id: string): string => (id === meId ? 'you' : nameOf(id))
  switch (event.type) {
    case 'created':
      return event.name
        ? `${actor} started the group “${event.name}”`
        : `${actor} started the group`
    case 'renamed':
      return event.name
        ? `${actor} named the group “${event.name}”`
        : `${actor} removed the group name`
    case 'added':
      return `${actor} added ${listNames(event.userIds.map(who), 4)}`
    case 'removed':
      return `${actor} removed ${who(event.userId)}`
    case 'left':
      return `${actor} left the group`
    case 'call':
      return callLine(event, actorId, meId, nameOf)
    case 'photo':
      return event.removed ? `${actor} removed the group photo` : `${actor} changed the group photo`
    case 'watch':
      return `${actor} started watching “${event.title}” together`
    default:
      // A line from a newer version of Glofly: nothing to show rather than breaking the chat.
      return ''
  }
}

/** "1 min", "12 min", "1 hr 5 min", "40 sec" */
export function roughDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)} sec`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/**
 * A call's line in the chat. It changes as the call goes:
 * "Chip started a video call" → "Video call · 12 min", or "You missed a video call from Chip".
 * Someone whose call wasn't picked up just sees it wasn't answered (declining isn't announced).
 */
export function callLine(
  event: Extract<ChatEvent, { type: 'call' }>,
  callerId: string,
  meId: string,
  nameOf: (userId: string) => string
): string {
  const kind = event.video ? 'video call' : 'voice call'
  const Kind = event.video ? 'Video call' : 'Voice call'
  const iCalled = callerId === meId
  const caller = iCalled ? 'You' : nameOf(callerId)
  switch (event.status) {
    case 'ringing':
    case 'ongoing':
      return `${caller} started a ${kind}`
    case 'ended':
      return event.durationSec !== null ? `${Kind} · ${roughDuration(event.durationSec)}` : Kind
    case 'missed':
      return iCalled ? `Your ${kind} wasn't answered` : `You missed a ${kind} from ${caller}`
    case 'declined':
      return iCalled ? `Your ${kind} wasn't answered` : `You declined a ${kind} from ${caller}`
  }
}

/** "Maya is typing…", "Maya and Jacob are typing…", "Several people are typing…" */
export function typingText(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length <= 3) return `${listNames(names)} are typing…`
  return 'Several people are typing…'
}

/**
 * The Groups page's order: groups you've never moved at the top (newest first), then the ones
 * you dragged into place, in your order.
 */
export function sortGroups<T extends ConversationSummary>(groups: T[]): T[] {
  return [...groups].sort((a, b) => {
    const pa = a.kind === 'group' ? (a.groupPosition ?? null) : null
    const pb = b.kind === 'group' ? (b.groupPosition ?? null) : null
    if (pa === null && pb === null) {
      return (b.joinedAt ?? b.activityAt).localeCompare(a.joinedAt ?? a.activityAt)
    }
    if (pa === null) return -1
    if (pb === null) return 1
    return pa - pb
  })
}

/** Groups page search: matches the group's name or anyone in it. */
export function groupMatches(c: ConversationSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (chatTitle(c).toLowerCase().includes(q)) return true
  return c.members.some(
    (m) => m.displayName.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
  )
}

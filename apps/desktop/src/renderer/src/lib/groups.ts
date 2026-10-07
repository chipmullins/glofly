// Group chat helpers: what to call a chat, and the lines shown when something happens in a
// group ("Chip added Maya and Jacob").

import type { ChatEvent, ConversationSummary, PublicUser } from '../../../preload/api-types'

export const GROUP_MAX = 25
export const GROUP_NAME_MAX = 50

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
  }
}

/** "Maya is typing…", "Maya and Jacob are typing…", "Several people are typing…" */
export function typingText(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length <= 3) return `${listNames(names)} are typing…`
  return 'Several people are typing…'
}

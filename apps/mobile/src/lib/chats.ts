import {
  attachmentSummary,
  chatTitle,
  eventText,
  isClosed,
  isMuted,
  shortBody,
  typingText,
  type Call,
  type ConversationSummary,
  type Message,
  type PublicUser,
} from '@glofly/shared'
import { firstName } from './format'

// What the chats list shows for each chat.

export type NameOf = (userId: string) => string

export function makeNameOf(people: Record<string, PublicUser>): NameOf {
  return (id) => {
    const p = people[id]
    return p ? firstName(p.displayName, p.username) : 'Someone'
  }
}

/** The one-line preview under a chat's name. */
export function previewOf(c: ConversationSummary, meId: string, nameOf: NameOf): { text: string; missed: boolean; photo: boolean } {
  const m = c.lastMessage
  if (!m) return { text: c.kind === 'group' ? `${c.memberCount} members` : 'Say hi!', missed: false, photo: false }
  return messagePreview(m, c, meId, nameOf)
}

export function messagePreview(m: Message, c: ConversationSummary, meId: string, nameOf: NameOf) {
  if (m.event) {
    const text = eventText(m.event, m.senderId, meId, nameOf)
    const missed = m.event.type === 'call' && m.event.status === 'missed' && m.senderId !== meId
    return { text, missed, photo: false }
  }
  if (m.deleted) return { text: 'Message deleted', missed: false, photo: false }
  const body = shortBody(m.body).replace(/\s+/g, ' ').trim()
  const text = body || attachmentSummary(m.attachments)
  const who = m.senderId === meId ? 'You: ' : c.kind === 'group' ? `${nameOf(m.senderId)}: ` : ''
  return { text: who + text, missed: false, photo: !body && m.attachments.some((a) => a.kind === 'image') }
}

/** "typing…" (DMs) or "Maya is typing…" (groups), or '' */
export function typingLine(c: ConversationSummary, typing: Record<string, number> | undefined, nameOf: NameOf, now = Date.now()): string {
  if (!typing) return ''
  const who = Object.entries(typing)
    .filter(([, until]) => until > now)
    .map(([id]) => id)
  if (!who.length) return ''
  return c.kind === 'dm' ? 'typing…' : typingText(who.map(nameOf))
}

/** "In call · 2 of 5" for a chat with a call going (and whether you're in it). */
export function callLine(call: Call | undefined, meId: string): { text: string; joined: boolean } | null {
  if (!call || (call.status !== 'ongoing' && call.status !== 'ringing')) return null
  const joined = call.members.filter((m) => m.state === 'joined').length
  const total = call.members.length
  const mine = call.members.find((m) => m.userId === meId)?.state === 'joined'
  return { text: total > 2 ? `In call · ${joined} of ${total}` : 'In call', joined: mine }
}

/**
 * The Chats list: pinned ones, then the rest (closed chats left out). Pinned chats go oldest pin
 * first, like the desktop app; dragging them to reorder re-times the pins (PUT /pins/order), so
 * the order you set shows the same on every app. (Before Oct 13 phones showed newest pin first.)
 */
export function chatSections(all: ConversationSummary[]) {
  const pinned = all
    .filter((c) => c.pinnedAt)
    .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? ''))
  const chats = all.filter((c) => !c.pinnedAt && !isClosed(c)).sort((a, b) => b.activityAt.localeCompare(a.activityAt))
  return { pinned, chats }
}

/** Unread count for the Chats tab badge (muted chats don't count, except mentions of you). */
export function unreadTotal(all: ConversationSummary[]): number {
  let n = 0
  for (const c of all) {
    if (isMuted(c)) n += c.mentionCount ?? 0
    else n += c.unreadCount
  }
  return n
}

export { chatTitle, isMuted }

/** New pinned times for this order (what the server does too), so the list moves right away. */
export function pinTimesFor(ids: string[], all: ConversationSummary[]): Record<string, string> {
  const times = ids.map((id) => all.find((c) => c.id === id)?.pinnedAt).filter((t): t is string => !!t)
  if (!times.length) return {}
  const base = Math.min(...times.map((t) => Date.parse(t)))
  return Object.fromEntries(ids.map((id, i) => [id, new Date(base + i).toISOString()]))
}

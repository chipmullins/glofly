import type {
  ConversationSummary,
  FriendEntry,
  GroupSummary,
  PublicUser
} from './types'
import { chatTitle } from './groups'

/** One result in the sidebar's "Find a friend or chat" search: a person, or a group chat. */
export type ChatResult =
  | {
      kind: 'person'
      user: PublicUser
      /** The chat with them, or null if you haven't messaged yet (opening one starts it). */
      conversation: ConversationSummary | null
      isFriend: boolean
    }
  | { kind: 'group'; conversation: GroupSummary }

/**
 * Friends and chats whose name or @username matches what's typed, best first:
 * names that start with it, then a word in the name, then anywhere. Groups match by their
 * name (or their members' names, if unnamed). Ties go to the most recent chat, then
 * alphabetical.
 */
export function findChats(
  query: string,
  conversations: ConversationSummary[],
  friends: FriendEntry[]
): ChatResult[] {
  const q = query.trim().toLowerCase().replace(/^@/, '')
  if (!q) return []

  const byUser = new Map<string, ChatResult & { kind: 'person' }>()
  const groups: (ChatResult & { kind: 'group' })[] = []
  for (const c of conversations) {
    if (c.kind === 'group') groups.push({ kind: 'group', conversation: c })
    else
      byUser.set(c.partner.id, {
        kind: 'person',
        user: c.partner,
        conversation: c,
        isFriend: false
      })
  }
  for (const f of friends) {
    const found = byUser.get(f.id)
    if (found) found.isFriend = true
    else byUser.set(f.id, { kind: 'person', user: f, conversation: null, isFriend: true })
  }

  const scoreText = (name: string, handle = ''): number | null => {
    name = name.toLowerCase()
    handle = handle.toLowerCase()
    if (name.startsWith(q) || (handle && handle.startsWith(q))) return 0
    if (name.split(/[\s,]+/).some((w) => w.startsWith(q))) return 1
    if (name.includes(q) || (handle && handle.includes(q))) return 2
    return null
  }
  const score = (r: ChatResult): number | null => {
    if (r.kind === 'person') return scoreText(r.user.displayName, r.user.username)
    const best = scoreText(chatTitle(r.conversation))
    // An unnamed group is also found by any member's name.
    if (best !== null || r.conversation.name) return best
    const byMember = r.conversation.members
      .map((m) => scoreText(m.displayName, m.username))
      .filter((s): s is number => s !== null)
    return byMember.length ? Math.min(...byMember) + 1 : null
  }
  const label = (r: ChatResult): string =>
    r.kind === 'person' ? r.user.displayName : chatTitle(r.conversation)

  return [...byUser.values(), ...groups]
    .map((r) => ({ r, s: score(r) }))
    .filter((x): x is { r: ChatResult; s: number } => x.s !== null)
    .sort(
      (a, b) =>
        a.s - b.s ||
        (b.r.conversation?.activityAt ?? '').localeCompare(a.r.conversation?.activityAt ?? '') ||
        label(a.r).localeCompare(label(b.r))
    )
    .map((x) => x.r)
    .slice(0, 20)
}

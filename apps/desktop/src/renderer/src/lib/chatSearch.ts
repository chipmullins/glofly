import type { ConversationSummary, FriendEntry, PublicUser } from '../../../preload/api-types'

/** One result in the sidebar's "Find a friend or chat" search. */
export type ChatResult = {
  user: PublicUser
  /** The chat with them, or null if you haven't messaged yet (opening one starts it). */
  conversation: ConversationSummary | null
  isFriend: boolean
}

/**
 * Friends and chats whose name or @username matches what's typed, best first:
 * names that start with it, then a word in the name, then anywhere. Ties go to the
 * most recent chat, then alphabetical.
 */
export function findChats(
  query: string,
  conversations: ConversationSummary[],
  friends: FriendEntry[]
): ChatResult[] {
  const q = query.trim().toLowerCase().replace(/^@/, '')
  if (!q) return []

  const byUser = new Map<string, ChatResult>()
  for (const c of conversations) {
    byUser.set(c.partner.id, { user: c.partner, conversation: c, isFriend: false })
  }
  for (const f of friends) {
    const found = byUser.get(f.id)
    if (found) found.isFriend = true
    else byUser.set(f.id, { user: f, conversation: null, isFriend: true })
  }

  const score = (u: PublicUser): number | null => {
    const name = u.displayName.toLowerCase()
    const handle = u.username.toLowerCase()
    if (name.startsWith(q) || handle.startsWith(q)) return 0
    if (name.split(/\s+/).some((w) => w.startsWith(q))) return 1
    if (name.includes(q) || handle.includes(q)) return 2
    return null
  }

  return [...byUser.values()]
    .map((r) => ({ r, s: score(r.user) }))
    .filter((x): x is { r: ChatResult; s: number } => x.s !== null)
    .sort(
      (a, b) =>
        a.s - b.s ||
        (b.r.conversation?.activityAt ?? '').localeCompare(a.r.conversation?.activityAt ?? '') ||
        a.r.user.displayName.localeCompare(b.r.user.displayName)
    )
    .map((x) => x.r)
    .slice(0, 20)
}

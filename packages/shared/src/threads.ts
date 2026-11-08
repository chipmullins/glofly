// Communities round (Nov 2026): threads off a message in a text nebula, and forum nebulas whose
// posts are threads with a title and tags (approved canvas boards 16–22).

export const THREAD_TITLE_MAX = 100
export const FORUM_TAGS_MAX = 20
export const FORUM_TAG_NAME_MAX = 24
export const POST_TAGS_MAX = 3
export const FORUM_GUIDELINES_MAX = 2000
export const THREAD_CLOSE_DAYS = [1, 3, 7, 30] as const

export type ForumTagColor = 'blue' | 'red' | 'green' | 'violet' | 'amber' | 'gray'
/** Light-theme chip colors (text, background); phones use the same pair. */
export const FORUM_TAG_COLORS: Record<ForumTagColor, { text: string; bg: string }> = {
  blue: { text: '#1e40af', bg: '#dbeafe' },
  red: { text: '#9f1239', bg: '#ffe4e6' },
  green: { text: '#166534', bg: '#dcfce7' },
  violet: { text: '#6b21a8', bg: '#f3e8ff' },
  amber: { text: '#92400e', bg: '#fef3c7' },
  gray: { text: '#44403c', bg: '#e7e5e4' }
}
export const isForumTagColor = (x: unknown): x is ForumTagColor => typeof x === 'string' && x in FORUM_TAG_COLORS

export type ForumTag = { id: string; name: string; color: ForumTagColor; staffOnly: boolean }

export type ForumSettings = {
  tags: ForumTag[]
  guidelines: string | null
  requireTag: boolean
  sort: 'activity' | 'newest'
}

export type ThreadSummary = {
  id: string
  nebulaId: string
  /** Text nebulas: the message it was started from (null for forum posts) */
  parentMessageId: string | null
  title: string
  tagIds: string[]
  authorId: string | null
  replyCount: number
  createdAt: string
  lastMessageAt: string
  /** Closed by hand or quiet for the nebula's close days (a reply reopens it) */
  closed: boolean
  pinned: boolean
  answerMessageId: string | null
  /** 0.9.1 forum posts: the opening message (it can't be marked as the answer) */
  firstMessageId?: string | null
  /** Forum posts: the opening message's text (the list's second line) */
  preview?: string | null
  /** The last few people who replied (newest first, up to 3) */
  recentIds: string[]
  /** You follow it; unread = replies since you last opened it (only when following) */
  following: boolean
  unread: number
}

/** "Saturday raid: who's in? We need…" → a thread name (first line, up to 60 characters). */
export function threadTitleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return 'Thread'
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line
}

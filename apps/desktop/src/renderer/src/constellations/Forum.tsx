import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConstellationDetail, Nebula, PublicUser } from '@glofly/shared'
import {
  FORUM_TAG_COLORS,
  FORUM_TAG_NAME_MAX,
  FORUM_TAGS_MAX,
  POST_TAGS_MAX,
  THREAD_TITLE_MAX,
  type ForumTag,
  type ForumTagColor,
  type ThreadSummary
} from '@glofly/shared/threads'
import ChatView, { threadAgo } from '../components/ChatView'
import Avatar from '../components/Avatar'
import EmojiText from '../components/EmojiText'
import { threads } from '../lib/threads'
import './Threads.css'

// Communities round (Nov 2026): forum nebulas (approved canvas boards 17–19). Every post is a
// thread with a title and 1–3 tags; the post itself is the chat screen in thread mode.

export function ForumIcon({
  size = 16,
  color = 'currentColor'
}: {
  size?: number
  color?: string
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
      <path d="M22 9v8a2 2 0 0 1-2 2h-1v3l-3-3" />
    </svg>
  )
}

export function TagChip({
  tag,
  on,
  onClick,
  locked
}: {
  tag: ForumTag
  on?: boolean
  onClick?: () => void
  locked?: boolean
}): React.JSX.Element {
  const look = FORUM_TAG_COLORS[tag.color]
  const style = on === false ? undefined : { color: look.text, background: look.bg }
  const content = (
    <>
      {locked && '🔒 '}
      {tag.name}
    </>
  )
  return onClick ? (
    <button
      type="button"
      className={on === false ? 'forum-tag forum-tag--off' : 'forum-tag'}
      style={style}
      aria-pressed={on}
      disabled={locked}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className="forum-tag" style={style}>
      {content}
    </span>
  )
}

const tagsOf = (n: Nebula): ForumTag[] => n.forum?.tags ?? []

// ───────────── The list (board 17) ─────────────

export function ForumView({
  c,
  nebula,
  people,
  onOpen,
  onNewPost,
  onProblem
}: {
  c: ConstellationDetail
  nebula: Nebula
  people: Map<string, PublicUser>
  onOpen: (t: ThreadSummary) => void
  onNewPost: () => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<'activity' | 'newest'>(nebula.forum?.sort ?? 'activity')
  const [list, setList] = useState<ThreadSummary[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const tags = tagsOf(nebula)
  const load = useCallback(
    (offset = 0) => {
      void threads
        .list(c.id, nebula.id, { q: q.trim() || undefined, tag: tag || undefined, sort, offset })
        .then((r) => {
          if (!r.ok) return onProblem(r.message)
          setList((old) => (offset ? [...(old ?? []), ...r.data.threads] : r.data.threads))
          setHasMore(r.data.hasMore)
        })
    },
    [c.id, nebula.id, q, tag, sort, onProblem]
  )
  useEffect(() => {
    const t = setTimeout(() => load(), q ? 250 : 0)
    return () => clearTimeout(t)
  }, [load, q])
  // New posts and replies show up as they happen (a moment's pause so a burst loads once).
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () =>
      window.glofly.onEvent((event) => {
        const nid =
          event.type === 'thread:deleted'
            ? event.nebulaId
            : event.type === 'thread:message' || event.type === 'thread:updated'
              ? event.thread.nebulaId
              : null
        if (nid !== nebula.id) return
        if (reloadTimer.current) clearTimeout(reloadTimer.current)
        reloadTimer.current = setTimeout(() => load(), 400)
      }),
    [load, nebula.id]
  )

  return (
    <main className="cx-main forum">
      <header className="chat-header cx-nebula-header forum-head">
        <ForumIcon size={20} color="#b4530e" />
        <div className="cx-nebula-name">
          <EmojiText text={nebula.name} />
        </div>
        {nebula.topic && (
          <div className="cx-nebula-topic">
            <EmojiText text={nebula.topic} />
          </div>
        )}
        <button
          type="button"
          className="forum-new"
          onClick={onNewPost}
          disabled={!!c.me.timedOutUntil}
        >
          + New signal
        </button>
      </header>
      <div className="forum-tools">
        <label className="forum-search">
          <span className="sr-only">Search signals</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            placeholder="Search signals"
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <button
          type="button"
          className={tag ? 'forum-filter' : 'forum-filter forum-filter--on'}
          aria-pressed={!tag}
          onClick={() => setTag('')}
        >
          All
        </button>
        {tags.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tag === t.id ? 'forum-filter forum-filter--on' : 'forum-filter'}
            aria-pressed={tag === t.id}
            onClick={() => setTag(tag === t.id ? '' : t.id)}
          >
            {t.name}
          </button>
        ))}
        <label className="forum-sort">
          Sort:
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value === 'newest' ? 'newest' : 'activity')}
          >
            <option value="activity">Latest activity</option>
            <option value="newest">Newest signals</option>
          </select>
        </label>
      </div>
      <div className="forum-list">
        {list === null && <p className="forum-empty">Loading signals…</p>}
        {list?.length === 0 && (
          <div className="forum-empty">
            <ForumIcon size={34} color="#e8a25e" />
            <b>{q || tag ? 'No signals match.' : 'No signals yet.'}</b>
            <span>
              {q || tag
                ? 'Try other words or another tag.'
                : 'Ask a question or share a guide: each signal gets its own conversation.'}
            </span>
          </div>
        )}
        {list?.map((t) => {
          const author = t.authorId ? people.get(t.authorId) : undefined
          return (
            <button
              key={t.id}
              type="button"
              className={t.unread > 0 ? 'forum-card forum-card--new' : 'forum-card'}
              onClick={() => onOpen(t)}
            >
              <span className="forum-card-tags">
                {t.tagIds
                  .map((id) => tags.find((x) => x.id === id))
                  .filter((x): x is ForumTag => !!x)
                  .map((x) => (
                    <TagChip key={x.id} tag={x} />
                  ))}
                {t.unread > 0 && <span className="forum-card-new">NEW REPLIES</span>}
                {t.closed && <span className="forum-card-closed">Closed</span>}
              </span>
              <b className="forum-card-title">
                {t.pinned && <span aria-label="Pinned">📌 </span>}
                <EmojiText text={t.title} />
              </b>
              {t.preview && (
                <span className="forum-card-preview">
                  <EmojiText text={t.preview} />
                </span>
              )}
              <span className="forum-card-meta">
                <Avatar
                  id={t.authorId ?? 'x'}
                  name={author?.displayName ?? '?'}
                  avatarVersion={author?.avatarVersion ?? null}
                  size={20}
                />
                <b>{author?.displayName ?? 'Someone'}</b>
                <span>
                  · 💬 {t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'} · last activity{' '}
                  {threadAgo(t.lastMessageAt)}
                </span>
              </span>
            </button>
          )
        })}
        {hasMore && (
          <button type="button" className="forum-more" onClick={() => load(list?.length ?? 0)}>
            Show more signals
          </button>
        )}
      </div>
    </main>
  )
}

// ───────────── One post (board 18) ─────────────

export function PostView({
  c,
  nebula,
  post,
  chatProps,
  meId,
  staff,
  onBack,
  onSummary,
  onProblem
}: {
  c: ConstellationDetail
  nebula: Nebula
  post: ThreadSummary
  chatProps: React.ComponentProps<typeof ChatView>
  meId: string
  staff: boolean
  onBack: () => void
  onSummary: (t: ThreadSummary) => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const tags = tagsOf(nebula)
  const mine = post.authorId === meId
  const solved = tags.find((t) => t.name.toLowerCase() === 'solved')
  const isSolved = !!solved && post.tagIds.includes(solved.id)
  const [menu, setMenu] = useState(false)
  const change = (p: ReturnType<typeof threads.change>): void => {
    void p.then((r) => (r.ok ? onSummary(r.data.thread) : onProblem(r.message)))
  }
  return (
    <main className="cx-main forum-post">
      <header className="forum-post-head">
        <button type="button" className="forum-back" onClick={onBack}>
          ← {nebula.name}
        </button>
        <span className="forum-card-tags">
          {post.tagIds
            .map((id) => tags.find((x) => x.id === id))
            .filter((x): x is ForumTag => !!x)
            .map((x) => (
              <TagChip key={x.id} tag={x} />
            ))}
        </span>
        <h2 className="forum-post-title">
          {post.pinned && <span aria-label="Pinned">📌 </span>}
          <EmojiText text={post.title} />
        </h2>
        <div className="forum-post-meta">
          <span>
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
            {post.following ? ' · Following' : ''}
            {post.closed ? ' · Closed (a reply reopens it)' : ''}
          </span>
          <span className="forum-post-actions">
            {solved && (mine || staff) && (
              <button
                type="button"
                className={isSolved ? 'forum-solved forum-solved--on' : 'forum-solved'}
                onClick={() =>
                  change(
                    threads.change(c.id, post.id, {
                      tagIds: isSolved
                        ? post.tagIds.filter((x) => x !== solved.id)
                        : [...post.tagIds, solved.id]
                    })
                  )
                }
              >
                ✓ {isSolved ? 'Solved' : 'Mark solved'}
              </button>
            )}
            <button
              type="button"
              className={post.following ? 'thread-follow thread-follow--on' : 'thread-follow'}
              onClick={() =>
                void threads
                  .follow(c.id, post.id, !post.following)
                  .then((r) => r.ok && onSummary(r.data.thread))
              }
            >
              {post.following ? 'Following' : 'Follow'}
            </button>
            <span className="thread-menu-wrap">
              <button
                type="button"
                className="thread-icon-button"
                aria-label="Signal options"
                aria-expanded={menu}
                onClick={() => setMenu((v) => !v)}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {menu && (
                <div role="menu" className="menu thread-menu" onMouseLeave={() => setMenu(false)}>
                  {staff && (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => (
                        setMenu(false),
                        change(threads.change(c.id, post.id, { pinned: !post.pinned }))
                      )}
                    >
                      {post.pinned ? 'Unpin signal' : 'Pin to the top'}
                    </button>
                  )}
                  {(mine || staff) && (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => (
                        setMenu(false),
                        change(threads.change(c.id, post.id, { closed: !post.closed }))
                      )}
                    >
                      {post.closed ? 'Reopen signal' : 'Close signal'}
                    </button>
                  )}
                  {(mine || staff) && (
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item menu-item--danger"
                      onClick={() => {
                        setMenu(false)
                        void threads
                          .remove(c.id, post.id)
                          .then((r) => (r.ok ? onBack() : onProblem(r.message)))
                      }}
                    >
                      Delete signal
                    </button>
                  )}
                  {!mine && !staff && (
                    <span className="menu-note">Only who sent it or staff can change it.</span>
                  )}
                </div>
              )}
            </span>
          </span>
        </div>
      </header>
      <ChatView
        {...chatProps}
        key={post.id}
        threadMode={{
          threadId: post.id,
          constellationId: c.id,
          parent: null,
          alsoInName: null,
          placeholder: 'Reply to this signal',
          answerMessageId: post.answerMessageId,
          onMarkAnswer:
            mine || staff
              ? (m) =>
                  change(
                    threads.change(c.id, post.id, {
                      answerMessageId: post.answerMessageId === m.id ? null : m.id
                    })
                  )
              : undefined,
          onSummary: (t) =>
            onSummary({
              ...t,
              following: post.following,
              answerMessageId:
                post.answerMessageId === t.answerMessageId
                  ? post.answerMessageId
                  : t.answerMessageId
            })
        }}
      />
    </main>
  )
}

// ───────────── New post (board 18) ─────────────

export function NewPostDialog({
  c,
  nebula,
  staff,
  onClose,
  onPosted
}: {
  c: ConstellationDetail
  nebula: Nebula
  staff: boolean
  onClose: () => void
  onPosted: (t: ThreadSummary) => void
}): React.JSX.Element {
  const tags = tagsOf(nebula)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const needTag = !!nebula.forum?.requireTag && tags.some((t) => !t.staffOnly || staff)
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  const post = async (): Promise<void> => {
    setBusy(true)
    setProblem(null)
    const made = await threads.start(c.id, nebula.id, { title, tagIds: picked })
    if (!made.ok) {
      setBusy(false)
      return setProblem(made.message)
    }
    const sent = await window.glofly.conversations.send(
      nebula.conversationId,
      body.trim(),
      undefined,
      undefined,
      { threadId: made.data.thread.id }
    )
    setBusy(false)
    if (!sent.ok) {
      void threads.remove(c.id, made.data.thread.id)
      return setProblem(sent.message)
    }
    onPosted({ ...made.data.thread, preview: body.trim().slice(0, 200) })
  }
  return (
    <div className="ix-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`New signal in #${nebula.name}`}
        className="ix-sheet forum-dialog"
      >
        <h2 className="ix-sheet-title">New signal in #{nebula.name}</h2>
        {nebula.forum?.guidelines && (
          <p className="forum-guidelines">
            <EmojiText text={nebula.forum.guidelines} />
          </p>
        )}
        <label className="ix-field">
          Title
          <input
            autoFocus
            value={title}
            maxLength={THREAD_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's it about?"
          />
        </label>
        {tags.length > 0 && (
          <fieldset className="forum-tag-pick">
            <legend>
              Tags{' '}
              <span>
                ({needTag ? 'pick at least one, ' : ''}up to {POST_TAGS_MAX})
              </span>
            </legend>
            <div>
              {tags.map((t) => {
                const on = picked.includes(t.id)
                return (
                  <TagChip
                    key={t.id}
                    tag={t}
                    on={on}
                    locked={t.staffOnly && !staff}
                    onClick={() =>
                      setPicked(
                        on
                          ? picked.filter((x) => x !== t.id)
                          : [...picked, t.id].slice(0, POST_TAGS_MAX)
                      )
                    }
                  />
                )
              })}
            </div>
          </fieldset>
        )}
        <label className="ix-field">
          Message
          <textarea
            className="as-textarea"
            rows={5}
            value={body}
            maxLength={4000}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <span className="ix-muted">Add photos or files in a reply once it's sent.</span>
        {problem && <p className="cx-error">{problem}</p>}
        <div className="ix-actions">
          <button type="button" className="ix-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ix-btn ix-btn--gold"
            disabled={busy || !title.trim() || !body.trim() || (needTag && !picked.length)}
            onClick={() => void post()}
          >
            Send signal
          </button>
        </div>
      </div>
    </div>
  )
}

// ───────────── Settings (board 19) ─────────────

export type ForumDraft = {
  guidelines: string
  requireTag: boolean
  sort: 'activity' | 'newest'
  tags: (Omit<ForumTag, 'id'> & { id?: string })[]
}

export const forumDraftOf = (n: Nebula): ForumDraft => ({
  guidelines: n.forum?.guidelines ?? '',
  requireTag: n.forum?.requireTag ?? false,
  sort: n.forum?.sort ?? 'activity',
  tags: (n.forum?.tags ?? []).map((t) => ({ ...t }))
})

/** Starting tags for a new forum (the owner changes them in Settings). */
export const STARTER_TAGS: ForumDraft['tags'] = [
  { name: 'Question', color: 'blue', staffOnly: false },
  { name: 'Guide', color: 'violet', staffOnly: false },
  { name: 'Solved', color: 'green', staffOnly: true }
]

const COLOR_CHOICES = Object.keys(FORUM_TAG_COLORS) as ForumTagColor[]

export function ForumSettingsFields({
  draft,
  onChange
}: {
  draft: ForumDraft
  onChange: (d: ForumDraft) => void
}): React.JSX.Element {
  const [newTag, setNewTag] = useState('')
  const setTag = (i: number, t: Partial<ForumDraft['tags'][number]>): void =>
    onChange({ ...draft, tags: draft.tags.map((x, j) => (j === i ? { ...x, ...t } : x)) })
  const names = useMemo(() => new Set(draft.tags.map((t) => t.name.toLowerCase())), [draft.tags])
  return (
    <div className="forum-settings">
      <label className="cx-field">
        <span>Signal guidelines (shown when someone writes a signal)</span>
        <textarea
          rows={3}
          value={draft.guidelines}
          maxLength={2000}
          onChange={(e) => onChange({ ...draft, guidelines: e.target.value })}
        />
      </label>
      <div className="forum-settings-tags">
        <strong>Tags</strong>
        {draft.tags.map((t, i) => (
          <div key={t.id ?? `new-${i}`} className="forum-settings-tag">
            <TagChip
              tag={{
                id: t.id ?? '',
                name: t.name || 'Tag',
                color: t.color,
                staffOnly: t.staffOnly
              }}
            />
            <input
              aria-label="Tag name"
              value={t.name}
              maxLength={FORUM_TAG_NAME_MAX}
              onChange={(e) => setTag(i, { name: e.target.value })}
            />
            <select
              aria-label="Color"
              value={t.color}
              onChange={(e) => setTag(i, { color: e.target.value as ForumTagColor })}
            >
              {COLOR_CHOICES.map((col) => (
                <option key={col} value={col}>
                  {col[0].toUpperCase() + col.slice(1)}
                </option>
              ))}
            </select>
            <label className="cx-check">
              <input
                type="checkbox"
                checked={t.staffOnly}
                onChange={(e) => setTag(i, { staffOnly: e.target.checked })}
              />
              Only staff can add it
            </label>
            <button
              type="button"
              className="cx-link-button"
              onClick={() => onChange({ ...draft, tags: draft.tags.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </div>
        ))}
        {draft.tags.length < FORUM_TAGS_MAX && (
          <form
            className="forum-settings-add"
            onSubmit={(e) => {
              e.preventDefault()
              const name = newTag.trim()
              if (!name || names.has(name.toLowerCase())) return
              onChange({
                ...draft,
                tags: [
                  ...draft.tags,
                  {
                    name,
                    color: COLOR_CHOICES[draft.tags.length % COLOR_CHOICES.length],
                    staffOnly: false
                  }
                ]
              })
              setNewTag('')
            }}
          >
            <input
              aria-label="New tag"
              placeholder="New tag"
              value={newTag}
              maxLength={FORUM_TAG_NAME_MAX}
              onChange={(e) => setNewTag(e.target.value)}
            />
            <button type="submit" className="cx-link-button">
              + Add a tag
            </button>
          </form>
        )}
      </div>
      <label className="cx-check">
        <input
          type="checkbox"
          checked={draft.requireTag}
          onChange={(e) => onChange({ ...draft, requireTag: e.target.checked })}
        />
        Signals need at least one tag
      </label>
      <label className="cx-field">
        <span>Default sort</span>
        <select
          value={draft.sort}
          onChange={(e) =>
            onChange({ ...draft, sort: e.target.value === 'newest' ? 'newest' : 'activity' })
          }
        >
          <option value="activity">Latest activity</option>
          <option value="newest">Newest signals</option>
        </select>
      </label>
    </div>
  )
}

export function CloseDaysField({
  value,
  onChange,
  what
}: {
  value: number
  onChange: (d: number) => void
  what: 'trails' | 'signals'
}): React.JSX.Element {
  return (
    <label className="cx-field">
      <span>Quiet {what} close after</span>
      <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {[1, 3, 7, 30].map((d) => (
          <option key={d} value={d}>
            {d === 1 ? '1 day' : `${d} days`} (a reply reopens)
          </option>
        ))}
      </select>
    </label>
  )
}

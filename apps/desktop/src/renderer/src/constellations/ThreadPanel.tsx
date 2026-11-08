import { useEffect, useRef, useState } from 'react'
import type { ConstellationDetail, Message, Nebula, PublicUser } from '@glofly/shared'
import type { ThreadSummary } from '@glofly/shared/threads'
import ChatView from '../components/ChatView'
import EmojiText from '../components/EmojiText'
import { threads } from '../lib/threads'
import './Threads.css'

// Communities round (Nov 2026): a thread on the right of its nebula (approved canvas board 16).
// The replies are the chat screen in thread mode; this adds the header (name, Following, the
// thread's menu) and the "Start a thread" naming step.

export function ThreadIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4v9a4 4 0 0 0 4 4h10" />
      <path d="m14 13 4 4-4 4" />
    </svg>
  )
}

export default function ThreadPanel({
  c,
  nebula,
  thread,
  parent,
  chatProps,
  meId,
  staff,
  people,
  onSummary,
  onClose,
  onProblem
}: {
  c: ConstellationDetail
  nebula: Nebula
  thread: ThreadSummary
  parent: Message | null
  chatProps: React.ComponentProps<typeof ChatView>
  meId: string
  staff: boolean
  people: Map<string, PublicUser>
  onSummary: (t: ThreadSummary) => void
  onClose: () => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const mine = thread.authorId === meId
  const by = thread.authorId ? (people.get(thread.authorId)?.displayName ?? 'someone') : 'someone'
  const change = async (
    p: Promise<{ ok: true; data: { thread: ThreadSummary } } | { ok: false; message: string }>
  ): Promise<void> => {
    const r = await p
    if (r.ok) onSummary({ ...r.data.thread })
    else onProblem(r.message)
  }
  // Escape closes the thread (when nothing inside it is open).
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        document.activeElement?.closest('.thread-panel')
      )
        closeRef.current()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  return (
    <aside className="thread-panel" aria-label={`Trail: ${thread.title}`}>
      <header className="thread-panel-head">
        <div className="thread-panel-row">
          <span className="thread-panel-icon">
            <ThreadIcon size={18} />
          </span>
          {renaming !== null ? (
            <form
              className="thread-rename"
              onSubmit={(e) => {
                e.preventDefault()
                if (renaming.trim())
                  void change(threads.change(c.id, thread.id, { title: renaming }))
                setRenaming(null)
              }}
            >
              <input
                autoFocus
                aria-label="Trail name"
                value={renaming}
                maxLength={100}
                onChange={(e) => setRenaming(e.target.value)}
                onBlur={() => setRenaming(null)}
              />
            </form>
          ) : (
            <h2 className="thread-panel-title">
              <EmojiText text={thread.title} />
            </h2>
          )}
          <button
            type="button"
            className={thread.following ? 'thread-follow thread-follow--on' : 'thread-follow'}
            aria-pressed={thread.following}
            onClick={() => void change(threads.follow(c.id, thread.id, !thread.following))}
          >
            {thread.following ? 'Following' : 'Follow'}
          </button>
          <span className="thread-menu-wrap">
            <button
              type="button"
              className="thread-icon-button"
              aria-label="Trail options"
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
                {(mine || staff) && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => (setMenu(false), setRenaming(thread.title))}
                  >
                    Rename trail
                  </button>
                )}
                {(mine || staff) && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu-item"
                    onClick={() => (
                      setMenu(false),
                      void change(threads.change(c.id, thread.id, { closed: !thread.closed }))
                    )}
                  >
                    {thread.closed ? 'Reopen trail' : 'Close trail'}
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
                        .remove(c.id, thread.id)
                        .then((r) => (r.ok ? onClose() : onProblem(r.message)))
                    }}
                  >
                    Delete trail
                  </button>
                )}
                {!mine && !staff && (
                  <span className="menu-note">Only who started it or staff can change it.</span>
                )}
              </div>
            )}
          </span>
          <button
            type="button"
            className="thread-icon-button"
            aria-label="Close trail"
            onClick={onClose}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <span className="thread-panel-sub">
          in #{nebula.name} · {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'} ·
          started by {thread.authorId === meId ? 'you' : by}
          {thread.closed ? ' · closed (a reply reopens it)' : ''}
        </span>
      </header>
      <div className="thread-panel-chat">
        <ChatView
          {...chatProps}
          key={thread.id}
          threadMode={{
            threadId: thread.id,
            constellationId: c.id,
            parent,
            alsoInName: nebula.name,
            placeholder: 'Reply in trail',
            // 0.9.1: only your own reply makes you follow; others' replies keep your choice.
            onSummary: (t, fromMe) => onSummary({ ...t, following: fromMe || thread.following, unread: 0 })
          }}
        />
      </div>
    </aside>
  )
}

/** The nebula header's "Threads · 3": its open threads, newest activity first. */
export function ThreadsButton({
  constellationId,
  nebulaId,
  onOpen
}: {
  constellationId: string
  nebulaId: string
  onOpen: (t: ThreadSummary) => void
}): React.JSX.Element {
  const [list, setList] = useState<ThreadSummary[] | null>(null)
  const [open, setOpen] = useState(false)
  const load = useRef(() => {})
  load.current = () =>
    void threads.list(constellationId, nebulaId).then((r) => {
      if (r.ok) setList(r.data.threads)
    })
  useEffect(() => {
    setList(null)
    load.current()
    return window.glofly.onEvent((event) => {
      const nid =
        event.type === 'thread:deleted'
          ? event.nebulaId
          : event.type === 'thread:updated' || event.type === 'thread:message'
            ? event.thread.nebulaId
            : null
      if (nid === nebulaId) load.current()
    })
  }, [constellationId, nebulaId])
  return (
    <span className="thread-menu-wrap">
      <button
        type="button"
        className="threads-button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Trails in this nebula"
      >
        <ThreadIcon size={16} />
        Trails{list && list.length > 0 ? ` · ${list.length}${list.length >= 30 ? '+' : ''}` : ''}
      </button>
      {open && (
        <div role="menu" className="menu threads-list" onMouseLeave={() => setOpen(false)}>
          {list?.length ? (
            list.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="menu-item threads-list-item"
                onClick={() => {
                  setOpen(false)
                  onOpen(t)
                }}
              >
                <ThreadIcon size={14} />
                <span className="threads-list-text">
                  <b>
                    <EmojiText text={t.title} />
                  </b>
                  <span>
                    {t.replyCount} {t.replyCount === 1 ? 'reply' : 'replies'}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <span className="menu-note">
              No open trails. Hover a message and press Start a trail.
            </span>
          )}
        </div>
      )}
    </span>
  )
}

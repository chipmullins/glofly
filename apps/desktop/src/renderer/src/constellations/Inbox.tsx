import { useCallback, useEffect, useRef, useState } from 'react'
import { INBOX_TABS, type InboxItem, type InboxPage, type InboxTab } from '@glofly/shared'
import Avatar from '../components/Avatar'
import { community, useInboxCounts } from '../lib/community'
import './Community.css'

// The Inbox (0.8.0, approved Oct 20 board 15): @mentions, replies to you, events you're going to
// and join requests you can let in, across every constellation. It sits above your
// constellations on the night side and replaces Mentions in the Glofly home dock.

export function InboxIcon({ size = 22 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z" />
    </svg>
  )
}

const timeOf = (iso: string): string => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const days = (today.getTime() - d.getTime()) / 86_400_000
  return days < 6
    ? d.toLocaleDateString(undefined, { weekday: 'short' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const first = (name: string): string => name.trim().split(/\s+/)[0] || name

function eventHeadline(i: InboxItem): React.ReactNode {
  const e = i.event!
  const start = new Date(e.startsAt)
  if (i.key.endsWith(':live')) return <><b>{e.title}</b> is happening now</>
  if (i.key.endsWith(':soon')) return <><b>{e.title}</b> starts soon</>
  const days = Math.round((start.getTime() - Date.now()) / 86_400_000)
  return (
    <>
      <b>{e.title}</b> is {days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `on ${start.toLocaleDateString(undefined, { weekday: 'long' })}`}
    </>
  )
}

function eventLine(i: InboxItem): string {
  const e = i.event!
  const when = new Date(e.startsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  const said = e.mine === 'going' ? ' You said Going.' : e.mine === 'maybe' ? ' You said Maybe.' : ''
  const remind = e.mine && !e.started ? ' Reminder 15 min before.' : ''
  return `${when} · ${e.going} going.${said}${remind}`
}

export function InboxPanel({
  className,
  style,
  onOpenMessage,
  onOpenEvent,
  onClose,
  onCounts
}: {
  className?: string
  style?: React.CSSProperties
  /** Open the nebula at this message */
  onOpenMessage: (item: InboxItem) => void
  onOpenEvent: (item: InboxItem) => void
  onClose: () => void
  onCounts?: (counts: InboxPage['counts']) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<InboxTab>('all')
  const [page, setPage] = useState<InboxPage | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const ref = useRef<HTMLElement>(null)
  const load = useCallback(
    (t: InboxTab) => {
      void community.inbox(t).then((r) => {
        if (r.ok) {
          setPage(r.data)
          onCounts?.(r.data.counts)
          setProblem(null)
        } else setProblem(r.message)
      })
    },
    [onCounts]
  )
  useEffect(() => load(tab), [tab, load])
  useEffect(
    () =>
      window.glofly.onEvent((event) => {
        if (event.type === 'inbox:changed' || event.type === 'constellation:event') load(tab)
      }),
    [tab, load]
  )
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const markRead = async (i: InboxItem): Promise<void> => {
    setPage((p) => (p ? { ...p, items: p.items.map((x) => (x.key === i.key ? { ...x, unread: false } : x)) } : p))
    await community.inboxRead([i.key])
    load(tab)
  }
  const answer = async (i: InboxItem, decision: 'approve' | 'deny'): Promise<void> => {
    if (!i.request) return
    setBusy(i.key)
    const r = await community.answerRequest(i.constellation.id, i.request.user.id, decision)
    setBusy(null)
    if (!r.ok) setProblem(r.message)
    load(tab)
  }
  const more = async (): Promise<void> => {
    const last = page?.items.at(-1)
    if (!last) return
    const r = await community.inbox(tab, last.createdAt)
    if (r.ok) setPage((p) => (p ? { ...r.data, items: [...p.items, ...r.data.items] } : r.data))
  }
  const counts = page?.counts

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className={`inbox${className ? ` ${className}` : ''}`}
      style={style}
      role="dialog"
      aria-label="Inbox"
    >
      <header className="inbox-head">
        <span className="inbox-title">
          <InboxIcon size={22} />
          Inbox
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="inbox-readall"
          disabled={!counts?.all}
          onClick={async () => {
            await community.inboxReadAll()
            load(tab)
          }}
        >
          Mark all read
        </button>
      </header>
      <div className="inbox-tabs" role="tablist" aria-label="Show">
        {INBOX_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'inbox-tab inbox-tab--on' : 'inbox-tab'}
            onClick={() => setTab(t.id)}
          >
            {t.name}
            {counts && counts[t.id] > 0 && <span className="inbox-tab-count">{counts[t.id] > 99 ? '99+' : counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className="inbox-list" role="tabpanel">
        {problem && <p className="inbox-empty">{problem}</p>}
        {page === null && !problem && <p className="inbox-empty">Loading…</p>}
        {page && page.items.length === 0 && (
          <p className="inbox-empty">
            {tab === 'all' ? "Nothing here yet. Mentions, replies, events and join requests land here." : `No ${INBOX_TABS.find((t) => t.id === tab)!.name.toLowerCase()} right now.`}
          </p>
        )}
        {page?.items.map((i) => (
          <article key={i.key} className={i.unread ? 'inbox-item inbox-item--unread' : 'inbox-item'}>
            <span className="inbox-face">
              {i.kind === 'event' ? (
                <span className="inbox-event-face" aria-hidden="true">
                  📅
                </span>
              ) : (
                (() => {
                  const u = i.kind === 'request' ? i.request!.user : i.sender!
                  return <Avatar id={u.id} name={u.displayName} avatarVersion={u.avatarVersion} size={42} />
                })()
              )}
              <span className={`inbox-badge inbox-badge--${i.kind}`} aria-hidden="true">
                {i.kind === 'mention' ? '@' : i.kind === 'reply' ? '↩' : i.kind === 'event' ? '★' : '+'}
              </span>
            </span>
            <div className="inbox-main">
              <div className="inbox-line1">
                <span className="inbox-what">
                  {i.kind === 'mention' && (
                    <>
                      <b>{first(i.sender!.displayName)}</b> mentioned you
                    </>
                  )}
                  {i.kind === 'reply' && (
                    <>
                      <b>{first(i.sender!.displayName)}</b> replied to you
                    </>
                  )}
                  {i.kind === 'event' && eventHeadline(i)}
                  {i.kind === 'request' && (
                    <>
                      <b>{first(i.request!.user.displayName)}</b> wants to join
                    </>
                  )}
                </span>
                <time dateTime={i.createdAt}>{timeOf(i.createdAt)}</time>
                {i.unread && <span className="inbox-dot" aria-label="New" />}
              </div>
              <div className="inbox-where">
                {i.constellation.name}
                {i.kind === 'request'
                  ? ' · approval needed'
                  : i.kind === 'event'
                    ? i.event!.where
                      ? ` · ${i.event!.where}`
                      : ''
                    : i.nebula
                      ? ` · #${i.nebula.name}`
                      : ''}
              </div>
              <div className="inbox-text">
                {i.kind === 'reply' && i.repliedTo ? (
                  <>
                    ↪ “{i.repliedTo}” — {i.text}
                  </>
                ) : i.kind === 'event' ? (
                  eventLine(i)
                ) : i.kind === 'request' ? (
                  i.request!.note ? `“${i.request!.note}”` : 'No note.'
                ) : (
                  i.text
                )}
              </div>
              <div className="inbox-actions">
                {i.kind === 'request' ? (
                  <>
                    <button type="button" className="inbox-btn inbox-btn--main" disabled={busy === i.key} onClick={() => void answer(i, 'approve')}>
                      Let in
                    </button>
                    <button type="button" className="inbox-btn" disabled={busy === i.key} onClick={() => void answer(i, 'deny')}>
                      Decline
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="inbox-btn"
                      onClick={() => {
                        if (i.unread) void community.inboxRead([i.key])
                        if (i.kind === 'event') onOpenEvent(i)
                        else onOpenMessage(i)
                      }}
                    >
                      {i.kind === 'event' ? 'Open event' : 'Jump to message'}
                    </button>
                    {i.unread && (
                      <button type="button" className="inbox-btn inbox-btn--quiet" onClick={() => void markRead(i)}>
                        Mark read
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </article>
        ))}
        {page?.more && (
          <button type="button" className="inbox-btn inbox-more" onClick={() => void more()}>
            Show older
          </button>
        )}
      </div>
    </section>
  )
}

/** The Inbox button above your constellations (the night side's strip), with its unread count. */
export function InboxStripButton({
  onOpen
}: {
  /** Open a nebula (and show this message in it, if given) */
  onOpen: (constellationId: string, nebulaId: string, messageId: string | null) => void
}): React.JSX.Element {
  const { counts, reload } = useInboxCounts(true)
  const [open, setOpen] = useState(false)
  const n = counts?.all ?? 0
  return (
    <>
      <button
        type="button"
        className={open ? 'cx-strip-galaxy inbox-strip-btn inbox-strip-btn--open' : 'cx-strip-galaxy inbox-strip-btn'}
        aria-label={`Inbox${n ? `, ${n} new` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Inbox"
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ color: '#d9c2b1', display: 'flex' }}>
          <InboxIcon size={23} />
        </span>
        {n > 0 && <span className="inbox-strip-count">{n > 99 ? '99+' : n}</span>}
      </button>
      {open && (
        <>
          <div className="inbox-scrim" aria-hidden="true" onMouseDown={() => setOpen(false)} />
          <InboxPanel
            className="inbox--strip"
            onClose={() => {
              setOpen(false)
              reload()
            }}
            onOpenMessage={(i) => {
              setOpen(false)
              reload()
              if (i.nebula) onOpen(i.constellation.id, i.nebula.id, i.messageId ?? null)
            }}
            onOpenEvent={(i) => {
              setOpen(false)
              reload()
              if (i.nebula) onOpen(i.constellation.id, i.nebula.id, i.messageId ?? null)
            }}
          />
        </>
      )}
    </>
  )
}

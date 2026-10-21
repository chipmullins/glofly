import { useCallback, useEffect, useId, useRef, useState, type JSX } from 'react'
import { api, type InboxItem, type InboxPerson, type InboxThread } from '../lib/api'
import { Avatar, NoteField } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ago, when } from '../lib/format'

// 0.9.0: the Inbox. Messages you sent as the Glofly Team and the replies people wrote back. In
// Glofly they see "Glofly Team · Official", with a reply box when you allowed replies.

const TEAM_MESSAGE_MAX = 1000

export function Inbox({
  toast,
  onOpenAccount,
  onUnreadChange,
  initialUser
}: {
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
  /** Keeps the sidebar's badge in step */
  onUnreadChange: (unread: number) => void
  initialUser?: string | null
}): JSX.Element {
  const [threads, setThreads] = useState<InboxThread[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(initialUser ?? null)
  const [version, setVersion] = useState(0)

  const load = useCallback(
    () =>
      api.inbox().then((r) => {
        if (!r.ok) {
          setError(r.message)
          return
        }
        setError(null)
        setThreads(r.data.threads)
        onUnreadChange(r.data.unreadTotal)
        setSelected((s) => s ?? r.data.threads[0]?.user.id ?? null)
      }),
    [onUnreadChange]
  )

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => clearInterval(timer)
  }, [load, version])

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Inbox</h1>
          <p className="sub">
            Messages you sent as the Glofly Team, and the replies people wrote back.
          </p>
        </div>
        <button type="button" className="btn" onClick={() => setVersion((n) => n + 1)}>
          <Icon d={ICONS.refresh} size={16} strokeWidth={2} />
          Refresh
        </button>
      </header>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div className="accounts-layout">
        <section aria-label="Conversations" className="card accounts-list inbox-list">
          {!threads && !error && (
            <p className="loading" style={{ padding: '18px' }}>
              Loading…
            </p>
          )}
          {threads?.length === 0 && (
            <div className="empty inbox-empty">
              <strong>No messages yet.</strong>
              <span>
                Open an account and pick <em>Message as Glofly team</em>. Replies show up here.
              </span>
            </div>
          )}
          {threads?.map((t) => (
            <button
              key={t.user.id}
              type="button"
              className="account-row inbox-row"
              aria-current={selected === t.user.id ? 'true' : undefined}
              onClick={() => setSelected(t.user.id)}
            >
              <Avatar id={t.user.id} name={t.user.displayName} />
              <span className="text">
                <span className="name">
                  {t.user.displayName} <span className="inbox-handle">@{t.user.username}</span>
                </span>
                <span className={`handle inbox-preview${t.unread ? ' inbox-preview--unread' : ''}`}>
                  {t.lastFromTeam ? 'You: ' : ''}
                  {t.preview}
                </span>
              </span>
              <span className="inbox-side">
                <span className="seen">{ago(t.lastAt)}</span>
                {t.unread > 0 && (
                  <span className="inbox-unread" aria-label={`${t.unread} unread`}>
                    {t.unread}
                  </span>
                )}
              </span>
            </button>
          ))}
        </section>

        {selected ? (
          <Conversation
            key={selected}
            userId={selected}
            toast={toast}
            onOpenAccount={onOpenAccount}
            onChanged={() => void load()}
          />
        ) : (
          threads &&
          threads.length > 0 && (
            <aside className="card detail" aria-label="Conversation">
              <p className="empty">Pick a conversation to read it.</p>
            </aside>
          )
        )}
      </div>
    </>
  )
}

function Conversation({
  userId,
  toast,
  onOpenAccount,
  onChanged
}: {
  userId: string
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
  onChanged: () => void
}): JSX.Element {
  const [user, setUser] = useState<InboxPerson | null>(null)
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  const bottom = useRef<HTMLDivElement>(null)
  const changed = useRef(onChanged)
  useEffect(() => {
    changed.current = onChanged
  })

  useEffect(() => {
    let live = true
    void api.inboxThread(userId).then((r) => {
      if (!live) return
      if (r.ok) {
        setUser(r.data.user)
        setItems(r.data.items)
        setError(null)
        // Opening it marked the replies read: the list and the badge catch up.
        if (r.data.items.some((i) => i.from === 'user' && i.unread)) changed.current()
      } else setError(r.message)
    })
    return () => {
      live = false
    }
  }, [userId, n])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [items])

  if (error)
    return (
      <aside className="card detail" aria-label="Conversation">
        <div className="error-box" role="alert">
          {error}
        </div>
      </aside>
    )
  if (!user || !items)
    return (
      <aside className="card detail" aria-label="Conversation">
        <p className="loading">Loading…</p>
      </aside>
    )

  const lastTeam = [...items].reverse().find((i) => i.from === 'team')
  return (
    <aside
      className="card detail inbox-thread"
      aria-label={`Conversation with ${user.displayName}`}
    >
      <div className="detail-head">
        <Avatar id={user.id} name={user.displayName} big />
        <div className="who">
          <span className="name">{user.displayName}</span>
          <span className="handle">
            @{user.username} ·{' '}
            <button type="button" className="link-btn" onClick={() => onOpenAccount(user.id)}>
              Open account
            </button>
          </span>
        </div>
      </div>

      <ol className="bubbles" aria-label="Messages">
        {items.length === 0 && <li className="empty">Nothing here yet. Say hi below.</li>}
        {items.map((m) => (
          <li key={m.id} className={`bubble-row bubble-row--${m.from}`}>
            <div className={`bubble bubble--${m.from}`}>{m.body}</div>
            <span className="bubble-meta">
              {m.from === 'team' ? (
                <>
                  Glofly Team · {when(m.createdAt)} · {m.seen ? 'seen' : 'not seen yet'}
                  {m.allowReply ? ' · replies allowed' : ' · no replies'}
                </>
              ) : (
                <>
                  {user.displayName} · {when(m.createdAt)}
                </>
              )}
            </span>
          </li>
        ))}
        <div ref={bottom} />
      </ol>
      {lastTeam && !lastTeam.allowReply && (
        <p className="hint" style={{ margin: 0 }}>
          Your last message didn’t allow replies, so they can’t answer it.
        </p>
      )}

      <Composer
        userId={user.id}
        username={user.username}
        onSent={(message) => {
          toast(message)
          setN((x) => x + 1)
          changed.current()
        }}
      />
    </aside>
  )
}

/** Write a Glofly Team message (the Inbox's composer). */
function Composer({
  userId,
  username,
  onSent
}: {
  userId: string
  username: string
  onSent: (message: string) => void
}): JSX.Element {
  const [body, setBody] = useState('')
  const [allowReply, setAllowReply] = useState(true)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = useId()

  const send = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    if (!body.trim()) local.body = 'Write the message.'
    if (note.trim().length < 3)
      local.note = 'Add a short note for the audit log (a few words is enough).'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const r = await api.messageUser(userId, body.trim(), allowReply, note.trim())
    setBusy(false)
    if (r.ok) {
      setBody('')
      setNote('')
      onSent(r.data.message ?? `Sent to @${username}.`)
    } else if (r.fields) setErrors(r.fields)
    else setFormError(r.message)
  }

  return (
    <form className="composer" onSubmit={(e) => void send(e)} noValidate>
      <div className="field">
        <label htmlFor={`${id}-body`}>Message to @{username}</label>
        <textarea
          id={`${id}-body`}
          className="textarea"
          rows={3}
          maxLength={TEAM_MESSAGE_MAX}
          value={body}
          placeholder="They see it from “Glofly Team · Official”."
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={`${id}-count${errors.body ? ` ${id}-err` : ''}`}
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="composer-row">
          {errors.body ? (
            <span id={`${id}-err`} className="hint hint--error">
              {errors.body}
            </span>
          ) : (
            <span />
          )}
          <span id={`${id}-count`} className="hint">
            {body.length}/{TEAM_MESSAGE_MAX}
          </span>
        </span>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={allowReply}
          onChange={(e) => setAllowReply(e.target.checked)}
        />
        <span>
          Let them reply <span className="hint">(replies come to this Inbox)</span>
        </span>
      </label>
      <NoteField
        value={note}
        onChange={setNote}
        error={errors.note}
        placeholder='e.g. "Report follow-up"'
      />
      {formError && (
        <div className="error-box" role="alert">
          {formError}
        </div>
      )}
      <div className="dialog-buttons">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </form>
  )
}

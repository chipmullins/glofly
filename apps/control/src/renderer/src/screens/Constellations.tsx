import { useEffect, useRef, useState, type JSX } from 'react'
import {
  api,
  type ConstellationInfo,
  type ConstellationRow,
  type ConstellationStatus
} from '../lib/api'
import { Avatar, Chip } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { ago, longDate, plural, when } from '../lib/format'

// Glofly 2.0: every constellation, biggest first. Take one down (hidden from everyone at once,
// kept for the record; voice is hung up), bring it back, or delete it for good. Reports about
// nebula messages arrive in Reports like any other, naming the constellation.

const FILTERS: { id: ConstellationStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'taken_down', label: 'Taken down' }
]

const VISIBILITY: Record<ConstellationRow['visibility'], string> = {
  invite: 'Invite only',
  public: 'Public',
  approval: 'Public, approval needed'
}

/** The constellation's own moderation log, in words (same as the desktop app's) */
const ACTION_WORDS: Record<string, string> = {
  joined: 'joined',
  left: 'left',
  kicked: 'kicked',
  banned: 'banned',
  unbanned: 'unbanned',
  timed_out: 'timed out',
  timeout_removed: 'ended the time-out of',
  message_deleted: 'deleted a message by',
  roles_changed: 'changed the roles of',
  role_created: 'created a role',
  role_changed: 'changed a role',
  role_deleted: 'deleted a role',
  nebula_deleted: 'deleted a nebula',
  voice_muted: 'muted in voice',
  voice_unmuted: 'unmuted in voice',
  voice_disconnected: 'disconnected from voice',
  visibility_changed: 'changed who can join',
  request_approved: 'let in',
  request_denied: 'turned down',
  ownership_transferred: 'gave ownership to'
}

function modLine(m: ConstellationInfo['moderation'][number]): string {
  const who = m.actor ? `@${m.actor}` : 'Someone'
  const word = ACTION_WORDS[m.action] ?? m.action.replace(/_/g, ' ')
  const target = m.target && m.action !== 'joined' && m.action !== 'left' ? ` @${m.target}` : ''
  const reason =
    m.details &&
    typeof m.details.reason === 'string' &&
    m.details.reason &&
    m.details.reason !== 'account_removed'
      ? ` (“${m.details.reason}”)`
      : ''
  return `${who} ${word}${target}${reason}`
}

export function Constellations({
  toast,
  onOpenAccount
}: {
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ConstellationStatus>('all')
  const [rows, setRows] = useState<ConstellationRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    const timer = setTimeout(
      () => {
        const ticket = ++latest.current
        void api.constellations(query, status).then((result) => {
          if (ticket !== latest.current) return
          if (result.ok) {
            setRows(result.data.constellations)
            setHasMore(result.data.hasMore)
            setError(null)
          } else setError(result.message)
        })
      },
      query ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [query, status, version])

  const loadMore = async (): Promise<void> => {
    if (!rows) return
    const result = await api.constellations(query, status, rows.length)
    if (result.ok) {
      setRows([...rows, ...result.data.constellations])
      setHasMore(result.data.hasMore)
    } else toast(result.message, true)
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Constellations</h1>
          <p className="sub">
            Glofly 2.0’s communities. Taking one down hides it from everyone right away and keeps it
            for the record.
          </p>
        </div>
      </header>

      <div className="filters-bar">
        <label className="search">
          <Icon d={ICONS.search} size={16} strokeWidth={2} />
          <input
            type="search"
            placeholder="Constellation name"
            aria-label="Search constellations"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="filter"
              aria-pressed={status === f.id}
              onClick={() => setStatus(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div className="accounts-layout">
        <section aria-label="Constellations list" className="card accounts-list">
          {!rows && !error && (
            <p className="loading" style={{ padding: '18px' }}>
              Loading…
            </p>
          )}
          {rows?.length === 0 && (
            <p className="empty" style={{ padding: '22px 18px' }}>
              {query ? `No constellations match “${query}”.` : 'No constellations yet.'}
            </p>
          )}
          {rows?.map((r) => (
            <button
              key={r.id}
              type="button"
              className="account-row"
              aria-current={selected === r.id ? 'true' : undefined}
              onClick={() => setSelected(r.id)}
            >
              <Avatar id={r.id} name={r.name} />
              <span className="text">
                <span className="name">{r.name}</span>
                <span className="handle">
                  {plural(r.memberCount, 'member')} · owner @{r.owner.username}
                </span>
              </span>
              <span className="seen">Active {ago(r.lastActivityAt)}</span>
              {r.takenDownAt ? (
                <Chip tone="bad">Taken down</Chip>
              ) : r.openReports > 0 ? (
                <Chip tone="warn">{plural(r.openReports, 'open report')}</Chip>
              ) : (
                <Chip tone={r.visibility === 'invite' ? 'plain' : 'good'}>
                  {VISIBILITY[r.visibility]}
                </Chip>
              )}
            </button>
          ))}
          {hasMore && (
            <div style={{ padding: '12px 18px' }}>
              <button type="button" className="btn btn--small" onClick={() => void loadMore()}>
                Show more
              </button>
            </div>
          )}
        </section>

        {selected ? (
          <Detail
            key={`${selected}-${version}`}
            id={selected}
            toast={toast}
            onOpenAccount={onOpenAccount}
            onChanged={(gone) => {
              if (gone) setSelected(null)
              setVersion((n) => n + 1)
            }}
          />
        ) : (
          <aside className="card detail" aria-label="Details">
            <p className="empty">Pick a constellation to see it.</p>
          </aside>
        )}
      </div>
    </>
  )
}

function Detail({
  id,
  toast,
  onOpenAccount,
  onChanged
}: {
  id: string
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
  onChanged: (gone: boolean) => void
}): JSX.Element {
  const [c, setC] = useState<ConstellationInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<{ spec: ActionSpec; gone: boolean } | null>(null)

  useEffect(() => {
    let stale = false
    void api.constellation(id).then((result) => {
      if (stale) return
      if (result.ok) setC(result.data.constellation)
      else setError(result.message)
    })
    return () => {
      stale = true
    }
  }, [id])

  if (error)
    return (
      <aside className="card detail" aria-label="Details">
        <div className="error-box" role="alert">
          {error}
        </div>
      </aside>
    )
  if (!c)
    return (
      <aside className="card detail" aria-label="Details">
        <p className="loading">Loading…</p>
      </aside>
    )

  const voice = c.nebulas.filter((n) => n.kind === 'voice').length
  const text = c.nebulas.length - voice
  return (
    <aside className="card detail" aria-label={c.name}>
      <div className="detail-head">
        <Avatar id={c.id} name={c.name} big />
        <div className="who">
          <span className="name">{c.name}</span>
          <span className="handle">
            {VISIBILITY[c.visibility]}
            {c.type ? ` · ${c.type}` : ''}
          </span>
        </div>
      </div>

      {c.takenDownAt && (
        <div className="notice notice--bad" role="status">
          <Icon d={ICONS.info} size={18} strokeWidth={2} />
          <span>
            <strong>Taken down {when(c.takenDownAt)}.</strong> {c.takedownReason}
          </span>
        </div>
      )}

      <dl className="facts">
        <dt>Owner</dt>
        <dd>
          {c.owner ? (
            <button type="button" className="link-btn" onClick={() => onOpenAccount(c.owner!.id)}>
              {c.owner.displayName} (@{c.owner.username})
            </button>
          ) : (
            'A removed account'
          )}
        </dd>
        <dt>Members</dt>
        <dd>{c.memberCount}</dd>
        <dt>Nebulas</dt>
        <dd>
          {plural(text, 'text nebula')}, {plural(voice, 'voice nebula')}
          {c.nebulas.length > 0 && (
            <div className="hint">
              {c.nebulas
                .map((n) => `${n.kind === 'voice' ? '🔊' : '#'}${n.name} (${n.messages})`)
                .join(' · ')}
            </div>
          )}
        </dd>
        {c.description && (
          <>
            <dt>About</dt>
            <dd>{c.description}</dd>
          </>
        )}
        {c.tags.length > 0 && (
          <>
            <dt>Tags</dt>
            <dd>{c.tags.join(', ')}</dd>
          </>
        )}
        <dt>Created</dt>
        <dd>{longDate(c.createdAt)}</dd>
      </dl>

      <span className="section-label">Actions</span>
      <div className="actions-grid">
        {c.takenDownAt ? (
          <button
            type="button"
            className="btn btn--action"
            onClick={() =>
              setAction({
                gone: false,
                spec: {
                  title: `Bring back ${c.name}`,
                  intro: 'Its members see it again, exactly as it was.',
                  confirmLabel: 'Bring it back',
                  run: (_v, note) => api.restoreConstellation(c.id, note)
                }
              })
            }
          >
            Bring back
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--action"
            onClick={() =>
              setAction({
                gone: false,
                spec: {
                  title: `Take down ${c.name}`,
                  intro:
                    'It disappears for every member at once and anyone in its voice nebulas is hung up. Nothing is deleted: you can bring it back.',
                  confirmLabel: 'Take down',
                  danger: true,
                  fields: [
                    {
                      name: 'reason',
                      label: 'Reason',
                      hint: 'Kept with it (members don’t see it).',
                      maxLength: 200
                    }
                  ],
                  run: (v, note) => api.takeDown(c.id, v.reason, note)
                }
              })
            }
          >
            Take down
          </button>
        )}
        <button
          type="button"
          className="btn btn--action"
          onClick={() =>
            setAction({
              gone: true,
              spec: {
                title: `Delete ${c.name} for good`,
                intro:
                  'Its nebulas, messages, roles and invites are deleted and can’t come back. Members see it disappear.',
                confirmLabel: 'Delete for good',
                danger: true,
                fields: [
                  { name: 'confirmName', label: `Type ${c.name} to confirm`, maxLength: 60 }
                ],
                run: (v, note) => api.deleteConstellation(c.id, v.confirmName, note)
              }
            })
          }
        >
          Delete for good
        </button>
      </div>

      <span className="section-label">Its moderation log</span>
      {c.moderation.length === 0 ? (
        <p className="empty" style={{ paddingTop: 4 }}>
          Nothing yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {c.moderation.map((m, i) => (
            <li key={i} className="history-row">
              <span>{modLine(m)}</span> <span className="muted">· {when(m.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}

      {action && (
        <ActionDialog
          spec={action.spec}
          onClose={() => setAction(null)}
          onDone={(message) => {
            const gone = action.gone
            setAction(null)
            toast(message)
            onChanged(gone)
          }}
        />
      )}
    </aside>
  )
}

import { useEffect, useRef, useState, type JSX } from 'react'
import {
  api,
  type ConstellationInfo,
  type ConstellationRow,
  type ConstellationStatus,
  type ConstellationTotals
} from '../lib/api'
import { Avatar, Chip } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { ago, longDate, plural, when } from '../lib/format'

// Glofly 2.0: every constellation, biggest first. Take one down (hidden from everyone at once,
// kept for the record; voice is hung up), bring it back, or delete it for good. Reports about
// nebula messages arrive in Reports like any other, naming the constellation.
// 0.8.2: totals, Frozen / Has reports / Growing filters, freeze, invite links off, transfer owner.

const FILTERS: { id: ConstellationStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'taken_down', label: 'Taken down' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'reports', label: 'Has reports' },
  { id: 'growing', label: 'Growing' }
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
  onOpenAccount,
  initialSelect
}: {
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
  /** 0.8.2: opened on one (the command bar, an alert) */
  initialSelect?: string | null
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<ConstellationStatus>('all')
  const [rows, setRows] = useState<ConstellationRow[] | null>(null)
  const [totals, setTotals] = useState<ConstellationTotals | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(initialSelect ?? null)
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
            if (result.data.totals) setTotals(result.data.totals)
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

      {totals && (
        <section className="stats stats--small" aria-label="Across Glofly">
          <div className="card stat">
            <span className="label">Constellations</span>
            <span className="value">{totals.constellations.toLocaleString('en-US')}</span>
          </div>
          <div className="card stat">
            <span className="label">Nebulas</span>
            <span className="value">{totals.nebulas.toLocaleString('en-US')}</span>
          </div>
          <div className="card stat">
            <span className="label">Voice rooms live</span>
            <span className="value">{totals.voiceLive.toLocaleString('en-US')}</span>
            <span className={`note${totals.voiceLive ? '' : ' note--quiet'}`}>
              {totals.voiceLive ? 'People talking now' : 'Nobody in voice'}
            </span>
          </div>
        </section>
      )}

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
              {query
                ? `No constellations match “${query}”.`
                : status === 'all'
                  ? 'No constellations yet.'
                  : 'None right now.'}
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
              <RowChips r={r} />
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

function RowChips({ r }: { r: ConstellationRow }): JSX.Element {
  const chips: JSX.Element[] = []
  if (r.takenDownAt)
    chips.push(
      <Chip key="down" tone="bad">
        Taken down
      </Chip>
    )
  if (r.frozenAt)
    chips.push(
      <Chip key="frozen" tone="purple">
        Frozen
      </Chip>
    )
  if (r.invitesOffAt)
    chips.push(
      <Chip key="inv" tone="plain">
        Invites off
      </Chip>
    )
  if (r.openReports > 0)
    chips.push(
      <Chip key="rep" tone="warn">
        {plural(r.openReports, 'report')}
      </Chip>
    )
  if ((r.joinsToday ?? 0) >= 10)
    chips.push(
      <Chip key="grow" tone="good">
        Growing (+{r.joinsToday} today)
      </Chip>
    )
  if (!chips.length)
    chips.push(
      <Chip key="vis" tone={r.visibility === 'invite' ? 'plain' : 'good'}>
        {VISIBILITY[r.visibility]}
      </Chip>
    )
  return <span className="row-chips">{chips}</span>
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

      {(c.frozenAt || c.invitesOffAt) && (
        <div className="notice" role="status">
          <Icon d={ICONS.lock} size={18} strokeWidth={2} />
          <span>
            {c.frozenAt && (
              <>
                <strong>Frozen {when(c.frozenAt)}.</strong> Members can read; nobody can post or
                join.{' '}
              </>
            )}
            {c.invitesOffAt && (
              <>
                <strong>Invite links off</strong> since {when(c.invitesOffAt)}.
              </>
            )}
          </span>
        </div>
      )}

      <div className="mini-stats" aria-label="Today">
        <div>
          <span className="n">{c.memberCount.toLocaleString('en-US')}</span>
          <span className="label">Members{c.joinsToday ? ` (+${c.joinsToday} today)` : ''}</span>
        </div>
        {c.messagesToday !== undefined && (
          <div>
            <span className="n">{c.messagesToday.toLocaleString('en-US')}</span>
            <span className="label">Messages today</span>
          </div>
        )}
        {c.openReports !== undefined && (
          <div>
            <span className={`n${c.openReports ? ' n--warn' : ''}`}>{c.openReports}</span>
            <span className="label">Open reports</span>
          </div>
        )}
      </div>

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

      <div>
        <span className="section-label">
          Nebulas · {plural(text, 'text')}, {plural(voice, 'voice')}
        </span>
        {c.nebulas.length === 0 ? (
          <p className="hint" style={{ marginTop: 6 }}>
            No nebulas.
          </p>
        ) : (
          <ul className="nebula-list">
            {c.nebulas.map((n) => {
              const marks = [
                n.kind === 'voice' ? 'Voice room' : 'Text',
                n.visibility === 'roles'
                  ? 'role-only'
                  : n.visibility === 'everyone'
                    ? 'everyone'
                    : '',
                n.readOnly ? 'read-only' : ''
              ].filter(Boolean)
              return (
                <li key={n.id} className="nebula-row">
                  <span className="nebula-icon" aria-hidden="true">
                    <Icon
                      d={
                        n.visibility === 'roles'
                          ? ICONS.lock
                          : n.kind === 'voice'
                            ? ICONS.voice
                            : ICONS.text
                      }
                      size={17}
                      strokeWidth={2}
                    />
                  </span>
                  <span className="text">
                    <span className="name">{n.kind === 'voice' ? n.name : `#${n.name}`}</span>
                    <span className="sub">{marks.join(' · ')}</span>
                  </span>
                  {n.kind === 'voice' && (n.inVoice ?? 0) > 0 ? (
                    <Chip small tone="good">
                      {n.inVoice} live
                    </Chip>
                  ) : (
                    <span className="nebula-count">
                      {n.messagesToday !== undefined
                        ? `${n.messagesToday.toLocaleString('en-US')} today`
                        : plural(n.messages, 'message')}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Counts only. Messages show up in Control only when someone reports them.
        </p>
      </div>

      <span className="section-label">Actions</span>
      <div className="actions-grid">
        {c.frozenAt !== undefined && (
          <button
            type="button"
            className="btn btn--action"
            onClick={() =>
              setAction({
                gone: false,
                spec: c.frozenAt
                  ? {
                      title: `Unfreeze ${c.name}`,
                      intro: 'Members can post and people can join again.',
                      confirmLabel: 'Unfreeze',
                      run: (_v, note) => api.freezeConstellation(c.id, false, note)
                    }
                  : {
                      title: `Freeze ${c.name}`,
                      intro:
                        'Members can still read everything, but nobody can post, join or talk in voice until you unfreeze it. Nothing is deleted.',
                      confirmLabel: 'Freeze',
                      danger: true,
                      notePlaceholder: 'e.g. "Raid in progress"',
                      run: (_v, note) => api.freezeConstellation(c.id, true, note)
                    }
              })
            }
          >
            {c.frozenAt ? 'Unfreeze' : 'Freeze'}
          </button>
        )}
        {c.invitesOffAt !== undefined && (
          <button
            type="button"
            className="btn btn--action"
            onClick={() =>
              setAction({
                gone: false,
                spec: c.invitesOffAt
                  ? {
                      title: `Turn on invite links for ${c.name}`,
                      intro: 'Its invite links work again.',
                      confirmLabel: 'Turn on invite links',
                      run: (_v, note) => api.constellationInvites(c.id, false, note)
                    }
                  : {
                      title: `Turn off invite links for ${c.name}`,
                      intro:
                        'Every invite link stops working and no new ones can be made, so nobody new joins through a link. Members stay.',
                      confirmLabel: 'Turn off invite links',
                      run: (_v, note) => api.constellationInvites(c.id, true, note)
                    }
              })
            }
          >
            {c.invitesOffAt ? 'Turn on invite links' : 'Turn off invite links'}
          </button>
        )}
        {c.frozenAt !== undefined && (
          <button
            type="button"
            className="btn btn--action"
            onClick={() =>
              setAction({
                gone: false,
                spec: {
                  title: `Transfer ${c.name}`,
                  intro: `A member becomes the Owner${c.owner ? ` instead of @${c.owner.username}` : ''}. The old owner stays a member.`,
                  confirmLabel: 'Transfer owner',
                  fields: [
                    {
                      name: 'username',
                      label: 'New owner’s username',
                      prefix: '@',
                      maxLength: 40,
                      hint: 'They have to be a member already.'
                    }
                  ],
                  run: (v, note) =>
                    api.transferConstellation(c.id, v.username.replace(/^@/, ''), note)
                }
              })
            }
          >
            Transfer owner
          </button>
        )}
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
          className="btn btn--action btn--danger-soft"
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

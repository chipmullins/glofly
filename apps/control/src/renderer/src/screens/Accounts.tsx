import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  api,
  type AccountDetail,
  type AccountList,
  type AccountRow,
  type FamilyFriend,
  type Filter,
  type InviteRow
} from '../lib/api'
import { Avatar, Chip, StatusChip } from '../components/common'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { MessageDialog } from '../components/MessageDialog'
import { SupportSection } from './AccountSupport'
import { Icon, ICONS } from '../components/icons'
import { ago, bytes, daysUntil, longDate, plural, shortDate, when } from '../lib/format'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'invited', label: 'Invited' },
  { id: 'unconfirmed', label: 'Email not confirmed' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'deleting', label: 'Being deleted' }
]

type Selected = { kind: 'account'; id: string } | { kind: 'invite'; id: string } | null

export function Accounts({
  initialQuery,
  initialSelect,
  initialThen,
  adminUserId,
  onCreate,
  toast,
  dataVersion
}: {
  initialQuery: string
  initialSelect: string | null
  /** 0.8.2 (command bar): open this dialog for the selected account straight away */
  initialThen?: 'message' | 'friend' | null
  adminUserId: string
  onCreate: () => void
  toast: (message: string, bad?: boolean) => void
  /** Goes up when something changed elsewhere (an account was created): load again. */
  dataVersion: number
}): JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [filter, setFilter] = useState<Filter>('all')
  const [list, setList] = useState<AccountList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selected>(
    initialSelect ? { kind: 'account', id: initialSelect } : null
  )
  const [detailVersion, setDetailVersion] = useState(0)
  const latest = useRef(0)

  const load = useCallback(async (q: string, f: Filter) => {
    const ticket = ++latest.current
    const result = await api.accounts(q, f)
    if (ticket !== latest.current) return // a newer search is on its way
    if (result.ok) {
      setList(result.data)
      setError(null)
    } else setError(result.message)
  }, [])

  // Search as you type (a moment after typing stops).
  useEffect(() => {
    const timer = setTimeout(() => void load(query, filter), query ? 250 : 0)
    return () => clearTimeout(timer)
  }, [query, filter, load, dataVersion])

  const reload = (): void => {
    void load(query, filter)
    setDetailVersion((n) => n + 1)
  }

  const rows: ({ kind: 'invite'; row: InviteRow } | { kind: 'account'; row: AccountRow })[] = list
    ? [
        ...list.invites.map((row) => ({ kind: 'invite' as const, row })),
        ...list.accounts.map((row) => ({ kind: 'account' as const, row }))
      ]
    : []

  return (
    <>
      <header className="page-head">
        <h1>Accounts</h1>
        <button type="button" className="btn btn--primary" onClick={onCreate}>
          <Icon d={ICONS.plus} size={16} strokeWidth={2.2} />
          Create account
        </button>
      </header>

      <div className="filters-bar">
        <label className="search">
          <Icon d={ICONS.search} size={16} strokeWidth={2} />
          <input
            type="search"
            placeholder="Username, email or display name"
            aria-label="Search accounts"
            value={query}
            autoFocus={!initialSelect}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="filter"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="count">{list?.counts[f.id] ?? ''}</span>
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
        <section aria-label="Accounts list" className="card accounts-list">
          {!list && !error && (
            <p className="loading" style={{ padding: '18px' }}>
              Loading…
            </p>
          )}
          {list && rows.length === 0 && (
            <p className="empty" style={{ padding: '22px 18px' }}>
              {query ? `No accounts match “${query}”.` : 'Nothing here.'}
            </p>
          )}
          {rows.map((item) =>
            item.kind === 'invite' ? (
              <button
                key={`i-${item.row.id}`}
                id={`row-${item.row.id}`}
                type="button"
                className="account-row"
                aria-current={selected?.id === item.row.id ? 'true' : undefined}
                onClick={() => setSelected({ kind: 'invite', id: item.row.id })}
              >
                <Avatar id={item.row.id} name={item.row.displayName} invite />
                <span className="text">
                  <span className="name">{item.row.displayName}</span>
                  <span className="handle">
                    @{item.row.username}
                    {item.row.restricted && (
                      <>
                        {' '}
                        <Chip tone="purple" small>
                          Family
                        </Chip>
                      </>
                    )}
                  </span>
                </span>
                <span className="seen">
                  {item.row.status === 'pending'
                    ? 'Not set up yet'
                    : `Invite expired ${shortDate(item.row.expiresAt)}`}
                </span>
                <StatusChip status={item.row.status} />
              </button>
            ) : (
              <button
                key={item.row.id}
                id={`row-${item.row.id}`}
                type="button"
                className="account-row"
                aria-current={selected?.id === item.row.id ? 'true' : undefined}
                onClick={() => setSelected({ kind: 'account', id: item.row.id })}
              >
                <Avatar id={item.row.id} name={item.row.displayName} />
                <span className="text">
                  <span className="name">{item.row.displayName}</span>
                  <span className="handle">
                    @{item.row.username}
                    {item.row.restricted && (
                      <>
                        {' '}
                        <Chip tone="purple" small>
                          Family
                        </Chip>
                      </>
                    )}
                  </span>
                </span>
                <span className="seen">
                  {item.row.online
                    ? 'Online now'
                    : item.row.lastSeenAt
                      ? `Last seen ${ago(item.row.lastSeenAt)}`
                      : `Joined ${ago(item.row.createdAt)}`}
                </span>
                <StatusChip status={item.row.status} admin={item.row.isAdmin} />
              </button>
            )
          )}
          {list?.more && (
            <p className="list-more">Showing the newest 200. Search to find others.</p>
          )}
        </section>

        {selected?.kind === 'account' && (
          <AccountPanel
            key={`${selected.id}-${detailVersion}`}
            id={selected.id}
            adminUserId={adminUserId}
            then={selected.id === initialSelect && detailVersion === 0 ? initialThen : null}
            onChanged={(message) => {
              toast(message)
              reload()
            }}
            onGone={(message) => {
              toast(message)
              setSelected(null)
              void load(query, filter)
            }}
          />
        )}
        {selected?.kind === 'invite' && list && (
          <InvitePanel
            key={`${selected.id}-${detailVersion}`}
            invite={list.invites.find((i) => i.id === selected.id) ?? null}
            onChanged={(message, gone) => {
              toast(message)
              if (gone) setSelected(null)
              reload()
            }}
          />
        )}
        {!selected && list && rows.length > 0 && (
          <aside className="card detail" aria-label="Details">
            <p className="empty" style={{ paddingTop: 4 }}>
              Pick an account to see its details and actions.
            </p>
          </aside>
        )}
      </div>
    </>
  )
}

// ───────────── One account ─────────────

/** "Add a friend for them" (0.8.2: any account; family accounts use the same dialog). */
function addFriendSpec(a: AccountDetail['account']): ActionSpec {
  return {
    title: `Add a friend for @${a.username}`,
    intro:
      'They become friends straight away, no request needed. Both of them see each other in Friends right away.',
    confirmLabel: 'Add friend',
    fields: [
      {
        name: 'username',
        label: 'Friend’s username',
        maxLength: 40,
        prefix: '@',
        hint: 'Their Glofly username, e.g. chip'
      }
    ],
    notePlaceholder: a.restricted ? 'e.g. "Cousin, parent OK’d"' : 'e.g. "Requested by user"',
    run: (v, note) => api.addFriendFor(a.id, v.username.replace(/^@/, ''), note)
  }
}

function AccountPanel({
  id,
  adminUserId,
  then,
  onChanged,
  onGone
}: {
  id: string
  adminUserId: string
  then?: 'message' | 'friend' | null
  onChanged: (message: string) => void
  onGone: (message: string) => void
}): JSX.Element {
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<(ActionSpec & { gone?: boolean }) | null>(null)
  const [messaging, setMessaging] = useState(false)

  useEffect(() => {
    let live = true
    void api.account(id).then((result) => {
      if (!live) return
      if (result.ok) {
        setDetail(result.data)
        if (then === 'message') setMessaging(true)
        if (then === 'friend') setAction(addFriendSpec(result.data.account))
      } else setError(result.message)
    })
    return () => {
      live = false
    }
  }, [id, then])

  if (error) {
    return (
      <aside className="card detail" aria-label="Account">
        <div className="error-box" role="alert">
          {error}
        </div>
      </aside>
    )
  }
  if (!detail) {
    return (
      <aside className="card detail" aria-label="Account">
        <p className="loading">Loading…</p>
      </aside>
    )
  }

  const a = detail.account
  const isMe = a.id === adminUserId
  const run =
    (path: string, extra: (v: Record<string, string>) => Record<string, unknown> = () => ({})) =>
    (values: Record<string, string>, note: string) =>
      api.accountAction(a.id, path, { ...extra(values), note })

  // Family accounts add friends from their Family card (same dialog), so it isn't shown twice.
  const familyCard = !isMe && a.restricted === true

  const actions: { label: string; spec: ActionSpec & { gone?: boolean }; show: boolean }[] = [
    {
      label: 'Add a friend for them',
      show: !familyCard && a.status !== 'deleting',
      spec: addFriendSpec(a)
    },
    {
      label: 'Send password reset',
      show: true,
      spec: {
        title: 'Send a password reset',
        intro: (
          <>
            Emails a “Choose a new password” link to <strong>{a.email}</strong>. It works once, for
            an hour. You never see or set their password.
          </>
        ),
        confirmLabel: 'Send reset link',
        run: run('password-reset')
      }
    },
    {
      label: 'Resend confirm email',
      show: !a.emailVerified,
      spec: {
        title: 'Resend the confirm email',
        intro: (
          <>
            Sends “Confirm your email” again to <strong>{a.email}</strong>. The link works for 7
            days.
          </>
        ),
        confirmLabel: 'Send link',
        run: run('confirm-email')
      }
    },
    {
      label: 'Change username',
      show: true,
      spec: {
        title: 'Change username',
        intro: (
          <>
            People can’t change their own username, so this is the only way. Their friends see the
            new one right away.
            <br />
            <strong>@{a.username}</strong> becomes free for anyone to take.
          </>
        ),
        confirmLabel: 'Change username',
        fields: [
          {
            name: 'username',
            label: 'New username',
            initial: a.username,
            maxLength: 20,
            hint: '3–20 letters, numbers, periods or underscores.'
          }
        ],
        run: run('username', (v) => ({ username: v.username.replace(/^@/, '') }))
      }
    },
    {
      label: 'Change email',
      show: true,
      spec: {
        title: 'Change email',
        intro: (
          <>
            Switches their email straight away. A confirm link goes to the new address, and{' '}
            <strong>{a.email}</strong> gets a heads-up that it changed.
          </>
        ),
        confirmLabel: 'Change email',
        fields: [{ name: 'email', label: 'New email', type: 'email', maxLength: 254 }],
        run: run('email', (v) => ({ email: v.email }))
      }
    },
    {
      label: 'Export their data',
      show: true,
      spec: {
        title: `Export @${a.username}'s data`,
        intro: (
          <>
            Saves everything Glofly keeps about @{a.username} as a .json file: profile, devices,
            friends, the messages they sent, reactions, constellations and more. Other people&apos;s
            messages and passwords are left out; photos and files are listed but not included. Use
            it when someone asks for a copy of their data.
          </>
        ),
        confirmLabel: 'Export and save…',
        notePlaceholder: 'e.g. They asked for a copy of their data by email',
        run: async (_v, note) => {
          const r = await window.control.exportAccount(a.id, note)
          if (!r.ok) return { ok: false, status: 0, error: 'export_failed', message: r.message }
          return {
            ok: true,
            data: {
              message: r.saved
                ? 'Saved their data.'
                : 'Not saved (the export is still in the audit log).'
            }
          }
        }
      }
    },
    {
      label: 'Sign out all devices',
      show: true,
      spec: {
        title: 'Sign out all devices',
        intro: `Signs @${a.username} out everywhere (${plural(a.devices.length, 'device')}) and closes their live connections. They can log in again with their password.`,
        confirmLabel: 'Sign out everywhere',
        run: run('sign-out')
      }
    }
  ]

  return (
    <aside className="card detail" aria-label={a.displayName}>
      <div className="detail-head">
        <Avatar id={a.id} name={a.displayName} big />
        <div className="who">
          <span className="name">{a.displayName}</span>
          <span className="handle">
            @{a.username}
            {a.isAdmin && (
              <>
                {' '}
                <Chip tone="purple" small>
                  Admin
                </Chip>
              </>
            )}
            {a.restricted && (
              <>
                {' '}
                <Chip tone="purple" small>
                  Family
                </Chip>
              </>
            )}
          </span>
        </div>
      </div>

      {a.status === 'suspended' && (
        <div className="notice notice--bad" role="status">
          <span>
            <strong>Suspended</strong> {ago(a.suspendedAt)}. They see: “{a.suspendReason}”
          </span>
        </div>
      )}
      {a.status === 'deleting' && a.deleteAfter && (
        <div className="notice notice--bad" role="status">
          <span>
            <strong>Being deleted.</strong> Removed for good on {longDate(a.deleteAfter)} (
            {plural(daysUntil(a.deleteAfter), 'day')} left). Logging in again restores it.
          </span>
        </div>
      )}

      <dl className="facts">
        <dt>Email</dt>
        <dd>
          {a.email}{' '}
          {a.emailVerified ? (
            <Chip tone="good" small>
              Confirmed
            </Chip>
          ) : (
            <Chip small>Not confirmed</Chip>
          )}
          {a.pendingEmail && (
            <div className="hint">Changing to {a.pendingEmail} (waiting for them to confirm)</div>
          )}
        </dd>
        <dt>Joined</dt>
        <dd>
          {longDate(a.createdAt)}
          {a.inviteCode && (
            <div className="hint">
              with invite code {a.inviteCode.code} ({a.inviteCode.label})
            </div>
          )}
          {a.invitedBy && <div className="hint">account created by @{a.invitedBy}</div>}
        </dd>
        <dt>Last seen</dt>
        <dd>{a.online ? 'Online now' : a.lastSeenAt ? ago(a.lastSeenAt) : 'Not yet'}</dd>
        <dt>Friends</dt>
        <dd>
          {plural(a.friends, 'friend')} · {plural(a.groups, 'group')}
        </dd>
        <dt>Files</dt>
        <dd>
          {bytes(a.storageBytes)} ({plural(a.fileCount, 'file')})
        </dd>
      </dl>

      {!isMe && a.restricted !== undefined && <FamilySection account={a} onAction={setAction} />}

      {a.status !== 'deleting' && (
        <button type="button" className="btn btn--team" onClick={() => setMessaging(true)}>
          <Icon d={ICONS.message} size={17} strokeWidth={2} />
          Message as Glofly team
        </button>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="section-label">Devices</span>
        {a.devices.length === 0 && (
          <span className="hint" style={{ fontSize: 14 }}>
            Not signed in anywhere.
          </span>
        )}
        {a.devices.map((d) => (
          <div key={d.id} className="device">
            <span>
              {d.deviceName ?? 'Unknown device'}
              <span className="version"> · {d.appVersion ? `v${d.appVersion}` : 'older app'}</span>
            </span>
            <span className={`when${d.online ? ' when--online' : ''}`}>
              {d.online ? 'Online now' : ago(d.lastUsedAt)}
            </span>
          </div>
        ))}
      </div>

      <SupportSection id={a.id} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="section-label">Actions</span>
        <div className="actions-grid">
          {actions
            .filter((x) => x.show)
            .map((x) => (
              <button
                key={x.label}
                type="button"
                className="btn btn--action"
                onClick={() => setAction(x.spec)}
              >
                {x.label}
              </button>
            ))}
        </div>
        <div className="actions-grid" style={{ marginTop: 4 }}>
          {a.status === 'deleting' ? (
            <button
              type="button"
              className="btn btn--action"
              onClick={() =>
                setAction({
                  title: 'Cancel the deletion',
                  intro: `@${a.username} comes back exactly as it was: profile, friends and chats.`,
                  confirmLabel: 'Cancel deletion',
                  run: run('cancel-deletion')
                })
              }
            >
              Cancel deletion
            </button>
          ) : a.suspendedAt ? (
            <button
              type="button"
              className="btn btn--action"
              onClick={() =>
                setAction({
                  title: `Unsuspend @${a.username}`,
                  intro: 'They can log in again straight away.',
                  confirmLabel: 'Unsuspend',
                  run: run('unsuspend')
                })
              }
            >
              Unsuspend
            </button>
          ) : (
            <button
              type="button"
              className="btn btn--action btn--danger-soft"
              disabled={isMe}
              title={isMe ? "You can't suspend yourself" : undefined}
              onClick={() =>
                setAction({
                  title: `Suspend @${a.username}`,
                  intro:
                    'Signs them out of every device and ends any call. Logging in is refused, showing the reason below, until you unsuspend them. Nothing is deleted.',
                  confirmLabel: 'Suspend',
                  danger: true,
                  fields: [
                    {
                      name: 'reason',
                      label: 'Reason they see when they try to log in',
                      maxLength: 200,
                      hint: 'e.g. "Sent spam links. Email support@glofly.app to talk about it."'
                    }
                  ],
                  run: run('suspend', (v) => ({ reason: v.reason }))
                })
              }
            >
              Suspend…
            </button>
          )}
          <button
            type="button"
            className="btn btn--action btn--danger"
            disabled={isMe}
            title={isMe ? "You can't delete your own account here" : undefined}
            onClick={() =>
              setAction({
                title: `Delete @${a.username} now`,
                intro: (
                  <>
                    Removed for good right away, with no 30 days to change their mind: profile,
                    photo, friends, their direct messages (for both people) and their files.{' '}
                    <strong>This can’t be undone.</strong>
                  </>
                ),
                confirmLabel: 'Delete for good',
                danger: true,
                gone: true,
                fields: [
                  { name: 'confirmUsername', label: `Type ${a.username} to confirm`, maxLength: 40 }
                ],
                run: run('delete', (v) => ({ confirmUsername: v.confirmUsername }))
              })
            }
          >
            Delete account…
          </button>
        </div>
        <p className="hint" style={{ margin: '2px 0 0' }}>
          Each action asks for a short note for the audit log.
        </p>
      </div>

      {detail.history.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="section-label" style={{ marginBottom: 4 }}>
            History in Control
          </span>
          {detail.history.slice(0, 6).map((h) => (
            <div key={h.id} className="history-row">
              <span>
                <strong style={{ fontWeight: 600 }}>{h.action}</strong>
                {h.targetLabel && h.targetLabel.includes('→') ? ` · ${h.targetLabel}` : ''}
              </span>
              <span className="meta">
                {h.note ? `“${h.note}” · ` : ''}
                {when(h.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      {action && (
        <ActionDialog
          spec={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            const gone = action.gone
            setAction(null)
            if (gone) onGone(message)
            else onChanged(message)
          }}
        />
      )}
      {messaging && (
        <MessageDialog
          user={a}
          onClose={() => setMessaging(false)}
          onDone={(message) => {
            setMessaging(false)
            onChanged(message)
          }}
        />
      )}
    </aside>
  )
}

// ───────────── Family (restricted accounts, 0.4.0) ─────────────

function FamilySection({
  account: a,
  onAction
}: {
  account: AccountDetail['account']
  onAction: (spec: ActionSpec) => void
}): JSX.Element {
  const [friends, setFriends] = useState<FamilyFriend[] | null>(null)
  const restricted = a.restricted === true

  useEffect(() => {
    if (!restricted) return
    let live = true
    void api.family(a.id).then((r) => live && r.ok && setFriends(r.data.friends))
    return () => {
      live = false
    }
  }, [a.id, restricted])

  const toggle = (): void =>
    onAction(
      restricted
        ? {
            title: `Make @${a.username} a regular account`,
            intro:
              'They can send and accept friend requests again, show up in search, invite friends, change their email and delete their account. Their friends stay.',
            confirmLabel: 'Lift the restriction',
            run: (_v, note) => api.setRestricted(a.id, false, note)
          }
        : {
            title: `Restrict @${a.username}`,
            intro: (
              <>
                For a child’s account. From now on <strong>only you add their friends</strong>, here
                in Control. They can’t send or accept friend requests, don’t show up in search, can
                only be in groups where everyone is their friend, and can’t change their email or
                delete the account. Friend requests waiting now are cancelled, and they leave any
                group with people who aren’t their friends.
              </>
            ),
            confirmLabel: 'Restrict account',
            notePlaceholder: 'e.g. "Family account, parent asked"',
            run: (_v, note) => api.setRestricted(a.id, true, note)
          }
    )

  return (
    <div className="family" aria-label="Family">
      <div className="family-head">
        <Icon d={ICONS.family} size={20} strokeWidth={1.9} />
        <span className="text">
          <strong id={`family-${a.id}`}>Restricted (family account)</strong>
          <span className="hint">
            {restricted ? 'Only you manage their friends.' : 'Off: they manage their own friends.'}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={restricted}
          aria-labelledby={`family-${a.id}`}
          className="switch"
          onClick={toggle}
        >
          <span className="switch-knob" />
        </button>
      </div>
      {restricted && (
        <>
          <span className="section-label">Their friends</span>
          {!friends && <span className="loading">Loading…</span>}
          {friends?.length === 0 && (
            <span className="hint" style={{ fontSize: 14 }}>
              No friends yet. Add the people they should be able to talk to.
            </span>
          )}
          {friends?.map((f) => (
            <div key={f.id} className="family-friend">
              <Avatar id={f.id} name={f.displayName} />
              <span className="text">
                <span>{f.displayName}</span>
                <span className="handle">@{f.username}</span>
              </span>
              <button
                type="button"
                className="btn btn--small btn--danger-soft"
                onClick={() =>
                  onAction({
                    title: `Remove @${f.username}`,
                    intro: `@${a.username} and @${f.username} stop being friends: they can’t message or call each other, and @${a.username} leaves any group they share with people who aren’t their friends.`,
                    confirmLabel: 'Remove friend',
                    danger: true,
                    run: (_v, note) => api.removeFamilyFriend(a.id, f.id, note)
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--action"
            onClick={() => onAction(addFriendSpec(a))}
          >
            <Icon d={ICONS.plus} size={16} strokeWidth={2.2} />
            Add a friend for them
          </button>
        </>
      )}
    </div>
  )
}

// ───────────── An invite (account not set up yet) ─────────────

function InvitePanel({
  invite,
  onChanged
}: {
  invite: InviteRow | null
  onChanged: (message: string, gone?: boolean) => void
}): JSX.Element {
  const [action, setAction] = useState<(ActionSpec & { gone?: boolean }) | null>(null)
  if (!invite) {
    return (
      <aside className="card detail" aria-label="Invite">
        <p className="empty">That invite isn’t in the list any more.</p>
      </aside>
    )
  }
  const pending = invite.status === 'pending'
  return (
    <aside className="card detail" aria-label={invite.displayName}>
      <div className="detail-head">
        <Avatar id={invite.id} name={invite.displayName} big invite />
        <div className="who">
          <span className="name">{invite.displayName}</span>
          <span className="handle">@{invite.username}</span>
        </div>
      </div>
      <div className={`notice${pending ? '' : ' notice--warn'}`} role="status">
        <Icon d={ICONS.mail} size={18} strokeWidth={2} />
        <span>
          {pending ? (
            <>
              <strong>Invited, not set up yet.</strong> The link in their email works until{' '}
              {when(invite.expiresAt)} ({plural(daysUntil(invite.expiresAt), 'day')} left). Until
              they finish, the account can’t be used.
            </>
          ) : (
            <>
              <strong>The invite expired</strong> on {longDate(invite.expiresAt)}. Resend it for 7
              more days, or cancel it to free the username.
            </>
          )}
        </span>
      </div>
      <dl className="facts">
        <dt>Email</dt>
        <dd>{invite.email}</dd>
        <dt>Invited</dt>
        <dd>{when(invite.createdAt)}</dd>
        <dt>Last sent</dt>
        <dd>{when(invite.sentAt)}</dd>
      </dl>
      <div className="actions-grid">
        <button
          type="button"
          className="btn btn--action"
          onClick={() =>
            setAction({
              title: 'Resend the invite',
              intro: (
                <>
                  Sends a new link to <strong>{invite.email}</strong>, good for 7 days. The old link
                  stops working.
                </>
              ),
              confirmLabel: 'Resend invite',
              run: (_v, note) => api.inviteAction(invite.id, 'resend', note)
            })
          }
        >
          Resend invite
        </button>
        <button
          type="button"
          className="btn btn--action btn--danger-soft"
          onClick={() =>
            setAction({
              title: 'Cancel the invite',
              intro: `The link stops working and @${invite.username} is free again. No account was made, so nothing else changes.`,
              confirmLabel: 'Cancel invite',
              danger: true,
              gone: true,
              run: (_v, note) => api.inviteAction(invite.id, 'cancel', note)
            })
          }
        >
          Cancel invite
        </button>
      </div>
      {action && (
        <ActionDialog
          spec={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            const gone = action.gone
            setAction(null)
            onChanged(message, gone)
          }}
        />
      )}
    </aside>
  )
}

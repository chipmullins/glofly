import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiResult, FriendEntry, FriendLists, SignedInUser } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import AddFriendDialog from '../components/AddFriendDialog'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ConfirmDialog'
import {
  AddFriendIcon,
  BlockIcon,
  ChatIcon,
  FriendsIcon,
  LogOutIcon,
  MoreIcon,
  PlusIcon,
  RemoveFriendIcon,
  SearchIcon,
  SettingsIcon
} from '../components/icons'
import { initials, shortDate } from '../lib/names'
import '../components/dialogs.css'
import './MainScreen.css'

type MainScreenProps = {
  user: SignedInUser
  onLogout: () => void
  /** The server ended this session (expired, or signed out elsewhere). */
  onSessionExpired: () => void
}

type FriendFilter = 'all' | 'online' | 'offline' | 'pending' | 'blocked'

const FILTERS: { id: FriendFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' }
]

// How often the friends list refreshes while the app is open. Becomes instant
// once the real-time connection arrives with chat.
const REFRESH_MS = 15_000

type Confirm = { kind: 'remove' | 'block'; person: FriendEntry } | null

function useClickOutside(open: boolean, close: () => void): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])
  return ref
}

function SettingsMenu({ onLogout }: { onLogout: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useClickOutside(open, close)

  return (
    <div className="settings-wrap" ref={wrapRef}>
      <button
        type="button"
        className="icon-button"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <SettingsIcon />
      </button>
      {open && (
        <div role="menu" className="menu settings-menu">
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item--danger"
            onClick={onLogout}
          >
            <LogOutIcon />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

function FriendRow({
  person,
  onRemove,
  onBlock
}: {
  person: FriendEntry
  onRemove: () => void
  onBlock: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useClickOutside(open, close)

  return (
    <div className={open ? 'friend-row friend-row--open' : 'friend-row'}>
      <Avatar id={person.id} name={person.displayName} />
      <div className="friend-text">
        <div className="friend-names">
          <span className="friend-name">{person.displayName}</span>
          <span className="friend-user">@{person.username}</span>
        </div>
        <span className="friend-sub">Friends since {shortDate(person.since)}</span>
      </div>
      <div className="friend-more" ref={wrapRef}>
        <button
          type="button"
          className="round-button"
          aria-label={`More options for ${person.displayName}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <MoreIcon />
        </button>
        {open && (
          <div role="menu" className="menu friend-menu">
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item--danger"
              onClick={() => {
                close()
                onBlock()
              }}
            >
              <BlockIcon />
              Block
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item--danger"
              onClick={() => {
                close()
                onRemove()
              }}
            >
              <RemoveFriendIcon />
              Remove friend
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function PersonRow({
  person,
  sub,
  children
}: {
  person: FriendEntry
  sub: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="friend-row">
      <Avatar id={person.id} name={person.displayName} />
      <div className="friend-text">
        <div className="friend-names">
          <span className="friend-name">{person.displayName}</span>
          <span className="friend-user">@{person.username}</span>
        </div>
        <span className="friend-sub">{sub}</span>
      </div>
      <div className="row-actions">{children}</div>
    </div>
  )
}

function EmptyState({
  title,
  text,
  onAdd
}: {
  title: string
  text: string
  onAdd?: () => void
}): React.JSX.Element {
  return (
    <div className="empty-state">
      <img src={fireflyImg} alt="" className="empty-firefly" draggable={false} />
      <h2>{title}</h2>
      <p>{text}</p>
      {onAdd && (
        <button type="button" className="primary-button" onClick={onAdd}>
          <AddFriendIcon />
          Add friend
        </button>
      )}
    </div>
  )
}

const matches = (p: FriendEntry, q: string): boolean => {
  const s = q.trim().toLowerCase()
  return !s || p.displayName.toLowerCase().includes(s) || p.username.toLowerCase().includes(s)
}

export default function MainScreen({
  user,
  onLogout,
  onSessionExpired
}: MainScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<FriendFilter>('all')
  const [lists, setLists] = useState<FriendLists | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.glofly.friends.list()
    if (result.ok) {
      setLists(result.data)
      setNotice(null)
    } else if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
  }, [onSessionExpired])

  // Load now, then keep it fresh.
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      if (!cancelled) void refresh()
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [refresh])

  /** Runs an action for one person, then refreshes the lists. */
  async function run(personId: string, action: () => Promise<ApiResult<null>>): Promise<boolean> {
    setBusy(personId)
    const result = await action()
    setBusy(null)
    if (!result.ok) {
      if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
      return false
    }
    await refresh()
    return true
  }

  async function confirmAction(): Promise<void> {
    if (!confirm) return
    const { kind, person } = confirm
    const ok = await run(person.id, () =>
      kind === 'remove'
        ? window.glofly.friends.remove(person.id)
        : window.glofly.friends.block(person.id)
    )
    if (ok) setConfirm(null)
  }

  const incomingCount = lists?.incoming.length ?? 0
  const friends = (lists?.friends ?? []).filter((p) => matches(p, search))
  const incoming = (lists?.incoming ?? []).filter((p) => matches(p, search))
  const outgoing = (lists?.outgoing ?? []).filter((p) => matches(p, search))
  const blocked = (lists?.blocked ?? []).filter((p) => matches(p, search))
  const openAdd = (): void => setAdding(true)
  const searching = search.trim().length > 0

  function renderTab(): React.ReactNode {
    if (!lists) return null // first load: blank for a moment rather than a flash of "no friends"

    if (filter === 'online' || filter === 'offline') {
      return (
        <EmptyState
          title="Online status is coming"
          text="You'll see who's online, away or busy once chat is live."
        />
      )
    }

    if (filter === 'all') {
      if (lists.friends.length === 0) {
        return (
          <EmptyState
            title="No friends yet"
            text="Add friends by their username and they'll show up here."
            onAdd={openAdd}
          />
        )
      }
      if (friends.length === 0)
        return <p className="list-empty">No friends match “{search.trim()}”.</p>
      return (
        <section className="friend-group">
          <h2>All friends — {friends.length}</h2>
          {friends.map((p) => (
            <FriendRow
              key={p.id}
              person={p}
              onRemove={() => setConfirm({ kind: 'remove', person: p })}
              onBlock={() => setConfirm({ kind: 'block', person: p })}
            />
          ))}
        </section>
      )
    }

    if (filter === 'pending') {
      if (lists.incoming.length === 0 && lists.outgoing.length === 0) {
        return (
          <EmptyState
            title="No friend requests"
            text="Requests you send and receive will show up here."
            onAdd={openAdd}
          />
        )
      }
      if (incoming.length === 0 && outgoing.length === 0 && searching) {
        return <p className="list-empty">No requests match “{search.trim()}”.</p>
      }
      return (
        <>
          {incoming.length > 0 && (
            <section className="friend-group">
              <h2>Requests for you — {incoming.length}</h2>
              {incoming.map((p) => (
                <PersonRow key={p.id} person={p} sub={`Sent ${shortDate(p.since)}`}>
                  <button
                    type="button"
                    className="small-button small-button--primary"
                    disabled={busy === p.id}
                    onClick={() => run(p.id, () => window.glofly.friends.accept(p.id))}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="small-button small-button--quiet"
                    disabled={busy === p.id}
                    onClick={() => run(p.id, () => window.glofly.friends.removeRequest(p.id))}
                  >
                    Decline
                  </button>
                </PersonRow>
              ))}
            </section>
          )}
          {outgoing.length > 0 && (
            <section className="friend-group">
              <h2>Sent — {outgoing.length}</h2>
              {outgoing.map((p) => (
                <PersonRow key={p.id} person={p} sub={`You sent a request ${shortDate(p.since)}`}>
                  <button
                    type="button"
                    className="small-button small-button--quiet"
                    disabled={busy === p.id}
                    onClick={() => run(p.id, () => window.glofly.friends.removeRequest(p.id))}
                  >
                    Cancel request
                  </button>
                </PersonRow>
              ))}
            </section>
          )}
        </>
      )
    }

    // Blocked
    if (lists.blocked.length === 0) {
      return (
        <EmptyState
          title="No one blocked"
          text="People you block can't find you or send you requests."
        />
      )
    }
    if (blocked.length === 0) return <p className="list-empty">No one matches “{search.trim()}”.</p>
    return (
      <section className="friend-group">
        <h2>Blocked — {blocked.length}</h2>
        {blocked.map((p) => (
          <PersonRow key={p.id} person={p} sub={`Blocked ${shortDate(p.since)}`}>
            <button
              type="button"
              className="small-button small-button--quiet"
              disabled={busy === p.id}
              onClick={() => run(p.id, () => window.glofly.friends.unblock(p.id))}
            >
              Unblock
            </button>
          </PersonRow>
        ))}
      </section>
    )
  }

  return (
    <div className="main main--enter">
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="sidebar-logo" aria-hidden="true">
            <img src={fireflyImg} alt="" draggable={false} />
          </div>
          <div className="search">
            <SearchIcon />
            <input
              type="search"
              className="search-input"
              aria-label="Find a friend or chat"
              placeholder="Find a friend or chat"
            />
          </div>
        </div>

        <div className="profile-panel">
          <button type="button" className="avatar avatar--me" aria-label="Change your status">
            {initials(user.displayName)}
            <span className="status-dot status-dot--online" />
          </button>
          <div className="profile-text">
            <span className="profile-name">{user.displayName}</span>
            <span className="profile-sub">@{user.username} · Online</span>
          </div>
          <SettingsMenu onLogout={onLogout} />
        </div>

        <button
          type="button"
          className="nav-item nav-item--active"
          aria-current="page"
          onClick={() => setFilter(incomingCount > 0 ? 'pending' : 'all')}
        >
          <FriendsIcon />
          Friends
          {incomingCount > 0 && (
            <span className="badge" aria-label={`${incomingCount} friend requests`}>
              {incomingCount}
            </span>
          )}
        </button>

        <div className="section-head">
          <span>Direct messages</span>
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label="New message or group chat"
          >
            <PlusIcon />
          </button>
        </div>

        <div className="dm-empty">
          <ChatIcon />
          <p>No conversations yet. Messages with friends will show up here.</p>
        </div>
      </aside>

      <main className="content">
        <header className="content-header">
          <div className="content-title">
            <FriendsIcon size={22} />
            Friends
          </div>
          <nav aria-label="Friend filters" className="filters">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="filter"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
                {f.id === 'pending' && incomingCount > 0 && (
                  <span className="badge badge--small">{incomingCount}</span>
                )}
              </button>
            ))}
          </nav>
          <button type="button" className="primary-button add-friend" onClick={openAdd}>
            <AddFriendIcon />
            Add friend
          </button>
        </header>

        <div className="content-body">
          {notice && (
            <div className="page-notice" role="alert">
              {notice}
            </div>
          )}
          <div className="search search--wide">
            <SearchIcon />
            <input
              type="search"
              className="search-input"
              aria-label="Search friends"
              placeholder={
                filter === 'blocked'
                  ? 'Search blocked'
                  : filter === 'pending'
                    ? 'Search requests'
                    : 'Search friends'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {renderTab()}
        </div>
      </main>

      {adding && (
        <AddFriendDialog
          onClose={() => setAdding(false)}
          onChanged={refresh}
          onSessionExpired={onSessionExpired}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm.kind === 'remove'
              ? `Remove ${confirm.person.displayName}?`
              : `Block ${confirm.person.displayName}?`
          }
          message={
            confirm.kind === 'remove'
              ? `You'll no longer be friends with @${confirm.person.username}. You can send a new request later.`
              : `@${confirm.person.username} will be removed from your friends, won't find you in search, and can't send you requests. You can unblock them anytime.`
          }
          confirmLabel={confirm.kind === 'remove' ? 'Remove friend' : 'Block'}
          danger
          busy={busy === confirm.person.id}
          onConfirm={confirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}

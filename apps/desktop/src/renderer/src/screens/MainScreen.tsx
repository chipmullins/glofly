import { useEffect, useRef, useState } from 'react'
import type { SignedInUser } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import {
  AddFriendIcon,
  ChatIcon,
  FriendsIcon,
  LogOutIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon
} from '../components/icons'
import './MainScreen.css'

type MainScreenProps = {
  user: SignedInUser
  onLogout: () => void
}

type FriendFilter = 'all' | 'online' | 'offline' | 'pending' | 'blocked'

const FILTERS: { id: FriendFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' }
]

const EMPTY_STATES: Record<FriendFilter, { title: string; text: string; showAdd: boolean }> = {
  all: {
    title: 'No friends yet',
    text: "Add friends by their username and they'll show up here.",
    showAdd: true
  },
  online: {
    title: 'Nobody online right now',
    text: 'Friends who are online will show up here.',
    showAdd: false
  },
  offline: {
    title: 'Nobody offline',
    text: 'Friends who are offline will show up here.',
    showAdd: false
  },
  pending: {
    title: 'No friend requests',
    text: 'Requests you send and receive will show up here.',
    showAdd: true
  },
  blocked: {
    title: 'No one blocked',
    text: "People you block can't message or call you.",
    showAdd: false
  }
}

/** "Chip" → "C", "Chip Mullins" → "CM" */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? '') : ''
  return (first + last).toUpperCase()
}

function SettingsMenu({ onLogout }: { onLogout: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close when clicking elsewhere or pressing Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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

export default function MainScreen({ user, onLogout }: MainScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<FriendFilter>('all')
  const empty = EMPTY_STATES[filter]

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

        <button type="button" className="nav-item nav-item--active" aria-current="page">
          <FriendsIcon />
          Friends
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
              </button>
            ))}
          </nav>
          <button type="button" className="primary-button add-friend">
            <AddFriendIcon />
            Add friend
          </button>
        </header>

        <div className="content-body">
          <div className="search search--wide">
            <SearchIcon />
            <input
              type="search"
              className="search-input"
              aria-label="Search friends"
              placeholder="Search friends"
            />
          </div>

          <div className="empty-state">
            <img src={fireflyImg} alt="" className="empty-firefly" draggable={false} />
            <h2>{empty.title}</h2>
            <p>{empty.text}</p>
            {empty.showAdd && (
              <button type="button" className="primary-button">
                <AddFriendIcon />
                Add friend
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

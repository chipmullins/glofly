import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiResult,
  ConversationSummary,
  MyStatus,
  Presence,
  FriendEntry,
  FriendLists,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import AddFriendDialog from '../components/AddFriendDialog'
import Avatar, { AvatarFace } from '../components/Avatar'
import ChatView from '../components/ChatView'
import ConfirmDialog from '../components/ConfirmDialog'
import EditProfileDialog from '../components/EditProfileDialog'
import ProfileCard from '../components/ProfileCard'
import {
  AddFriendIcon,
  BlockIcon,
  ChatIcon,
  FriendsIcon,
  LogOutIcon,
  MoreIcon,
  PlusIcon,
  ProfileIcon,
  RemoveFriendIcon,
  SearchIcon,
  SettingsIcon
} from '../components/icons'
import { shortDate } from '../lib/names'
import { attachmentSummary } from '../lib/attachments'
import { playSound, setQuiet } from '../lib/sounds'
import { dotFor, presenceLine, STATUS_LABEL } from '../lib/presence'
import StatusDot from '../components/StatusDot'
import StatusMenu from '../components/StatusMenu'
import SettingsDialog from '../components/SettingsDialog'
import '../components/dialogs.css'
import './MainScreen.css'
import EmojiText from '../components/EmojiText'

type MainScreenProps = {
  user: SignedInUser
  onLogout: () => void
  /** The server ended this session (expired, or signed out elsewhere). */
  onSessionExpired: () => void
  /** Deleted from Settings → Account (this device is signed out). */
  onAccountDeleted: (deleteAfter: string) => void
  /** Your name or photo changed (here or on another device). */
  onUserChange: (changes: Pick<SignedInUser, 'displayName' | 'avatarVersion'>) => void
}

type FriendFilter = 'all' | 'online' | 'offline' | 'pending' | 'blocked'

const FILTERS: { id: FriendFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'offline', label: 'Offline' },
  { id: 'pending', label: 'Pending' },
  { id: 'blocked', label: 'Blocked' }
]

// Friends and chats update instantly over the live connection. This slow refresh
// is just a safety net in case an update is ever missed.
const REFRESH_MS = 60_000

type Confirm = { kind: 'remove' | 'block'; person: PublicUser } | null

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

function SettingsMenu({
  onLogout,
  onOpenSettings,
  onEditProfile
}: {
  onLogout: () => void
  onOpenSettings: () => void
  onEditProfile: () => void
}): React.JSX.Element {
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
            className="menu-item"
            onClick={() => {
              close()
              onEditProfile()
            }}
          >
            <ProfileIcon size={18} />
            Edit profile
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close()
              onOpenSettings()
            }}
          >
            <SettingsIcon size={18} />
            Settings
          </button>
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
  now,
  onMessage,
  onViewProfile,
  onRemove,
  onBlock
}: {
  person: FriendEntry
  now: number
  onMessage: () => void
  onViewProfile: () => void
  onRemove: () => void
  onBlock: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useClickOutside(open, close)

  return (
    <div className={open ? 'friend-row friend-row--open' : 'friend-row'}>
      <Avatar
        id={person.id}
        name={person.displayName}
        avatarVersion={person.avatarVersion}
        status={person.presence?.status ?? 'offline'}
        ring={open ? 'var(--glo-subtle)' : 'var(--glo-bg)'}
      />
      <div className="friend-text">
        <div className="friend-names">
          <span className="friend-name">{person.displayName}</span>
          <span className="friend-user">@{person.username}</span>
        </div>
        <span className="friend-sub" title={`Friends since ${shortDate(person.since)}`}>
          <EmojiText text={presenceLine(person.presence, now)} />
        </span>
      </div>
      <button
        type="button"
        className="round-button"
        aria-label={`Message ${person.displayName}`}
        title="Message"
        onClick={onMessage}
      >
        <ChatIcon />
      </button>
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
              className="menu-item"
              onClick={() => {
                close()
                onViewProfile()
              }}
            >
              <ProfileIcon size={18} />
              View profile
            </button>
            <div className="menu-divider" role="separator" />
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
      <Avatar id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
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
  onSessionExpired,
  onAccountDeleted,
  onUserChange
}: MainScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<FriendFilter>('all')
  const [lists, setLists] = useState<FriendLists | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [openChatId, setOpenChatId] = useState<string | null>(null)
  const [connected, setConnected] = useState(true)
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [myStatus, setMyStatus] = useState<MyStatus>({ status: 'online', statusText: null })
  const [statusOpen, setStatusOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const [viewing, setViewing] = useState<PublicUser | null>(null)
  // Ticks every minute so "Last seen 5 minutes ago" stays accurate.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Do not disturb keeps Glofly quiet.
  useEffect(() => {
    setQuiet(myStatus.status === 'dnd')
    return () => setQuiet(false)
  }, [myStatus.status])

  // Your own status and custom status.
  useEffect(() => {
    window.glofly.status.get().then((result) => {
      if (result.ok) setMyStatus(result.data)
    })
  }, [])
  const openChatRef = useRef<string | null>(null)
  const onUserChangeRef = useRef(onUserChange)
  useEffect(() => {
    onUserChangeRef.current = onUserChange
  })
  useEffect(() => {
    openChatRef.current = openChatId
  }, [openChatId])
  const incomingSeen = useRef<number | null>(null)

  const refreshFriends = useCallback(async () => {
    const result = await window.glofly.friends.list()
    if (result.ok) {
      // A new friend request since last time? Play the friend-request sound.
      const count = result.data.incoming.length
      if (incomingSeen.current !== null && count > incomingSeen.current) playSound('friendRequest')
      incomingSeen.current = count
      setLists(result.data)
      setPresence(
        Object.fromEntries(
          result.data.friends.filter((f) => f.presence).map((f) => [f.id, f.presence as Presence])
        )
      )
      setNotice(null)
    } else if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
  }, [onSessionExpired])

  const refreshConversations = useCallback(async () => {
    const result = await window.glofly.conversations.list()
    if (result.ok) setConversations(result.data)
    else if (result.error === 'unauthorized') onSessionExpired()
  }, [onSessionExpired])

  const refresh = useCallback(async () => {
    await Promise.all([refreshFriends(), refreshConversations()])
  }, [refreshFriends, refreshConversations])

  // Live updates from the server.
  useEffect(() => {
    return window.glofly.onEvent((event) => {
      switch (event.type) {
        case 'message:new': {
          const m = event.message
          const viewing = openChatRef.current === m.conversationId && document.hasFocus()
          if (m.senderId !== user.id && !viewing) playSound('message')
          setConversations((list) => {
            const existing = list.find((c) => c.id === m.conversationId)
            if (!existing) {
              void refreshConversations() // a brand-new chat: fetch its details
              return list
            }
            const updated: ConversationSummary = {
              ...existing,
              lastMessage: m,
              activityAt: m.createdAt,
              unreadCount:
                m.senderId !== user.id && openChatRef.current !== m.conversationId
                  ? existing.unreadCount + 1
                  : existing.unreadCount
            }
            return [updated, ...list.filter((c) => c.id !== m.conversationId)]
          })
          break
        }
        case 'message:updated': {
          // Keep the sidebar preview in step with edits and deletes of the latest message.
          const m = event.message
          setConversations((list) =>
            list.map((c) => (c.lastMessage?.id === m.id ? { ...c, lastMessage: m } : c))
          )
          break
        }
        case 'presence': {
          const { userId, status, statusText, lastSeenAt } = event
          if (userId === user.id) {
            // Your own status changed (maybe from another device): refresh what you picked.
            window.glofly.status.get().then((result) => {
              if (result.ok) setMyStatus(result.data)
            })
          } else {
            setPresence((map) => ({ ...map, [userId]: { status, statusText, lastSeenAt } }))
          }
          break
        }
        case 'conversation:read': {
          // They read the chat: update "Seen".
          const { conversationId, readAt } = event
          setConversations((list) =>
            list.map((c) => (c.id === conversationId ? { ...c, partnerReadAt: readAt } : c))
          )
          break
        }
        case 'conversations:changed':
          void refreshConversations()
          break
        case 'profile:changed':
          if (event.userId === user.id) {
            // You changed your name or photo (maybe on another device).
            window.glofly.profile.getMine().then((result) => {
              if (result.ok) {
                const { displayName, avatarVersion } = result.data
                onUserChangeRef.current({ displayName, avatarVersion })
              }
            })
          } else {
            void refresh() // a friend's new name or photo
          }
          break
        case 'friends:changed':
          void refresh()
          break
        case 'connection':
          setConnected(event.connected)
          if (event.connected) void refresh() // catch up on anything missed while offline
          break
        case 'session:expired':
          onSessionExpired()
          break
      }
    })
  }, [user.id, refresh, refreshConversations, onSessionExpired])

  async function openChatWith(userId: string): Promise<void> {
    const result = await window.glofly.conversations.openDm(userId)
    if (!result.ok) {
      if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
      return
    }
    const conversation = result.data
    setConversations((list) =>
      list.some((c) => c.id === conversation.id) ? list : [conversation, ...list]
    )
    setOpenChatId(conversation.id)
  }

  const markedRead = useCallback((conversationId: string) => {
    setConversations((list) =>
      list.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c))
    )
  }, [])

  const openChat = conversations.find((c) => c.id === openChatId) ?? null

  async function changeStatus(changes: Partial<MyStatus>): Promise<boolean> {
    const result = await window.glofly.status.set(changes)
    if (result.ok) {
      setMyStatus(result.data)
      return true
    }
    if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
    return false
  }

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
  const isFriendId = (id: string): boolean => (lists?.friends ?? []).some((f) => f.id === id)
  const friends = (lists?.friends ?? [])
    .map((p) => ({ ...p, presence: presence[p.id] ?? p.presence }))
    .filter((p) => matches(p, search))
  const isOnline = (p: FriendEntry): boolean => (p.presence?.status ?? 'offline') !== 'offline'
  const onlineFriends = friends.filter(isOnline)
  const offlineFriends = friends.filter((p) => !isOnline(p))
  const incoming = (lists?.incoming ?? []).filter((p) => matches(p, search))
  const outgoing = (lists?.outgoing ?? []).filter((p) => matches(p, search))
  const blocked = (lists?.blocked ?? []).filter((p) => matches(p, search))
  const openAdd = (): void => setAdding(true)
  const searching = search.trim().length > 0

  function renderTab(): React.ReactNode {
    if (!lists) return null // first load: blank for a moment rather than a flash of "no friends"

    const friendRows = (people: FriendEntry[]): React.ReactNode =>
      people.map((p) => (
        <FriendRow
          key={p.id}
          person={p}
          now={now}
          onRemove={() => setConfirm({ kind: 'remove', person: p })}
          onBlock={() => setConfirm({ kind: 'block', person: p })}
          onMessage={() => void openChatWith(p.id)}
          onViewProfile={() => setViewing(p)}
        />
      ))

    if (filter === 'online' || filter === 'offline') {
      const people = filter === 'online' ? onlineFriends : offlineFriends
      if (people.length === 0) {
        if (searching) return <p className="list-empty">No friends match “{search.trim()}”.</p>
        return filter === 'online' ? (
          <EmptyState
            title="Nobody online right now"
            text={
              lists.friends.length
                ? "When friends are online, away or busy, they'll show up here."
                : "Add friends to see when they're around."
            }
            onAdd={lists.friends.length ? undefined : openAdd}
          />
        ) : (
          <EmptyState title="Everyone's around" text="Friends who are offline will show up here." />
        )
      }
      return (
        <section className="friend-group">
          <h2>
            {filter === 'online' ? 'Online' : 'Offline'} — {people.length}
          </h2>
          {friendRows(people)}
        </section>
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
      // Grouped like the design: "Online — 3", then "Offline — 2".
      return (
        <>
          {onlineFriends.length > 0 && (
            <section className="friend-group">
              <h2>Online — {onlineFriends.length}</h2>
              {friendRows(onlineFriends)}
            </section>
          )}
          {offlineFriends.length > 0 && (
            <section className="friend-group">
              <h2>Offline — {offlineFriends.length}</h2>
              {friendRows(offlineFriends)}
            </section>
          )}
        </>
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
          <button
            type="button"
            className="avatar avatar--me"
            aria-label={`Change your status (now ${STATUS_LABEL[myStatus.status]})`}
            aria-expanded={statusOpen}
            title="Change your status"
            onClick={() => setStatusOpen((v) => !v)}
          >
            <AvatarFace id={user.id} name={user.displayName} avatarVersion={user.avatarVersion} />
            <StatusDot status={dotFor(myStatus.status)} ring="var(--glo-surface)" />
          </button>
          <div className="profile-text">
            <span className="profile-name">{user.displayName}</span>
            <span className="profile-sub" title={myStatus.statusText ?? undefined}>
              <EmojiText
                text={`@${user.username} · ${myStatus.statusText || STATUS_LABEL[myStatus.status]}`}
              />
            </span>
          </div>
          <SettingsMenu
            onLogout={onLogout}
            onOpenSettings={() => setSettingsOpen(true)}
            onEditProfile={() => setEditingProfile(true)}
          />
          {statusOpen && (
            <StatusMenu
              current={myStatus}
              onChange={changeStatus}
              onClose={() => setStatusOpen(false)}
            />
          )}
        </div>

        <button
          type="button"
          className={openChat ? 'nav-item' : 'nav-item nav-item--active'}
          aria-current={openChat ? undefined : 'page'}
          onClick={() => {
            setOpenChatId(null)
            setFilter(incomingCount > 0 ? 'pending' : 'all')
          }}
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
            title="New message"
            onClick={() => {
              setOpenChatId(null)
              setFilter('all')
            }}
          >
            <PlusIcon />
          </button>
        </div>

        {conversations.length === 0 ? (
          <div className="dm-empty">
            <ChatIcon />
            <p>No conversations yet. Messages with friends will show up here.</p>
          </div>
        ) : (
          <nav aria-label="Direct messages" className="dm-list">
            {conversations.map((c) => {
              const active = c.id === openChatId
              const last = c.lastMessage
              const partnerPresence = presence[c.partner.id]
              // Like the design: friends show their status; otherwise the last message.
              const preview = partnerPresence
                ? presenceLine(partnerPresence, now)
                : !last
                  ? 'No messages yet'
                  : `${last.senderId === user.id ? 'You: ' : ''}${
                      last.deleted
                        ? 'Message deleted'
                        : last.body.replace(/\s+/g, ' ') || attachmentSummary(last.attachments)
                    }`
              return (
                <button
                  key={c.id}
                  type="button"
                  className={active ? 'dm-row dm-row--active' : 'dm-row'}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => setOpenChatId(c.id)}
                >
                  <Avatar
                    id={c.partner.id}
                    name={c.partner.displayName}
                    avatarVersion={c.partner.avatarVersion}
                    size={40}
                    status={partnerPresence?.status}
                    ring={active ? 'var(--glo-accent-soft)' : 'var(--glo-sidebar)'}
                  />
                  <span className="dm-text">
                    <span
                      className={
                        c.unreadCount > 0 || active ? 'dm-name dm-name--strong' : 'dm-name'
                      }
                    >
                      {c.partner.displayName}
                    </span>
                    <span className="dm-preview">
                      <EmojiText text={preview} />
                    </span>
                  </span>
                  {c.unreadCount > 0 && !active && (
                    <span className="badge" aria-label={`${c.unreadCount} unread`}>
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        )}
      </aside>

      <main className="content">
        {!connected && (
          <div className="connection-banner" role="status">
            Reconnecting to Glofly…
          </div>
        )}
        {openChat ? (
          <ChatView
            key={openChat.id}
            me={user}
            conversation={openChat}
            partnerPresence={presence[openChat.partner.id]}
            now={now}
            onRead={markedRead}
            onViewProfile={() => setViewing(openChat.partner)}
            onSessionExpired={onSessionExpired}
          />
        ) : (
          <>
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
          </>
        )}
      </main>

      {adding && (
        <AddFriendDialog
          onClose={() => setAdding(false)}
          onChanged={refresh}
          onSessionExpired={onSessionExpired}
          onMessage={(userId) => {
            setAdding(false)
            void openChatWith(userId)
          }}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          user={user}
          onClose={() => setSettingsOpen(false)}
          onLogout={onLogout}
          onAccountDeleted={onAccountDeleted}
          onSessionExpired={onSessionExpired}
        />
      )}
      {editingProfile && (
        <EditProfileDialog
          user={user}
          status={myStatus}
          onSaved={(saved, status) => {
            onUserChange({ displayName: saved.displayName, avatarVersion: saved.avatarVersion })
            setMyStatus(status)
          }}
          onClose={() => setEditingProfile(false)}
          onSessionExpired={onSessionExpired}
        />
      )}
      {viewing && (
        <ProfileCard
          key={viewing.id}
          person={viewing}
          isFriend={isFriendId(viewing.id)}
          presence={presence[viewing.id]}
          onMessage={() => {
            setViewing(null)
            void openChatWith(viewing.id)
          }}
          onRemove={() => {
            setViewing(null)
            setConfirm({ kind: 'remove', person: viewing })
          }}
          onBlock={() => {
            setViewing(null)
            setConfirm({ kind: 'block', person: viewing })
          }}
          onClose={() => setViewing(null)}
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

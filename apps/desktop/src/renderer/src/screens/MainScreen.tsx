import { shortBody } from '@glofly/shared/gifs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ApiResult,
  ConversationSummary,
  MyStatus,
  Presence,
  FriendEntry,
  FriendLists,
  Announcement,
  Message,
  MuteDuration,
  PublicUser,
  ShortcutAction,
  SignedInUser,
  TeamNotice
} from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import AddFriendDialog from '../components/AddFriendDialog'
import Avatar, { AvatarFace } from '../components/Avatar'
import ChatView from '../components/ChatView'
import { ListSkeleton } from '../components/Skeleton'
import ConfirmDialog from '../components/ConfirmDialog'
import EditProfileDialog from '../components/EditProfileDialog'
import EmptyScene from '../components/EmptyScene'
import WelcomeFlow from '../components/WelcomeFlow'
import { noteInvited, welcomeFlowPending, finishWelcomeFlow } from '../lib/welcome'
import ProfileCard from '../components/ProfileCard'
import {
  AddFriendIcon,
  BlockIcon,
  ChatIcon,
  FriendsIcon,
  GroupIcon,
  LogOutIcon,
  MoreIcon,
  ProfileIcon,
  RemoveFriendIcon,
  SearchIcon,
  SettingsIcon
} from '../components/icons'
import { shortDate } from '../lib/names'
import { playSound, setQuiet } from '../lib/sounds'
import {
  activityLine,
  dotFor,
  onMobile,
  playing,
  presenceLine,
  STATUS_LABEL
} from '../lib/presence'
import StatusDot from '../components/StatusDot'
import StatusMenu from '../components/StatusMenu'
import SettingsDialog, { type SettingsPage } from '../components/SettingsDialog'
import GameNotice from '../components/GameNotice'
import SearchPanel from '../components/SearchPanel'
import '../components/dialogs.css'
import './MainScreen.css'
import EmojiText from '../components/EmojiText'
import ChatList from '../components/ChatList'
import GroupsPage from '../components/GroupsPage'
import MuteMenuItems from '../components/MuteMenu'
import ReportDialog from '../components/ReportDialog'
import { AnnouncementBar, TeamNoticeDialog } from '../components/TeamNotice'
import { isClosed, isMuted, mentionsMe, muteUntil } from '../lib/mentions'
import { findChats, type ChatResult } from '../lib/chatSearch'
import { GroupPeopleDialog, GroupSettingsDialog } from '../components/GroupDialogs'
import { chatTitle } from '../lib/groups'
import { attachmentSummary } from '../lib/attachments'
import { badgeImage, clearNotification, notify, previewsOn, shouldNotify } from '../lib/notify'
import { CallProvider } from '../calls/CallContext'
import UpdateBar from '../components/UpdateBar'
import ConfirmEmailBar from '../components/ConfirmEmailBar'
import { WebNotifyBar } from '../components/WebNotifications'
import type { CallsValue } from '../calls/callState'
import { CallFloat, CallStrip } from '../components/CallPanel'
import { ChevronIcon, GameIcon, PhoneIcon, VideoIcon } from '../components/icons'
import { isShortcutKey, isWeb, shortcutLabel } from '../lib/platform'
import { useSocial, useSocialSync } from '../lib/social'
import { HangToast, SocialActions, SocialStrip, YearInGlowDialog } from '../components/Social'
import { BroadcastViewer, GoLiveDialog, LivePanel } from '../components/Broadcast'
import { stopLive, useMyBroadcast } from '../lib/broadcast'
import ConstellationsScreen from '../constellations/ConstellationsScreen'
import InvitePopup from '../constellations/InvitePopup'
import EventToasts from '../constellations/EventToasts'
import { InviteJoinDialog } from '../constellations/InviteJoinDialog'
import { lastPlaceIn, useConstellationsPhase, viewingNebula } from '../constellations/phase'
import { GalaxyIcon } from '../constellations/sky'
import { useConstellationCards, usePinnedNebulas } from '../lib/constellations'
import HomeDock, { type HomeDockHandle } from '../constellations/HomeDock'
import MyGamesPanel from '../components/MyGames'
import { setQuietHours } from '../lib/quiet'
import { quietHours as quietHoursApi } from '../lib/tools'
import { clearOutbox, retryOffline } from '../lib/outbox'
import QuickSwitcher from '../components/QuickSwitcher'
import ShortcutSheet from '../components/ShortcutSheet'
import { noteRecent } from '../lib/quickSwitch'

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
/** "New group chat", or "Add people" to a group */
type GroupPicker = { groupId: string | null } | null

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
  onEditProfile,
  onYearInGlow,
  onMyGames
}: {
  onLogout: () => void
  onOpenSettings: () => void
  onEditProfile: () => void
  onYearInGlow: () => void
  /** 2.0: your games and who sees them */
  onMyGames: () => void
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
              onMyGames()
            }}
          >
            <GameIcon size={18} />
            My games
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
            className="menu-item"
            onClick={() => {
              close()
              onYearInGlow()
            }}
          >
            <span className="menu-sparkle" aria-hidden="true">
              ✨
            </span>
            Year in Glow
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
  onCall,
  onViewProfile,
  onRemove,
  onBlock
}: {
  person: FriendEntry
  now: number
  onMessage: () => void
  onCall: (video: boolean) => void
  onViewProfile: () => void
  /** Missing for a restricted (family-managed) account: their family removes friends. */
  onRemove?: () => void
  onBlock: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const wrapRef = useClickOutside(open, close)
  const game = playing(person.presence)

  return (
    // Clicking anywhere on the row opens the chat (the Message button does the same from the
    // keyboard); clicks on the row's own buttons and menu do their own thing.
    <div
      className={
        open
          ? 'friend-row friend-row--open friend-row--clickable'
          : 'friend-row friend-row--clickable'
      }
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, .friend-menu')) return
        onMessage()
      }}
    >
      <Avatar
        id={person.id}
        name={person.displayName}
        avatarVersion={person.avatarVersion}
        status={person.presence?.status ?? 'offline'}
        mobile={onMobile(person.presence ?? undefined)}
        ring={open ? 'var(--glo-subtle)' : 'var(--glo-bg)'}
      />
      <div className="friend-text">
        <div className="friend-names">
          <span className="friend-name">{person.displayName}</span>
          <span className="friend-user">@{person.username}</span>
        </div>
        {game ? (
          <span className="friend-sub friend-sub--playing" title={activityLine(game, now)}>
            <GameIcon size={14} />
            <span>{activityLine(game, now)}</span>
          </span>
        ) : (
          <span className="friend-sub" title={`Friends since ${shortDate(person.since)}`}>
            <EmojiText text={presenceLine(person.presence, now)} />
          </span>
        )}
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
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close()
                onCall(false)
              }}
            >
              <PhoneIcon size={18} />
              Voice call
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                close()
                onCall(true)
              }}
            >
              <VideoIcon size={18} />
              Video call
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
            {onRemove && (
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
            )}
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

/** No friends list yet (a stable empty list, so calls don't re-render for it). */
const NO_FRIENDS: PublicUser[] = []

export default function MainScreen({
  user,
  onLogout,
  onSessionExpired,
  onAccountDeleted,
  onUserChange
}: MainScreenProps): React.JSX.Element {
  const [filter, setFilter] = useState<FriendFilter>('all')
  /** What shows when no chat is open: Friends, or the Groups page (sidebar, under Friends) */
  const [page, setPage] = useState<'friends' | 'groups'>('friends')
  const [groupsNotice, setGroupsNotice] = useState<string | null>(null)
  /** Report dialog: a message (from its menu) or a person (from their profile card) */
  const [reporting, setReporting] = useState<{
    person: PublicUser
    message: { id: string; conversationId: string; preview: string } | null
  } | null>(null)
  /** Messages from the Glofly team waiting for "I understand", and the banner */
  const [teamNotices, setTeamNotices] = useState<TeamNotice[]>([])
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [lists, setLists] = useState<FriendLists | null>(null)
  /** Friends by id (0.5.0: who's live, free to hang, birthdays) */
  const friendsById = useMemo(() => new Map((lists?.friends ?? []).map((f) => [f.id, f])), [lists])
  const friendsRef = useRef<PublicUser[]>([])
  useEffect(() => {
    friendsRef.current = lists?.friends ?? []
  }, [lists])
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  /** Add friend dialog: open at the search, or (0.7.4 welcome card) at "Invite your friends" */
  const [adding, setAdding] = useState<false | 'search' | 'invite'>(false)
  /** 0.7.5: "Find @name" from an empty friends search starts the Add friend search with it */
  const [addQuery, setAddQuery] = useState('')
  /** 0.7.5: the welcome flow, once, for an account made on this device (lib/welcome.ts) */
  const [welcoming, setWelcoming] = useState(() => welcomeFlowPending(user.id))
  const endWelcome = useCallback(() => {
    finishWelcomeFlow(user.id)
    setWelcoming(false)
  }, [user.id])
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  /** The chat list's first answer came back (until then it shows placeholders, never "no chats") */
  const [chatsLoaded, setChatsLoaded] = useState(false)
  const [openChatId, setOpenChatId] = useState<string | null>(null)
  // Narrow windows (an iPad held upright, Split View; only in a browser, since the desktop app's
  // window is never that narrow): one pane at a time, the list or what's open, like the phone
  // app. True while the list is showing. MainScreen.css does the rest.
  const [narrowList, setNarrowList] = useState(true)
  const openFromList = useCallback((id: string | null) => {
    setOpenChatId(id)
    setNarrowList(false)
  }, [])
  // A chat opened some other way (a notification, a new message to someone): show it.
  const [shownChatId, setShownChatId] = useState(openChatId)
  if (openChatId !== shownChatId) {
    setShownChatId(openChatId)
    if (openChatId) setNarrowList(false)
  }
  const [connected, setConnected] = useState(true)
  // 0.7.5: "Reconnecting…" only once it's been down for a couple of seconds (a blip stays quiet).
  const [showReconnecting, setShowReconnecting] = useState(false)
  useEffect(() => {
    if (connected) return
    const t = setTimeout(() => setShowReconnecting(true), 2000)
    return () => clearTimeout(t)
  }, [connected])
  // Signing out (this screen goes away): nothing waits to be sent for the next person.
  useEffect(() => () => clearOutbox(), [])
  const [presence, setPresence] = useState<Record<string, Presence>>({})
  const [myStatus, setMyStatus] = useState<MyStatus>({ status: 'online', statusText: null })
  const [statusOpen, setStatusOpen] = useState(false)
  /** Settings, and the page it opens on (false = closed). */
  const [settingsOpen, setSettingsOpen] = useState<false | SettingsPage>(false)
  /** Settings opened for one thing (the Jump List's "Quiet hours"): scrolled to it */
  const [settingsFocus, setSettingsFocus] = useState<string | undefined>(undefined)
  /** Message search: one chat (chatId) or all chats (null) */
  const [messageSearch, setMessageSearch] = useState<{
    chatId: string | null
    query: string
  } | null>(null)
  /** A search result to show: its chat opens scrolled to it */
  const [jump, setJump] = useState<{
    conversationId: string
    messageId: string
    nonce: number
  } | null>(null)
  const searchThisChat = useCallback(
    (chatId: string) => setMessageSearch((s) => ({ chatId, query: s?.query ?? '' })),
    []
  )
  const [editingProfile, setEditingProfile] = useState(false)
  const [viewing, setViewing] = useState<PublicUser | null>(null)
  const [groupPicker, setGroupPicker] = useState<GroupPicker>(null)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<ConversationSummary | null>(null)
  const [leaveBusy, setLeaveBusy] = useState(false)
  /** Short messages about calls ("Jacob didn't pick up."), shown for a few seconds */
  const [toast, setToast] = useState<string | null>(null)
  // 0.5.0 social: glows, hangs, birthdays, broadcasts, Year in Glow.
  useSocialSync()
  const social = useSocial()
  const myLive = useMyBroadcast()
  // Signing out (or the session ending) while live ends the broadcast and stops sharing the screen.
  useEffect(() => () => void stopLive(), [])
  const [goLive, setGoLive] = useState(false)
  const [livePanel, setLivePanel] = useState(false)
  const [watchingId, setWatchingId] = useState<string | null>(null)
  const [hangPing, setHangPing] = useState<PublicUser | null>(null)
  const [yearOpen, setYearOpen] = useState(false)
  // Glofly 2.0: Constellations (the night side) and My games.
  // 0.4.0: a restricted (family-managed) account: Glofly Control can turn it on or off any time
  // (account:changed), so it's asked again then.
  const [restricted, setRestricted] = useState(user.restricted === true)
  const cxCards = useConstellationCards(!restricted)
  const cxQuickAllowed = cxCards.cards.length > 0
  const cx = useConstellationsPhase(cxQuickAllowed)
  const cxNavRef = useRef<HTMLButtonElement>(null)
  // 0.7.1: the window's fade-in plays once. It used to come back each time the night side
  // finished flying home (the class swapped back to it), which flickered the whole screen.
  const [cxUsed, setCxUsed] = useState(false)
  if (cx.phase !== 'home' && !cxUsed) setCxUsed(true)
  /** Nebula chats seen in live news, so their notifications know where to open */
  const nebulaChats = useRef(new Map<string, { constellationId: string; nebulaId: string }>())
  const cxEnterRef = useRef((place: { constellationId: string; nebulaId: string }) =>
    cx.enter(cxNavRef.current, place)
  )
  // The nebula dock on Glofly home (2.0): it opens a nebula's notification right here.
  const homeDock = useRef<HomeDockHandle>(null)
  useEffect(() => {
    cxEnterRef.current = (place) => {
      if (cx.phase === 'home' && homeDock.current) {
        homeDock.current.openNebula(place.constellationId, place.nebulaId)
      } else cx.enter(cxNavRef.current, place)
    }
  })
  const [myGamesOpen, setMyGamesOpen] = useState(false)
  const closeHangPing = useCallback(() => setHangPing(null), [])
  const callControls = useRef<CallsValue | null>(null)
  /** The sidebar's "Find a friend or chat" search */
  const [chatQuery, setChatQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const chatSearchRef = useRef<HTMLInputElement>(null)
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
  // Family-managed (restricted) accounts can't use Constellations at all (the server refuses too).
  const cxPins = usePinnedNebulas(!restricted && cx.phase === 'home')
  const cxNew = cxCards.cards.some((c) => c.unreadCount > 0 || c.mentionCount > 0)
  const cxOpen = cx.phase !== 'home'
  const { leave: cxLeave } = cx
  useEffect(() => {
    if (restricted) cxLeave()
  }, [restricted, cxLeave])
  useEffect(
    () =>
      window.glofly.onEvent((event) => {
        if (event.type !== 'account:changed') return
        void window.glofly.auth.me().then((me) => me && setRestricted(me.restricted === true))
      }),
    []
  )
  // 0.7.3 quiet hours: loaded at start and whenever the account changes on another device.
  useEffect(() => {
    const load = (): void =>
      void quietHoursApi.get().then((r) => r.ok && setQuietHours(r.data.quietHours))
    load()
    const off = window.glofly.onEvent((event) => {
      if (event.type === 'account:changed') load()
    })
    return () => {
      off()
      setQuietHours(null)
    }
  }, [])
  const onUserChangeRef = useRef(onUserChange)
  useEffect(() => {
    onUserChangeRef.current = onUserChange
  })
  useEffect(() => {
    openChatRef.current = openChatId
  }, [openChatId])
  const incomingSeen = useRef<number | null>(null)
  /** Requests already seen (so only new ones get a notification) */
  const requestIds = useRef<Set<string> | null>(null)
  /** Messages notified per chat since you last read it ("+2 more") */
  const unseen = useRef(new Map<string, number>())
  const conversationsRef = useRef<ConversationSummary[]>([])
  useEffect(() => {
    conversationsRef.current = conversations
  })

  const refreshFriends = useCallback(async () => {
    const result = await window.glofly.friends.list()
    if (result.ok) {
      // A new friend request since last time? Play the friend-request sound.
      const count = result.data.incoming.length
      if (incomingSeen.current !== null && count > incomingSeen.current) playSound('friendRequest')
      incomingSeen.current = count
      // …and a Windows notification for each new one (while you're elsewhere).
      const before = requestIds.current
      requestIds.current = new Set(result.data.incoming.map((p) => p.id))
      if (before && shouldNotify()) {
        for (const p of result.data.incoming.filter((x) => !before.has(x.id))) {
          void notify(
            {
              key: `request:${p.id}`,
              conversationId: null,
              title: p.displayName,
              body: `@${p.username} sent you a friend request`
            },
            p
          )
        }
      }
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

  // Several refreshes can overlap (say, a burst of changes): only the newest one counts.
  const conversationsRequest = useRef(0)
  /** Bumped by live changes to the list (new messages, edits, "Seen") */
  const liveChanges = useRef(0)
  const refreshConversations = useCallback(async () => {
    const load = async (retry: boolean): Promise<void> => {
      const mine = ++conversationsRequest.current
      const seen = liveChanges.current
      const result = await window.glofly.conversations.list()
      if (mine !== conversationsRequest.current) return
      // A live change arrived while this was loading, so the answer may be from before it
      // (it would undo a new message or unread count): ask once more instead.
      if (result.ok && retry && liveChanges.current !== seen) return load(false)
      if (result.ok) setConversations(result.data)
      else if (result.error === 'unauthorized') onSessionExpired()
      setChatsLoaded(true)
    }
    await load(true)
  }, [onSessionExpired])

  const refreshNotices = useCallback(async () => {
    const result = await window.glofly.notices.list()
    if (!result.ok) return
    setTeamNotices(result.data.notices)
    setAnnouncement(result.data.announcement)
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([refreshFriends(), refreshConversations()])
  }, [refreshFriends, refreshConversations])

  // Messages from the Glofly team and the banner: on sign-in, and after reconnecting.
  useEffect(() => {
    window.glofly.notices.list().then((result) => {
      if (!result.ok) return
      setTeamNotices(result.data.notices)
      setAnnouncement(result.data.announcement)
    })
  }, [])

  /**
   * A Windows notification for a new message: who sent it and what it says (or "New message"
   * with previews off). One per chat; more messages update it ("+2 more").
   */
  const notifyMessage = useCallback((m: Message, people?: PublicUser[]) => {
    const chat = conversationsRef.current.find((c) => c.id === m.conversationId)
    const sender =
      chat?.members.find((p) => p.id === m.senderId) ??
      people?.find((p) => p.id === m.senderId) ??
      null
    const name = sender?.displayName ?? 'Someone'
    const count = (unseen.current.get(m.conversationId) ?? 0) + 1
    unseen.current.set(m.conversationId, count)
    const text = (shortBody(m.body) || attachmentSummary(m.attachments)).replace(/\s+/g, ' ').trim()
    const more = count > 1 ? ` · +${count - 1} more` : ''
    void notify(
      {
        key: m.conversationId,
        conversationId: m.conversationId,
        title: chat?.kind === 'group' ? `${name} · ${chatTitle(chat)}` : name,
        body: previewsOn() ? `${text}${more}` : count > 1 ? `${count} new messages` : 'New message'
      },
      sender
    )
  }, [])

  // The number on the taskbar icon / Dock: how many chats have something unread, like the
  // sidebar shows them (0.7.4; it used to add up messages). A muted chat only counts when it
  // has an unread @mention of you.
  const unreadTotal = conversations.filter(
    (c) => c.unreadCount > 0 && (!isMuted(c) || (c.mentionCount ?? 0) > 0)
  ).length
  useEffect(() => {
    window.glofly.notifications.badge(unreadTotal, unreadTotal > 0 ? badgeImage(unreadTotal) : null)
  }, [unreadTotal])

  // Live updates from the server.
  useEffect(() => {
    return window.glofly.onEvent((event) => {
      switch (event.type) {
        case 'message:new': {
          // 2.0: nebula messages belong to Constellations (its own alerts below), not your chats.
          if (event.nebula) break
          liveChanges.current++
          const m = event.message
          const viewing = openChatRef.current === m.conversationId && document.hasFocus()
          // Group events ("Maya renamed the group") don't ding or count as unread.
          const fromOthers = m.senderId !== user.id && !m.event
          // A muted chat stays quiet, unless the message @mentions you.
          const chat = conversationsRef.current.find((c) => c.id === m.conversationId)
          const mentioned = fromOthers && mentionsMe(m, user.id)
          const quiet = !!chat && isMuted(chat) && !mentioned
          if (fromOthers && !viewing && !quiet) playSound('message')
          if (fromOthers && !quiet && shouldNotify()) notifyMessage(m, event.people)
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
                fromOthers && openChatRef.current !== m.conversationId
                  ? existing.unreadCount + 1
                  : existing.unreadCount,
              mentionCount:
                mentioned && openChatRef.current !== m.conversationId
                  ? (existing.mentionCount ?? 0) + 1
                  : existing.mentionCount
            }
            return [updated, ...list.filter((c) => c.id !== m.conversationId)]
          })
          break
        }
        case 'message:updated': {
          liveChanges.current++
          // Keep the sidebar preview in step with edits and deletes of the latest message.
          const m = event.message
          setConversations((list) =>
            list.map((c) => (c.lastMessage?.id === m.id ? { ...c, lastMessage: m } : c))
          )
          break
        }
        case 'presence': {
          const { userId, status, statusText, lastSeenAt, activity, mobile } = event
          if (userId === user.id) {
            // Your own status changed (maybe from another device): refresh what you picked.
            window.glofly.status.get().then((result) => {
              if (result.ok) setMyStatus(result.data)
            })
          } else {
            setPresence((map) => ({
              ...map,
              [userId]: {
                status,
                statusText,
                lastSeenAt,
                activity: activity ?? null,
                mobile: mobile === true
              }
            }))
          }
          break
        }
        case 'conversation:read': {
          liveChanges.current++
          // They read the chat: update "Seen".
          const { conversationId, readAt } = event
          setConversations((list) =>
            list.map((c) =>
              c.id === conversationId && c.kind === 'dm' ? { ...c, partnerReadAt: readAt } : c
            )
          )
          break
        }
        case 'conversations:changed':
          void refreshConversations()
          break
        // 0.7.3: marked unread (here or on another device): its count comes back.
        case 'conversation:unread':
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
        case 'hang:ping': {
          // A friend is free to hang: a gentle card with Call and Message.
          const who = friendsRef.current.find((f) => f.id === event.userId)
          if (!who) break
          playSound('friendOnline')
          setHangPing(who)
          if (shouldNotify()) {
            void notify(
              {
                key: `hang:${who.id}`,
                conversationId: null,
                title: who.displayName,
                body: 'is free to hang for the next hour'
              },
              who
            )
          }
          break
        }
        case 'friend:online': {
          // "Notify me when they come online" (the server already skipped Do not disturb).
          const who = event.user
          playSound('friendOnline')
          setToast(`${who.displayName} is online`)
          if (shouldNotify()) {
            void notify(
              {
                key: `online:${who.id}`,
                conversationId: null,
                title: who.displayName,
                body: 'is online'
              },
              who
            )
          }
          break
        }
        case 'friend:joined': {
          // Someone joined Glofly from your invite: you're friends now.
          const who = event.user
          playSound('friendRequest')
          setToast(`${who.displayName} joined Glofly from your invite. You're friends now!`)
          if (shouldNotify()) {
            void notify(
              {
                key: `joined:${who.id}`,
                conversationId: null,
                title: who.displayName,
                body: 'joined Glofly from your invite. You’re friends now!'
              },
              who
            )
          }
          void refresh()
          break
        }
        case 'connection':
          setConnected(event.connected)
          if (event.connected) {
            setShowReconnecting(false)
            retryOffline() // messages that failed while the connection was down go again
            void refresh() // catch up on anything missed while offline
            void refreshNotices()
          }
          break
        case 'notice:new':
          setTeamNotices((list) =>
            list.some((n) => n.id === event.notice.id) ? list : [...list, event.notice]
          )
          break
        case 'announcement':
          setAnnouncement(event.announcement)
          break
        case 'session:expired':
          onSessionExpired()
          break
        case 'constellation:activity': {
          nebulaChats.current.set(event.conversationId, {
            constellationId: event.constellationId,
            nebulaId: event.nebulaId
          })
          if (!event.alert || event.senderId === user.id) break
          const looking =
            viewingNebula.conversationId === event.conversationId && document.hasFocus()
          if (looking) break
          playSound('constellationMessage')
          if (shouldNotify()) {
            const where = `#${event.nebulaName ?? ''}`
            void notify(
              {
                key: `nebula:${event.conversationId}`,
                conversationId: event.conversationId,
                title: `${event.senderName ?? 'Someone'} · ${where}`,
                body: previewsOn()
                  ? `${event.constellationName ? `${event.constellationName}: ` : ''}${event.preview ?? ''}`
                  : event.alert === 'mention'
                    ? `Mentioned you in ${event.constellationName ?? 'a constellation'}`
                    : `New message in ${event.constellationName ?? 'a constellation'}`
              },
              null
            )
          }
          break
        }
        case 'notification:click':
          // 2.0: a nebula's notification opens Constellations right at that nebula.
          if (event.conversationId && nebulaChats.current.has(event.conversationId)) {
            cxEnterRef.current(nebulaChats.current.get(event.conversationId)!)
            break
          }
          // Glofly is already in front: open the chat (or Friends → Pending for a request).
          if (event.conversationId) setOpenChatId(event.conversationId)
          else {
            setOpenChatId(null)
            setPage('friends')
            setFilter('pending')
          }
          break
      }
    })
  }, [user.id, refresh, refreshConversations, refreshNotices, onSessionExpired, notifyMessage])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  /** Calls a friend: their chat opens with the call at the top. */
  async function callFriend(userId: string, video: boolean): Promise<void> {
    let chat = conversations.find((c) => c.kind === 'dm' && c.partner.id === userId)
    if (!chat) {
      const result = await window.glofly.conversations.openDm(userId)
      if (!result.ok) {
        if (result.error === 'unauthorized') onSessionExpired()
        else setToast(result.message)
        return
      }
      chat = result.data
      const opened = chat
      setConversations((list) => (list.some((c) => c.id === opened.id) ? list : [opened, ...list]))
    }
    if (chat.kind !== 'dm') return
    setOpenChatId(chat.id)
    callControls.current?.start(chat, video)
  }

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

  // 0.7.5: Ctrl+K (⌘K on a Mac) opens the quick switcher from anywhere (in a browser too: the
  // page takes the key before the browser's own search), and Ctrl+/ the shortcut sheet.
  const [quickOpen, setQuickOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!isShortcutKey(e) || e.altKey) return
      if (e.key.toLowerCase() === 'k' && !e.shiftKey) {
        e.preventDefault()
        setShortcutsOpen(false)
        setQuickOpen((open) => !open)
      } else if (e.key === '/' || e.code === 'Slash') {
        e.preventDefault()
        setQuickOpen(false)
        setShortcutsOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Recent places for the quick switcher: the chats you open.
  useEffect(() => {
    if (openChatId) noteRecent(user.id, { kind: 'chat', id: openChatId })
  }, [openChatId, user.id])

  const chatResults = findChats(chatQuery, conversations, lists?.friends ?? [])

  /** Opens a search result: its chat, or a new chat with that friend. */
  function openResult(r: ChatResult): void {
    setChatQuery('')
    setHighlighted(0)
    chatSearchRef.current?.blur()
    if (r.conversation) setOpenChatId(r.conversation.id)
    else if (r.kind === 'person') void openChatWith(r.user.id)
  }

  function onChatSearchKey(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'ArrowDown' && chatResults.length) {
      e.preventDefault()
      setHighlighted((i) => (i + 1) % chatResults.length)
    } else if (e.key === 'ArrowUp' && chatResults.length) {
      e.preventDefault()
      setHighlighted((i) => (i - 1 + chatResults.length) % chatResults.length)
    } else if (e.key === 'Enter' && chatResults[highlighted]) {
      e.preventDefault()
      openResult(chatResults[highlighted])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setChatQuery('')
      setHighlighted(0)
      e.currentTarget.blur()
    }
  }

  /** Pins or unpins a chat (shown right away; put back if the server says no). */
  async function togglePin(c: ConversationSummary): Promise<void> {
    const pinnedAt = c.pinnedAt ? null : new Date().toISOString()
    setConversations((list) => list.map((x) => (x.id === c.id ? { ...x, pinnedAt } : x)))
    const result = await window.glofly.conversations.pin(c.id, !c.pinnedAt)
    if (result.ok) return
    setConversations((list) =>
      list.map((x) => (x.id === c.id ? { ...x, pinnedAt: c.pinnedAt } : x))
    )
    if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
  }

  /** Mutes or unmutes a chat (shown right away; put back if the server says no). */
  async function muteChat(c: ConversationSummary, duration: MuteDuration | null): Promise<void> {
    const mutedUntil = duration ? muteUntil(duration) : null
    setConversations((list) => list.map((x) => (x.id === c.id ? { ...x, mutedUntil } : x)))
    const result = await window.glofly.conversations.mute(c.id, duration)
    if (result.ok) {
      setConversations((list) =>
        list.map((x) => (x.id === c.id ? { ...x, mutedUntil: result.data.mutedUntil } : x))
      )
      // Muting also quiets a notification that's already showing for it.
      if (duration) clearNotification(c.id)
      return
    }
    setConversations((list) =>
      list.map((x) => (x.id === c.id ? { ...x, mutedUntil: c.mutedUntil ?? null } : x))
    )
    if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
  }

  /**
   * Closes a chat in the sidebar: hidden (and marked read) until a new message arrives or it's
   * opened again. Nothing is deleted. Shown right away; put back if the server says no.
   */
  async function closeChat(c: ConversationSummary): Promise<void> {
    if (c.pinnedAt) return
    if (openChatId === c.id) setOpenChatId(null)
    const closedAt = new Date().toISOString()
    setConversations((list) =>
      list.map((x) => (x.id === c.id ? { ...x, closedAt, unreadCount: 0, mentionCount: 0 } : x))
    )
    clearNotification(c.id)
    const result = await window.glofly.conversations.close(c.id, true)
    if (result.ok) return
    setConversations((list) =>
      list.map((x) =>
        x.id === c.id
          ? {
              ...x,
              closedAt: c.closedAt ?? null,
              unreadCount: c.unreadCount,
              mentionCount: c.mentionCount
            }
          : x
      )
    )
    if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
  }

  /** Saves a new order for the pinned chats (shown right away; put back if the server says no). */
  async function reorderPins(ids: string[]): Promise<void> {
    const before = conversations
    // Same as the server: the pins get new pinned times in this order, from the earliest one.
    const times = conversations
      .filter((c) => c.pinnedAt && ids.includes(c.id))
      .map((c) => Date.parse(c.pinnedAt!))
    if (times.length === 0) return
    const base = Math.min(...times)
    setConversations((list) =>
      list.map((c) => {
        const i = ids.indexOf(c.id)
        return c.pinnedAt && i >= 0 ? { ...c, pinnedAt: new Date(base + i).toISOString() } : c
      })
    )
    const result = await window.glofly.conversations.orderPins(ids)
    if (result.ok) return
    setConversations(before)
    if (result.error === 'unauthorized') onSessionExpired()
    else setNotice(result.message)
  }

  /** Saves a new order for the Groups page (shown right away; put back if the server says no). */
  async function reorderGroups(ids: string[]): Promise<void> {
    const before = conversations
    setConversations((list) =>
      list.map((c) => {
        const i = ids.indexOf(c.id)
        return c.kind === 'group' && i >= 0 ? { ...c, groupPosition: i } : c
      })
    )
    const result = await window.glofly.conversations.orderGroups(ids)
    if (result.ok) {
      setGroupsNotice(null)
      return
    }
    setConversations(before)
    if (result.error === 'unauthorized') onSessionExpired()
    else setGroupsNotice(result.message)
  }

  /** A new or changed chat from the server: put it in the list (and open it, if asked). */
  function gotConversation(conversation: ConversationSummary, open: boolean): void {
    setConversations((list) => [conversation, ...list.filter((c) => c.id !== conversation.id)])
    if (open) setOpenChatId(conversation.id)
  }

  async function leaveGroup(): Promise<void> {
    if (!leaving) return
    setLeaveBusy(true)
    const result = await window.glofly.conversations.removeMember(leaving.id, user.id)
    setLeaveBusy(false)
    if (!result.ok) {
      if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
      setLeaving(null)
      return
    }
    const id = leaving.id
    setLeaving(null)
    setSettingsFor((s) => (s === id ? null : s))
    setConversations((list) => list.filter((c) => c.id !== id))
    setOpenChatId((open) => (open === id ? null : open))
  }

  /** Someone's profile card (your own opens Edit profile). */
  function viewPerson(person: PublicUser): void {
    if (person.id === user.id) setEditingProfile(true)
    else setViewing(person)
  }

  const markedRead = useCallback((conversationId: string) => {
    // Read: its notification goes, and the next one starts counting again.
    unseen.current.delete(conversationId)
    clearNotification(conversationId)
    setConversations((list) =>
      list.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0, mentionCount: 0 } : c))
    )
  }, [])

  /** From the night side: the swarm carries you home, then this happens. */
  const homeThen = (then?: () => void): void => {
    cx.leave()
    then?.()
  }
  // 0.7.5 Constellations polish: an invite card's Join / Open shows that constellation, the
  // member card's Call calls them, and Glofly in a browser opened from an invite page's "use it
  // in your browser" (?join=<code>) shows that invite.
  const cxEventsRef = useRef<{ cxOpen: (id: string) => void; call: (id: string) => void } | null>(
    null
  )
  useEffect(() => {
    cxEventsRef.current = {
      cxOpen: (id) => {
        cxCards.reload()
        cx.enter(cxNavRef.current, { constellationId: id, nebulaId: null })
      },
      call: (id) => homeThen(() => void callFriend(id, false))
    }
  })
  useEffect(() => {
    const open = (e: Event): void => {
      const id = (e as CustomEvent<{ constellationId?: unknown }>).detail?.constellationId
      if (typeof id === 'string') cxEventsRef.current?.cxOpen(id)
    }
    const call = (e: Event): void => {
      const id = (e as CustomEvent<{ userId?: unknown }>).detail?.userId
      if (typeof id === 'string') cxEventsRef.current?.call(id)
    }
    window.addEventListener('glofly:cx-open', open)
    window.addEventListener('glofly:call-person', call)
    return () => {
      window.removeEventListener('glofly:cx-open', open)
      window.removeEventListener('glofly:call-person', call)
    }
  }, [])
  const [joinCode, setJoinCode] = useState<string | null>(() => {
    try {
      const code = new URLSearchParams(window.location.search).get('join')
      return code && /^[A-Za-z0-9]{6,16}$/.test(code) ? code : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    if (!joinCode) return
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('join')
      window.history.replaceState(null, '', url.toString())
    } catch {
      /* not a page with an address (the desktop app) */
    }
  }, [joinCode])

  /** A call bar was clicked: a nebula's voice opens Constellations, anything else its chat. */
  const openFromCall = (conversationId: string): void => {
    const current = callControls.current?.current
    const chat = current?.chat
    if (chat?.kind === 'nebula' && chat.nebula && current?.conversationId === conversationId) {
      cx.enter(cxNavRef.current, {
        constellationId: chat.nebula.constellationId,
        nebulaId: chat.nebula.nebulaId
      })
    } else setOpenChatId(conversationId)
  }

  const openChat = conversations.find((c) => c.id === openChatId) ?? null

  // Opening a closed chat from anywhere (search, Friends, Groups, a notification) puts it back
  // in the sidebar, here and on my other devices.
  const reopenId = openChat && isClosed(openChat) ? openChat.id : null
  useEffect(() => {
    if (!reopenId) return
    // The open chat always shows in the sidebar; the server's conversations:changed refreshes
    // the list for this device and the others.
    void window.glofly.conversations.close(reopenId, false)
  }, [reopenId])
  const settingsGroup = conversations.find((c) => c.id === settingsFor && c.kind === 'group')
  const pickerGroup = groupPicker?.groupId
    ? conversations.find((c) => c.id === groupPicker.groupId && c.kind === 'group')
    : undefined

  // 0.7.4: Jump List (Windows) / Dock menu (Mac) actions. Glofly may have been started by one,
  // so take() once now and again on each `shortcut` event (null: already handled).
  const doShortcut = useRef<(action: ShortcutAction) => void>(() => {})
  // Kept current after each render (its handlers read the latest state).
  useEffect(() => {
    doShortcut.current = (action) => {
      if (action === 'new-message') {
        setOpenChatId(null)
        setPage('friends')
        setFilter('all')
        setNarrowList(false)
      } else if (action === 'quiet-hours') {
        setSettingsFocus('quiet-hours')
        setSettingsOpen('general')
      } else void changeStatus({ status: action.slice('status:'.length) as MyStatus['status'] })
    }
  })
  useEffect(() => {
    const take = (): void =>
      void window.glofly.shortcuts
        .take()
        .then((action) => action && doShortcut.current(action))
        .catch(() => {})
    take()
    return window.glofly.onEvent((event) => {
      if (event.type === 'shortcut') take()
    })
  }, [])

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

  /** The bell on a friend's profile: "Notify me when they come online" (0.3.0). */
  async function toggleOnlineAlert(id: string, on: boolean): Promise<void> {
    const flip = (value: boolean): void =>
      setLists((l) =>
        l
          ? {
              ...l,
              friends: l.friends.map((f) => (f.id === id ? { ...f, onlineAlert: value } : f))
            }
          : l
      )
    flip(on) // right away
    const result = await window.glofly.friends.setOnlineAlert(id, on)
    if (!result.ok) {
      flip(!on)
      if (result.error === 'unauthorized') onSessionExpired()
      else setToast(result.message)
    }
  }
  const friends = (lists?.friends ?? [])
    .map((p) => ({ ...p, presence: presence[p.id] ?? p.presence }))
    .filter((p) => matches(p, search))
  const isOnline = (p: FriendEntry): boolean => (p.presence?.status ?? 'offline') !== 'offline'
  const onlineFriends = friends.filter(isOnline)
  const offlineFriends = friends.filter((p) => !isOnline(p))
  const incoming = (lists?.incoming ?? []).filter((p) => matches(p, search))
  const outgoing = (lists?.outgoing ?? []).filter((p) => matches(p, search))
  const blocked = (lists?.blocked ?? []).filter((p) => matches(p, search))
  // A restricted (family-managed) account doesn't add or remove friends: their family does.
  const openAdd = restricted ? undefined : (): void => setAdding('search')
  const searching = search.trim().length > 0

  function renderTab(): React.ReactNode {
    // First load: shaped placeholders (after a moment) rather than a flash of "no friends".
    if (!lists) return <ListSkeleton rows={7} label="Loading friends" />

    const friendRows = (people: FriendEntry[]): React.ReactNode =>
      people.map((p) => (
        <FriendRow
          key={p.id}
          person={p}
          now={now}
          onRemove={restricted ? undefined : () => setConfirm({ kind: 'remove', person: p })}
          onBlock={() => setConfirm({ kind: 'block', person: p })}
          onMessage={() => void openChatWith(p.id)}
          onCall={(video) => void callFriend(p.id, video)}
          onViewProfile={() => setViewing(p)}
        />
      ))

    // 0.7.5: a search that finds no friend offers to look the name up on Glofly.
    const noMatch = (): React.ReactNode => {
      const name = search.trim().replace(/^@/, '')
      return (
        <EmptyScene
          kind="search"
          layout="small"
          title={`No friend called “${search.trim()}”`}
          text={
            restricted
              ? 'Check the spelling. Your family adds new friends for you.'
              : 'Check the spelling, or look them up by their username to send a friend request.'
          }
        >
          {!restricted && /^[a-z0-9._-]{2,}$/i.test(name) && (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setAddQuery(name)
                setAdding('search')
              }}
            >
              Find @{name}
            </button>
          )}
        </EmptyScene>
      )
    }

    if (filter === 'online' || filter === 'offline') {
      const people = filter === 'online' ? onlineFriends : offlineFriends
      if (people.length === 0) {
        if (searching) return noMatch()
        return filter === 'online' ? (
          <EmptyState
            title="Nobody online right now"
            text={
              lists.friends.length
                ? "When friends are online, away or busy, they'll show up here."
                : restricted
                  ? 'Friends your family adds will show up here when they’re around.'
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
      // 0.7.5: no friends yet: a firefly waiting for a friend, with Add a friend and invite.
      if (lists.friends.length === 0) {
        return restricted ? (
          <EmptyScene
            kind="friends"
            title="No friends yet"
            text="Your family adds your friends for you. They’ll show up here."
          />
        ) : (
          <EmptyScene
            kind="friends"
            title="Every glow starts with one friend"
            text="Add someone by their username, or invite them by email. You’ll automatically be friends as soon as they join."
          >
            <button type="button" className="primary-button" onClick={openAdd}>
              <AddFriendIcon />
              Add a friend
            </button>
            <button type="button" className="scene-button" onClick={() => setAdding('invite')}>
              Invite by email
            </button>
          </EmptyScene>
        )
      }
      if (friends.length === 0) return noMatch()
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
    <CallProvider
      me={user}
      conversations={conversations}
      friends={lists?.friends ?? NO_FRIENDS}
      onCallMoved={(from, toId, to) => {
        // Add people (0.5.2): the call is in a new group now. Showing the old chat? Show the group.
        if (to)
          setConversations((list) => (list.some((c) => c.id === to.id) ? list : [to, ...list]))
        setOpenChatId((open) => (open === from ? toId : open))
        void refreshConversations()
      }}
      onOpenChat={setOpenChatId}
      onNotice={setToast}
      onSessionExpired={onSessionExpired}
      controlsRef={callControls}
    >
      <div
        className={[
          'main',
          cx.homeClass || (cxUsed ? '' : 'main--enter'),
          narrowList ? 'main--narrow-list' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        style={
          { '--cx-ox': `${cx.origin.x}px`, '--cx-oy': `${cx.origin.y}px` } as React.CSSProperties
        }
        aria-hidden={cxOpen ? true : undefined}
      >
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="sidebar-logo" aria-hidden="true">
              <img src={fireflyImg} alt="" draggable={false} />
            </div>
            <div className="search">
              <SearchIcon />
              <input
                ref={chatSearchRef}
                type="search"
                className="search-input"
                aria-label="Find a friend or chat"
                placeholder="Find a friend or chat"
                title={`Find a friend or chat. ${shortcutLabel('K')} jumps anywhere`}
                role="combobox"
                aria-expanded={chatQuery.trim().length > 0}
                aria-controls="chat-search-results"
                aria-activedescendant={
                  chatResults.length > 0 ? `chat-result-${highlighted}` : undefined
                }
                autoComplete="off"
                spellCheck={false}
                maxLength={40}
                value={chatQuery}
                onChange={(e) => {
                  setChatQuery(e.target.value)
                  setHighlighted(0)
                }}
                onKeyDown={onChatSearchKey}
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
              onOpenSettings={() => setSettingsOpen('general')}
              onEditProfile={() => setEditingProfile(true)}
              onYearInGlow={() => setYearOpen(true)}
              onMyGames={() => setMyGamesOpen(true)}
            />
            {statusOpen && (
              <StatusMenu
                current={myStatus}
                onChange={changeStatus}
                onClose={() => setStatusOpen(false)}
              />
            )}
          </div>

          <nav className="sidebar-nav" aria-label="Main">
            <button
              type="button"
              className={!openChat && page === 'friends' ? 'nav-item nav-item--active' : 'nav-item'}
              aria-current={!openChat && page === 'friends' ? 'page' : undefined}
              onClick={() => {
                openFromList(null)
                setPage('friends')
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
            <button
              type="button"
              className={!openChat && page === 'groups' ? 'nav-item nav-item--active' : 'nav-item'}
              aria-current={!openChat && page === 'groups' ? 'page' : undefined}
              onClick={() => {
                openFromList(null)
                setPage('groups')
              }}
            >
              <GroupIcon />
              Groups
            </button>
            {!restricted && (
              <button
                ref={cxNavRef}
                type="button"
                className="nav-item cx-nav"
                aria-label={cxNew ? 'Constellations, new activity' : 'Constellations'}
                onClick={() =>
                  // 0.7.1: in a constellation already: a quick hop back to the one you had
                  // open last. Not in any yet: the full swipe to the dashboard.
                  cx.enter(
                    cxNavRef.current,
                    lastPlaceIn(
                      user.id,
                      cxCards.cards.map((c) => c.id)
                    )
                  )
                }
              >
                <GalaxyIcon />
                Constellations
                {cxNew && <span className="cx-nav-dot" aria-hidden="true" />}
              </button>
            )}
          </nav>

          <SocialActions
            friends={lists?.friends ?? []}
            now={now}
            live={
              myLive.status === 'live'
                ? { viewers: social.broadcasts.find((b) => b.userId === user.id)?.viewers ?? 0 }
                : null
            }
            onGoLive={() => setGoLive(true)}
            onManageLive={() => setLivePanel(true)}
          />

          <CallStrip openChatId={openChatId} onOpenChat={openFromCall} />

          <SocialStrip
            people={friendsById}
            meId={user.id}
            now={now}
            onWatch={setWatchingId}
            onCall={(id) => void callFriend(id, false)}
            onMessage={(id) => void openChatWith(id)}
          />

          <ChatList
            me={user}
            conversations={conversations}
            loaded={chatsLoaded}
            presence={presence}
            now={now}
            openChatId={openChatId}
            query={chatQuery}
            results={chatResults}
            highlighted={highlighted}
            onOpen={openFromList}
            onOpenResult={openResult}
            onTogglePin={(c) => void togglePin(c)}
            onViewProfile={viewPerson}
            onGroupSettings={(c) => setSettingsFor(c.id)}
            onLeaveGroup={setLeaving}
            onMute={(c, d) => void muteChat(c, d)}
            onCloseChat={(c) => void closeChat(c)}
            onReorderPins={(ids) => void reorderPins(ids)}
            onNewMessage={() => {
              setOpenChatId(null)
              setPage('friends')
              setFilter('all')
            }}
            onNewGroup={() => setGroupPicker({ groupId: null })}
            onSearchMessages={(q) => setMessageSearch({ chatId: null, query: q })}
            onFindUsername={
              restricted
                ? undefined
                : (name) => {
                    setAddQuery(name)
                    setAdding('search')
                  }
            }
          />
        </aside>

        <main className="content">
          {/* Narrow windows only (hidden otherwise): back to the list. */}
          <button type="button" className="narrow-back" onClick={() => setNarrowList(true)}>
            <ChevronIcon direction="left" size={20} />
            Chats
            {unreadTotal > 0 && (
              <span className="badge">{unreadTotal > 99 ? '99+' : unreadTotal}</span>
            )}
          </button>
          {/* 0.7.4: one bar at a time, most important first (MainScreen.css .top-banners). */}
          <div className="top-banners">
            <AnnouncementBar announcement={announcement} />
            <UpdateBar />
            <ConfirmEmailBar
              userId={user.id}
              onChangeEmail={() => setSettingsOpen('account')}
              onSessionExpired={onSessionExpired}
            />
            {isWeb && <WebNotifyBar />}
          </div>
          {watchingId && friendsById.get(watchingId) && (
            <BroadcastViewer
              person={friendsById.get(watchingId)!}
              onClose={() => setWatchingId(null)}
            />
          )}
          {messageSearch && (
            <SearchPanel
              me={user}
              conversations={conversations}
              chatId={messageSearch.chatId}
              initialQuery={messageSearch.query}
              onClose={() => setMessageSearch(null)}
              onOpen={(conversationId, messageId) => {
                setOpenChatId(conversationId)
                setJump((j) => ({ conversationId, messageId, nonce: (j?.nonce ?? 0) + 1 }))
              }}
            />
          )}
          {showReconnecting && !connected && (
            <div className="connection-banner" role="status">
              <span className="connection-banner-dot" aria-hidden="true" />
              Reconnecting to Glofly…
            </div>
          )}
          {openChat ? (
            <ChatView
              key={openChat.id}
              me={user}
              conversation={openChat}
              presence={presence}
              now={now}
              onRead={markedRead}
              onViewProfile={viewPerson}
              onGroupSettings={() => setSettingsFor(openChat.id)}
              onLeave={() => {
                setOpenChatId(null)
                void refreshConversations()
              }}
              onTogglePin={() => void togglePin(openChat)}
              onSessionExpired={onSessionExpired}
              onSearch={() => searchThisChat(openChat.id)}
              onMute={(d) => void muteChat(openChat, d)}
              onReport={(m) => {
                const sender = openChat.members.find((p) => p.id === m.senderId)
                if (!sender) return
                setReporting({
                  person: sender,
                  message: {
                    id: m.id,
                    conversationId: m.conversationId,
                    preview: (shortBody(m.body) || attachmentSummary(m.attachments)).slice(0, 300)
                  }
                })
              }}
              jumpRequest={
                jump && jump.conversationId === openChat.id
                  ? { messageId: jump.messageId, nonce: jump.nonce }
                  : null
              }
            />
          ) : page === 'groups' ? (
            <GroupsPage
              me={user}
              conversations={conversations}
              presence={presence}
              notice={groupsNotice}
              onOpen={openFromList}
              onNewGroup={() => setGroupPicker({ groupId: null })}
              onTogglePin={(g) => void togglePin(g)}
              onGroupSettings={(g) => setSettingsFor(g.id)}
              onLeave={setLeaving}
              onReorder={(ids) => void reorderGroups(ids)}
              extraMenu={(g, close) => (
                <MuteMenuItems
                  conversation={g}
                  onMute={(d) => void muteChat(g, d)}
                  onClose={close}
                />
              )}
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
                {openAdd ? (
                  <button type="button" className="primary-button add-friend" onClick={openAdd}>
                    <AddFriendIcon />
                    Add friend
                  </button>
                ) : (
                  <span className="family-managed">Friends are managed by your family</span>
                )}
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
      </div>

      {/* The floating call video, over Glofly home and (Oct 17) over Constellations too: it sits
          outside the home layer, which slides away when the night side opens. */}
      <CallFloat
        openChatId={cxOpen ? null : openChatId}
        night={cxOpen}
        onOpenChat={(id) => (cxOpen ? homeThen(() => openFromCall(id)) : openFromCall(id))}
      />
      <ConstellationsScreen
        phase={cx.phase}
        quick={cx.quick}
        origin={cx.origin}
        start={cx.start}
        me={user}
        myStatus={myStatus}
        onChangeStatus={changeStatus}
        presence={presence}
        friends={lists?.friends ?? []}
        conversations={conversations}
        now={now}
        cards={cxCards.cards}
        invites={cxCards.invites}
        loaded={cxCards.loaded}
        reloadCards={cxCards.reload}
        onHome={() => homeThen()}
        onOpenChat={(id) => homeThen(() => setOpenChatId(id))}
        onCall={(c) =>
          homeThen(() => {
            setOpenChatId(c.id)
            callControls.current?.start(c, false)
          })
        }
        onMessage={(person) => homeThen(() => void openChatWith(person.id))}
        onRead={markedRead}
        onStartDm={async (person) => {
          const existing = conversations.find((c) => c.kind === 'dm' && c.partner.id === person.id)
          if (existing) return existing.id
          const result = await window.glofly.conversations.openDm(person.id)
          if (!result.ok) {
            if (result.error === 'unauthorized') onSessionExpired()
            else setToast(result.message)
            return null
          }
          const opened = result.data
          setConversations((list) =>
            list.some((c) => c.id === opened.id) ? list : [opened, ...list]
          )
          return opened.id
        }}
        onViewProfile={viewPerson}
        onReport={(m, sender) =>
          setReporting({
            person: sender,
            message: {
              id: m.id,
              conversationId: m.conversationId,
              preview: (shortBody(m.body) || attachmentSummary(m.attachments)).slice(0, 300)
            }
          })
        }
        onAppSettings={() => setSettingsOpen('general')}
        onSessionExpired={onSessionExpired}
      />

      {!restricted && joinCode && (
        <InviteJoinDialog code={joinCode} onClose={() => setJoinCode(null)} onProblem={setToast} />
      )}

      {/* 0.8.0: "Game Night starts in 15 min" / "is starting · Join Campfire" */}
      {!restricted && (
        <EventToasts meId={user.id} onOpen={(place) => cx.enter(cxNavRef.current, place)} />
      )}

      {!restricted && (
        <InvitePopup
          onJoined={(id) => {
            cxCards.reload()
            cx.enter(cxNavRef.current, { constellationId: id, nebulaId: null })
          }}
          onProblem={setToast}
        />
      )}

      {cx.phase === 'home' && !restricted && cxCards.cards.length > 0 && (
        <HomeDock
          handleRef={homeDock}
          me={user}
          cards={cxCards.cards}
          pins={cxPins.pins}
          onPins={cxPins.setPins}
          onEnter={(place) => cx.enter(cxNavRef.current, place)}
          onCardsChanged={() => {
            cxCards.reload()
            cxPins.reload()
          }}
          onProblem={setToast}
        />
      )}

      <div className="main-dialogs">
        {myGamesOpen && (
          <div
            className="dialog-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setMyGamesOpen(false)}
          >
            <div className="mg-alone">
              <MyGamesPanel
                userId={user.id}
                name={user.displayName}
                isMe
                onClose={() => setMyGamesOpen(false)}
              />
            </div>
          </div>
        )}
        {welcoming && !restricted && (
          <WelcomeFlow
            user={user}
            onUserChange={onUserChange}
            onFriendsChanged={refresh}
            onSessionExpired={onSessionExpired}
            onDone={endWelcome}
          />
        )}
        {adding && (
          <AddFriendDialog
            startAt={adding}
            initialQuery={addQuery}
            onInvited={() => noteInvited(user.id)}
            onClose={() => {
              setAdding(false)
              setAddQuery('')
            }}
            onChanged={refresh}
            onSessionExpired={onSessionExpired}
            onMessage={(userId) => {
              setAdding(false)
              void openChatWith(userId)
            }}
          />
        )}
        {groupPicker && (groupPicker.groupId === null || pickerGroup) && (
          <GroupPeopleDialog
            friends={lists?.friends ?? []}
            presence={presence}
            now={now}
            group={pickerGroup?.kind === 'group' ? pickerGroup : null}
            onDone={(conversation) => {
              setGroupPicker(null)
              gotConversation(conversation, true)
            }}
            onClose={() => setGroupPicker(null)}
            onSessionExpired={onSessionExpired}
          />
        )}
        {settingsGroup?.kind === 'group' && !groupPicker && (
          <GroupSettingsDialog
            group={settingsGroup}
            me={user}
            presence={presence}
            onRenamed={(conversation) => gotConversation(conversation, false)}
            onAddPeople={() => setGroupPicker({ groupId: settingsGroup.id })}
            onViewProfile={(person) => {
              setSettingsFor(null)
              viewPerson(person)
            }}
            onLeave={() => setLeaving(settingsGroup)}
            onClose={() => setSettingsFor(null)}
            onSessionExpired={onSessionExpired}
          />
        )}
        {leaving && (
          <ConfirmDialog
            title={`Leave ${chatTitle(leaving)}?`}
            message={
              leaving.memberCount <= 1
                ? "You're the last one here, so the group and its messages will be deleted."
                : leaving.createdBy === user.id
                  ? "You won't get its messages anymore, and whoever has been in the group longest becomes the owner. Someone in the group can add you back later."
                  : "You won't get its messages anymore. Someone in the group can add you back later."
            }
            confirmLabel="Leave group"
            danger
            busy={leaveBusy}
            onConfirm={() => void leaveGroup()}
            onCancel={() => setLeaving(null)}
          />
        )}
        {quickOpen && (
          <QuickSwitcher
            me={user}
            conversations={conversations}
            friends={lists?.friends ?? []}
            presence={presence}
            cards={restricted ? [] : cxCards.cards}
            now={now}
            onClose={() => setQuickOpen(false)}
            onOpenChat={(id) => {
              if (cx.phase !== 'home') cx.leave()
              setOpenChatId(id)
            }}
            onOpenFriend={(id) => {
              if (cx.phase !== 'home') cx.leave()
              void openChatWith(id)
            }}
            onOpenConstellation={(constellationId, nebulaId) => {
              noteRecent(user.id, { kind: 'constellation', id: constellationId })
              cx.enter(cxNavRef.current, { constellationId, nebulaId })
            }}
            onMiniNebula={
              cx.phase === 'home' && !restricted && cxCards.cards.length > 0
                ? (constellationId, nebulaId) =>
                    homeDock.current?.openNebula(constellationId, nebulaId)
                : null
            }
            onOpenSettings={(page, focus) => {
              setSettingsFocus(focus)
              setSettingsOpen(page)
            }}
          />
        )}
        {shortcutsOpen && <ShortcutSheet onClose={() => setShortcutsOpen(false)} />}
        {settingsOpen && (
          <SettingsDialog
            user={user}
            initialPage={settingsOpen}
            scrollTo={settingsFocus}
            onClose={() => {
              setSettingsOpen(false)
              setSettingsFocus(undefined)
            }}
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
            onCall={
              isFriendId(viewing.id)
                ? (video) => {
                    setViewing(null)
                    void callFriend(viewing.id, video)
                  }
                : undefined
            }
            onRemove={
              restricted
                ? undefined
                : () => {
                    setViewing(null)
                    setConfirm({ kind: 'remove', person: viewing })
                  }
            }
            onBlock={() => {
              setViewing(null)
              setConfirm({ kind: 'block', person: viewing })
            }}
            onReport={() => {
              setViewing(null)
              setReporting({ person: viewing, message: null })
            }}
            onlineAlert={lists?.friends.find((f) => f.id === viewing.id)?.onlineAlert}
            onOnlineAlert={(on) => void toggleOnlineAlert(viewing.id, on)}
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
        <GameNotice onOpenSettings={() => setSettingsOpen('general')} />
        {reporting && (
          <ReportDialog
            person={reporting.person}
            message={reporting.message}
            canBlock={!(lists?.blocked ?? []).some((b) => b.id === reporting.person.id)}
            onClose={() => setReporting(null)}
            onSessionExpired={onSessionExpired}
            onDone={(blocked) => {
              if (blocked) void refresh()
            }}
          />
        )}
        {teamNotices[0] && (
          <TeamNoticeDialog
            notice={teamNotices[0]}
            onSeen={() => {
              const id = teamNotices[0].id
              setTeamNotices((list) => list.filter((n) => n.id !== id))
              void window.glofly.notices.seen(id)
            }}
          />
        )}
        {goLive && <GoLiveDialog onClose={() => setGoLive(false)} onProblem={setToast} />}
        {livePanel && <LivePanel onClose={() => setLivePanel(false)} />}
        {yearOpen && <YearInGlowDialog onClose={() => setYearOpen(false)} />}
        {hangPing && (
          <HangToast
            person={hangPing}
            onClose={closeHangPing}
            onCall={() => {
              setHangPing(null)
              void callFriend(hangPing.id, false)
            }}
            onMessage={() => {
              setHangPing(null)
              void openChatWith(hangPing.id)
            }}
          />
        )}
        {toast && (
          <div className="call-toast" role="status">
            {toast}
            <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        )}
      </div>
    </CallProvider>
  )
}

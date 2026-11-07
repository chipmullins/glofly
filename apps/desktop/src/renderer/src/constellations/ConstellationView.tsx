import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import EmptyScene from '../components/EmptyScene'
import {
  CONSTELLATION_THEME,
  ROLE_COLORS,
  SETTINGS_PERMISSIONS,
  TIMEOUT_LENGTHS
} from '@glofly/shared/constellations'
import type {
  ConstellationCard,
  ConstellationDetail,
  ConstellationMember,
  GroupSummary,
  Message,
  MuteDuration,
  MyStatus,
  MyStatusChanges,
  Nebula,
  NotifyLevel,
  Presence,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import ChatView from '../components/ChatView'
import SearchPanel from '../components/SearchPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import StatusMenu from '../components/StatusMenu'
import { AvatarFace } from '../components/Avatar'
import StatusDot from '../components/StatusDot'
import { useCalls } from '../calls/callState'
import { api, can, outranks, topRole } from '../lib/constellations'
import {
  ChevronDown,
  ConstellationIcon,
  GearIcon,
  MicIconLine,
  PlusIcon,
  SpeakerIcon,
  StarIcon
} from './bits'
import { hexA } from './colors'
import { LockIcon, gateLabel } from './RoleVisibility'
import { FireflyMark, GalaxyIcon } from './sky'
import VoiceStage from './VoiceStage'
import { BannerArt } from './identity'
import { accentStyle, hasAccent, needsWelcome } from './communityLib'
import { MemberCardTop, MembersPanel } from './Members'
import WelcomeDialog, { YourRolesDialog } from './WelcomeDialog'
import NebulaSky from './NebulaSky'
import { sidebarOrder, starsOf } from './skyLayout'
import { scrollToNewLine, useNewSince } from './newSinceState'
import { NewSincePill } from './NewSinceParts'
import { layoutFromRows, layoutOf, rowsOf, sameRows, stepNebula, type Row } from './sidebarOrder'
import { useRowsGlide, useSidebarDrag } from './useSidebarDrag'
import { preloadConstellation } from './preload'
import { InVoiceCount, LivePreview, VoiceFaces } from './VoiceFaces'
// 0.8.0 community tools: events, constellation search, the Inbox
import { eventPhase, type ConstellationEvent } from '@glofly/shared'
import { requestJump, takeJump, useConstellationEvents } from '../lib/community'
import { EventCard, EventDialog, EventsChip } from './Events'
import CxSearch from './CxSearch'
import { InboxStripButton } from './Inbox'
import './Inside.css'
import BotButtons from './BotButtons'
import { integrations } from '../lib/integrations'
import type { ConstellationCommand } from '@glofly/shared/integrations'

/** Communities round: a bot's badge in chats (approved board 4). */
const BOT_BADGE = { name: 'Bot', light: '#7fd4e8', badgeBg: '#2c3f46', badgeText: '#bfeaf5' }
/** Glofly tools post as "Glofly" with a TOOL tag (approved board 15). */
const TOOL_BADGE = { name: 'Tool', light: '#ffb36b', badgeBg: '#4a2c14', badgeText: '#ffd2a3' }

// Inside a constellation (Constellation.dc.html, approved): the far-left strip (Home at the top,
// a galaxy button to the dashboard, your constellations with the open one ringed in gold, a dashed
// +); the nebula sidebar (your profile at the top, the banner with stars, categories with text and
// voice nebulas); the open nebula's chat; members grouped by role on the right.

const STATUS_WORD: Record<MyStatus['status'], string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do not disturb',
  invisible: 'Invisible'
}

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username

function readCollapsed(id: string): string[] {
  try {
    const raw = localStorage.getItem(`cx-collapsed:${id}`)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function saveCollapsed(id: string, list: string[]): void {
  try {
    localStorage.setItem(`cx-collapsed:${id}`, JSON.stringify(list))
  } catch {
    // Not important enough to report.
  }
}

/** A small round face (voice nebula lists, member rows). */

/** The mute lengths (the same as Glofly's own chats). */
const MUTE_CHOICES: { duration: MuteDuration; label: string }[] = [
  { duration: '1h', label: 'For 1 hour' },
  { duration: '8h', label: 'For 8 hours' },
  { duration: '24h', label: 'For 24 hours' },
  { duration: 'forever', label: 'Until I turn it back on' }
]

/** Muted right now (a timed mute that hasn't run out). */
const isQuiet = (n: Nebula): boolean =>
  !!n.mutedUntil && new Date(n.mutedUntil).getTime() > Date.now()

/** "until 3:40 PM", "until Sat 9:00 AM", or "until you turn it back on". */
function mutedUntilText(iso: string): string {
  const d = new Date(iso)
  if (d.getFullYear() >= 2099) return 'until you turn it back on'
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay
    ? `until ${time}`
    : `until ${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

function muteTitle(n: Nebula): string {
  if (isQuiet(n)) return `Muted ${mutedUntilText(n.mutedUntil!)} (@mentions still come through)`
  return 'Notifications off for this nebula'
}

/** The six-dot handle on rows you can drag (0.7.5). */
function GripDots(): React.JSX.Element {
  return (
    <svg className="cx-neb-grip" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      <g fill="#8f7868">
        <circle cx="2.5" cy="3" r="1.4" />
        <circle cx="7.5" cy="3" r="1.4" />
        <circle cx="2.5" cy="8" r="1.4" />
        <circle cx="7.5" cy="8" r="1.4" />
        <circle cx="2.5" cy="13" r="1.4" />
        <circle cx="7.5" cy="13" r="1.4" />
      </g>
    </svg>
  )
}

/** A row being dragged: it follows the pointer, a little bigger and tilted (board 10). */
const liftStyle = (dy: number): React.CSSProperties => ({
  transform: `translateY(${dy}px) scale(1.04) rotate(-1.2deg)`
})

/** A small crossed-out bell (muted nebulas). */
function BellOffLine(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13.5A6 6 0 0 0 18 11V8a6 6 0 0 0-9.3-5M6.3 6.3A6 6 0 0 0 6 8v3c0 3.5-2 5-2 5h12M3 3l18 18" />
    </svg>
  )
}

type MenuState = { member: ConstellationMember; x: number; y: number } | null

export type ConstellationViewProps = {
  me: SignedInUser
  myStatus: MyStatus
  /** Change your status (the same as Glofly's own status menu) */
  onChangeStatus: (changes: MyStatusChanges) => Promise<boolean>
  /** Friends' presence (for the profile card) */
  presence: Record<string, Presence>
  friendIds: Set<string>
  detail: ConstellationDetail
  cards: ConstellationCard[]
  nebulaId: string | null
  now: number
  onSelectNebula: (nebulaId: string) => void
  onHome: () => void
  onDashboard: () => void
  onOpenConstellation: (constellationId: string) => void
  onCreate: () => void
  onSettings: (page: SettingsPageName) => void
  onAppSettings: () => void
  onViewProfile: (person: PublicUser) => void
  onMessage: (person: PublicUser) => void
  onReport: (message: Message, sender: PublicUser) => void
  onInvite: () => void
  onProblem: (message: string) => void
  onSessionExpired: () => void
  onChanged: (detail: ConstellationDetail) => void
  onReload: () => void
  onLeft: () => void
  /** Nebulas pinned to the dock on Glofly home */
  pinnedIds: Set<string>
  onTogglePin: (nebula: Nebula) => void
  /** 0.8.0: open a nebula in any constellation (the Inbox) */
  onOpenPlace?: (constellationId: string, nebulaId: string | null) => void
}

export type SettingsPageName =
  | 'overview'
  | 'nebulas'
  | 'roles'
  | 'members'
  | 'invites'
  | 'moderation'
  | 'automod'
  | 'integrations'
  | 'delete'

export default function ConstellationView(props: ConstellationViewProps): React.JSX.Element {
  const { me, myStatus, detail: c, cards, nebulaId, now } = props
  const calls = useCalls()
  void calls.tick
  const theme = CONSTELLATION_THEME[c.color]
  const [collapsed, setCollapsed] = useState<string[]>(() => readCollapsed(c.id))
  const [membersOpen, setMembersOpen] = useState(true)
  const [menu, setMenu] = useState<MenuState>(null)
  /** 0.7.5: the member card whose ⋯ (more actions) is open */
  const [memberMore, setMemberMore] = useState<string | null>(null)
  const [headMenu, setHeadMenu] = useState(false)
  /** Right-click on a nebula in the sidebar: its notification and mute menu */
  const [nebMenu, setNebMenu] = useState<{ nebula: Nebula; x: number; y: number } | null>(null)
  const [statusOpen, setStatusOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [jump, setJump] = useState<{ messageId: string; nonce: number } | null>(null)
  const [confirm, setConfirm] = useState<{
    kind: 'kick' | 'ban' | 'leave'
    member?: ConstellationMember
  } | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceChatOpen, setVoiceChatOpen] = useState(false)
  /** 0.7.5: the welcome screen was closed for this constellation (it shows once) */
  const [welcomeShownFor, setWelcomeShownFor] = useState<string | null>(null)
  /** 0.7.5: "Your roles" (the roles you can pick yourself) */
  const [rolesOpen, setRolesOpen] = useState(false)
  const headRef = useRef<HTMLDivElement>(null)
  // Another constellation: its own collapsed categories; another nebula: its chat closed.
  const [shownFor, setShownFor] = useState({ id: c.id, nebulaId })
  if (shownFor.id !== c.id || shownFor.nebulaId !== nebulaId) {
    if (shownFor.id !== c.id) setCollapsed(readCollapsed(c.id))
    setVoiceChatOpen(false)
    setShownFor({ id: c.id, nebulaId })
  }

  const people = useMemo(() => new Map(c.members.map((m) => [m.user.id, m.user])), [c.members])
  // Communities round: this constellation's slash commands (reloaded whenever it changes).
  const [commands, setCommands] = useState<ConstellationCommand[]>([])
  useEffect(() => {
    let stale = false
    if (!c.members.some((m) => m.user.bot)) {
      setCommands([])
      return
    }
    void integrations.commands(c.id).then((r) => {
      if (!stale && r.ok) setCommands(r.data.commands)
    })
    return () => {
      stale = true
    }
  }, [c])
  const nebula =
    c.nebulas.find((n) => n.id === nebulaId) ??
    c.nebulas.find((n) => n.kind === 'text') ??
    c.nebulas[0] ??
    null
  const myRole = topRole(c, me.id)
  const myVoice = calls.current?.chat.kind === 'nebula' ? calls.current.chat.nebula : undefined
  const inVoiceHere =
    myVoice?.constellationId === c.id ? c.nebulas.find((n) => n.id === myVoice.nebulaId) : undefined
  const room = calls.room
  const speakingIds = useMemo(() => {
    if (!room || !inVoiceHere) return new Set<string>()
    const ids = new Set<string>()
    for (const p of room.remoteParticipants.values()) if (p.isSpeaking) ids.add(p.identity)
    if (room.localParticipant.isSpeaking) ids.add(me.id)
    return ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, inVoiceHere, calls.tick, me.id])
  const onlineCount = c.members.filter((m) => m.status !== 'offline').length
  // 0.7.5 living sky: the banner's stars are this constellation's nebulas
  const skyStars = useMemo(() => starsOf(c, nebula?.id ?? null), [c, nebula?.id])
  // 0.7.5 "New since you left": the glowing line and its pill
  const newSince = useNewSince(c, nebulaId, me.id)
  // ---- 0.8.0 community tools: events, search across the constellation ----
  const cxEvents = useConstellationEvents(c.id)
  const [eventDialog, setEventDialog] = useState<{ editing: ConstellationEvent | null } | null>(
    null
  )
  const [searchAll, setSearchAll] = useState(false)
  const liveEventVoice = useMemo(
    () =>
      new Set(
        cxEvents.events
          .filter((e) => e.voiceNebulaId && eventPhase(e, cxEvents.now) === 'live')
          .map((e) => e.voiceNebulaId!)
      ),
    [cxEvents.events, cxEvents.now]
  )
  const eventsByMessage = useMemo(
    () => new Map(cxEvents.events.filter((e) => e.messageId).map((e) => [e.messageId!, e])),
    [cxEvents.events]
  )
  const canPlan = can(c, 'events') && !c.me.timedOutUntil
  // A message the Inbox or search asked for, once its nebula is on screen
  const shownNebulaId = c.nebulas.find((n) => n.id === nebulaId)?.id ?? null
  useEffect(() => {
    const id = takeJump(shownNebulaId)
    if (!id) return
    const t = setTimeout(() => setJump((j) => ({ messageId: id, nonce: (j?.nonce ?? 0) + 1 })), 0)
    return () => clearTimeout(t)
  }, [shownNebulaId])
  /** Show a message in a nebula of this constellation (another nebula: once it's open). */
  const showMessage = (targetNebulaId: string, messageId: string): void => {
    if (targetNebulaId === shownNebulaId)
      setJump((j) => ({ messageId, nonce: (j?.nonce ?? 0) + 1 }))
    else {
      requestJump(targetNebulaId, messageId)
      props.onSelectNebula(targetNebulaId)
    }
  }

  // ---- 0.7.5 smooth reordering: the sidebar as rows you can drag ----
  const canArrange = can(c, 'manageNebulas')
  const serverRows = useMemo(() => rowsOf(layoutOf(c)), [c])
  const [movedRows, setMovedRows] = useState<{ rows: Row[]; detail: ConstellationDetail } | null>(
    null
  )
  const rows = movedRows && movedRows.detail === c ? movedRows.rows : serverRows
  const saveRows = useCallback(
    async (next: Row[]): Promise<void> => {
      setMovedRows({ rows: next, detail: c })
      const layout = layoutFromRows(next, layoutOf(c))
      const r = await api.layout(c.id, layout.categories, layout.nebulas)
      if (!r.ok) {
        setMovedRows(null)
        props.onProblem(r.message)
      } else props.onChanged(r.data.constellation)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c]
  )
  const { listRef: sideListRef, ...drag } = useSidebarDrag({
    enabled: canArrange,
    rows,
    onCommit: (next) => void saveRows(next)
  })
  useRowsGlide(
    sideListRef,
    rows.map((r) => (r.kind === 'cat' ? `#${r.id}` : `${r.id}@${r.categoryId}`)).join(',')
  )
  /** A nebula with news you'd be told about (not the one you're reading) */
  const hasNews = (n: Nebula): boolean =>
    n.kind === 'text' &&
    n.id !== nebula?.id &&
    (n.mentionCount > 0 || (n.unreadCount > 0 && (n.notify ?? c.me.notify) !== 'none'))

  // ---- 0.7.5 LIVE preview (hover or click LIVE under a voice nebula) ----
  const [livePeek, setLivePeek] = useState<{
    nebula: Nebula
    sharer: PublicUser
    anchor: DOMRect
    how: 'hover' | 'click'
  } | null>(null)
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const peekOver = useRef(false)
  const clearPeekTimer = (): void => {
    if (peekTimer.current) clearTimeout(peekTimer.current)
    peekTimer.current = null
  }
  useEffect(() => clearPeekTimer, [])
  function showLive(
    n: Nebula,
    sharer: PublicUser,
    anchor: HTMLElement,
    how: 'hover' | 'click'
  ): void {
    clearPeekTimer()
    // In the voice nebula already: LIVE just shows it.
    if (inVoiceHere?.id === n.id) {
      props.onSelectNebula(n.id)
      return
    }
    const rect = anchor.getBoundingClientRect()
    if (how === 'click') {
      setLivePeek((p) =>
        p && p.sharer.id === sharer.id && p.how === 'click'
          ? null
          : { nebula: n, sharer, anchor: rect, how }
      )
      return
    }
    // Hover: a short wait so passing the mouse over it doesn't start a connection.
    peekTimer.current = setTimeout(
      () => setLivePeek((p) => (p?.how === 'click' ? p : { nebula: n, sharer, anchor: rect, how })),
      300
    )
  }
  function leaveLive(): void {
    clearPeekTimer()
    peekTimer.current = setTimeout(() => {
      if (!peekOver.current) setLivePeek((p) => (p?.how === 'hover' ? null : p))
    }, 250)
  }
  // The person stopped sharing, or left: the peek closes.
  const peekState = livePeek ? c.voice.find((v) => v.nebulaId === livePeek.nebula.id) : undefined
  if (livePeek && !peekState?.sharing.includes(livePeek.sharer.id)) setLivePeek(null)

  const saveRowsRef = useRef(saveRows)
  useLayoutEffect(() => {
    saveRowsRef.current = saveRows
  })

  // ---- 0.7.5 keyboard: Alt+↑/↓ between nebulas, Alt+Shift+↑/↓ the next one with news (or,
  // on a focused nebula you can arrange, moves it), Esc marks this one read ----
  const keys = useRef({ c, nebulaId: nebula?.id ?? null, rows, canArrange, hasNews, newSince })
  useLayoutEffect(() => {
    keys.current = { c, nebulaId: nebula?.id ?? null, rows, canArrange, hasNews, newSince }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey) return
      if (document.querySelector('.cx-dialog-backdrop, .dialog-backdrop, .cx-menu')) return
      const k = keys.current
      if (e.key === 'Escape' && !e.altKey) {
        if (k.newSince.info && !document.querySelector('.cx-pins-pop, .cx-livepop, .pins-panel')) {
          k.newSince.clear()
        }
        return
      }
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      const dir = e.key === 'ArrowUp' ? -1 : 1
      const focused = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(
        '[data-nebula-id]'
      )
      if (e.shiftKey && focused && k.canArrange) {
        e.preventDefault()
        const id = focused.dataset.nebulaId!
        const next = stepNebula(k.rows, id, dir)
        if (!sameRows(next, k.rows)) {
          void saveRowsRef.current(next)
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(`[data-nebula-id="${id}"]`)?.focus()
          )
        }
        return
      }
      const order = sidebarOrder(k.c)
      const at = order.findIndex((n) => n.id === k.nebulaId)
      for (let step = 1; step <= order.length; step++) {
        const n = order[(at + dir * step + order.length * 2) % order.length]
        if (e.shiftKey && !k.hasNews(n)) continue
        e.preventDefault()
        props.onSelectNebula(n.id)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Close the menus on Escape or a click elsewhere.
  useEffect(() => {
    if (!menu && !headMenu && !nebMenu) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (
        e instanceof MouseEvent &&
        (e.target as HTMLElement).closest?.('.cx-menu, .cx-side-head-toggle')
      )
        return
      setMenu(null)
      setHeadMenu(false)
      setNebMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu, headMenu, nebMenu])

  function toggleCategory(id: string): void {
    setCollapsed((list) => {
      const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
      saveCollapsed(c.id, next)
      return next
    })
  }

  const roleBadge = useCallback(
    (userId: string) => {
      if (!people.has(userId)) return null
      // Communities round: a constellation's bot always shows BOT.
      if (people.get(userId)?.tool) return TOOL_BADGE
      if (people.get(userId)?.bot) return BOT_BADGE
      const role = topRole(c, userId)
      if (role.kind === 'member') return null
      const colors = ROLE_COLORS[role.color] ?? ROLE_COLORS.gray
      return {
        name: role.name,
        light: colors.light,
        badgeBg: colors.badgeBg,
        badgeText: colors.badgeText
      }
    },
    [c, people]
  )

  function joinVoice(n: Nebula, show = true): void {
    if (c.me.timedOutUntil) {
      props.onProblem("You're timed out for now, so you can't join voice.")
      return
    }
    calls.joinVoice({
      kind: 'nebula',
      title: n.name,
      people: c.members.map((m) => m.user).filter((u) => u.id !== me.id),
      nebula: { constellationId: c.id, nebulaId: n.id }
    })
    if (show) props.onSelectNebula(n.id)
  }

  // The chat of the open nebula, as the chat screen expects it.
  const chatNebula = nebula && (nebula.kind === 'text' || voiceChatOpen) ? nebula : null
  const summary = useMemo<GroupSummary | null>(() => {
    if (!chatNebula) return null
    const cantPost = c.me.timedOutUntil
      ? "You're timed out for now, so you can read but not post."
      : chatNebula.readOnly && !can(c, 'manageNebulas') && !can(c, 'deleteMessages')
        ? 'Only moderators can post here.'
        : null
    return {
      id: chatNebula.conversationId,
      kind: 'group',
      partner: null,
      name: chatNebula.name,
      createdBy: null,
      partnerReadAt: null,
      members: c.members.map((m) => m.user).filter((u) => u.id !== me.id),
      memberCount: c.members.length,
      canMessage: !cantPost,
      lastMessage: null,
      unreadCount: chatNebula.unreadCount,
      activityAt: new Date().toISOString(),
      pinnedAt: null,
      mutedUntil: null
    }
  }, [chatNebula, c, me.id])
  const cantPost =
    summary && !summary.canMessage
      ? c.me.timedOutUntil
        ? "You're timed out for now, so you can read but not post."
        : 'Only moderators can post here.'
      : null

  const voiceCards = c.nebulas
    .filter((n) => n.kind === 'voice')
    .map((n) => {
      const v = c.voice.find((x) => x.nebulaId === n.id)
      const inIt = (v?.userIds ?? [])
        .map((id) => people.get(id))
        .filter((p): p is PublicUser => !!p)
      if (!inIt.length) return null
      const names = inIt.slice(0, 3).map(firstName)
      const line =
        inIt.length === 1
          ? `${names[0]} is in`
          : inIt.length <= 3
            ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} are in`
            : `${names.slice(0, 2).join(', ')} and ${inIt.length - 2} others are in`
      return { name: n.name, line, onJoin: inVoiceHere?.id === n.id ? null : () => joinVoice(n) }
    })
    .filter((x): x is { name: string; line: string; onJoin: (() => void) | null } => !!x)

  async function setNotify(level: NotifyLevel | null): Promise<void> {
    if (!chatNebula) return
    const r = await api.nebulaNotify(c.id, chatNebula.id, level)
    if (!r.ok) props.onProblem(r.message)
    else props.onReload()
  }

  // ---- Member actions ----
  async function act(
    run: () => Promise<
      { ok: true; data: { constellation: ConstellationDetail } } | { ok: false; message: string }
    >
  ): Promise<void> {
    setBusy(true)
    const r = await run()
    setBusy(false)
    setMenu(null)
    if (!r.ok) props.onProblem(r.message)
    else props.onChanged(r.data.constellation)
  }

  async function confirmAction(): Promise<void> {
    if (!confirm) return
    setBusy(true)
    if (confirm.kind === 'leave') {
      const r = await api.leave(c.id)
      setBusy(false)
      setConfirm(null)
      if (!r.ok) props.onProblem(r.message)
      else props.onLeft()
      return
    }
    const m = confirm.member!
    const r =
      confirm.kind === 'kick'
        ? await api.kick(c.id, m.user.id, reason || undefined)
        : await api.ban(c.id, m.user.id, reason || undefined)
    setBusy(false)
    setConfirm(null)
    setReason('')
    if (!r.ok) props.onProblem(r.message)
    else props.onChanged(r.data.constellation)
  }

  // ---- Members panel groups ----
  const groups = useMemo(() => {
    const out: { key: string; title: string; color: string; members: ConstellationMember[] }[] = []
    const online = c.members.filter((m) => m.status !== 'offline')
    const offline = c.members.filter((m) => m.status === 'offline')
    const byName = (a: ConstellationMember, b: ConstellationMember): number =>
      a.user.displayName.localeCompare(b.user.displayName)
    const owner = c.members.find((m) => m.user.id === c.ownerId)
    if (owner)
      out.push({ key: 'owner', title: 'Owner', color: ROLE_COLORS.ember.heading, members: [owner] })
    const placed = new Set<string>(owner ? [owner.user.id] : [])
    for (const role of c.roles) {
      if (role.kind === 'owner' || role.kind === 'member') continue
      const list = online
        .filter((m) => !placed.has(m.user.id) && topRole(c, m.user.id).id === role.id)
        .sort(byName)
      list.forEach((m) => placed.add(m.user.id))
      if (list.length) {
        const plural = role.name.endsWith('s') ? role.name : `${role.name}s`
        out.push({
          key: role.id,
          title: plural,
          color: (ROLE_COLORS[role.color] ?? ROLE_COLORS.gray).heading,
          members: list
        })
      }
    }
    const rest = online.filter((m) => !placed.has(m.user.id)).sort(byName)
    if (rest.length)
      out.push({ key: 'online', title: 'Online', color: 'var(--glo-muted)', members: rest })
    // Communities round: bots get their own group (they're never "offline" people).
    const bots = offline.filter((m) => !placed.has(m.user.id) && m.user.bot).sort(byName)
    const off = offline.filter((m) => !placed.has(m.user.id) && !m.user.bot).sort(byName)
    if (bots.length) out.push({ key: 'bots', title: 'Bots', color: 'var(--glo-muted)', members: bots })
    if (off.length)
      out.push({ key: 'offline', title: 'Offline', color: 'var(--glo-muted)', members: off })
    return out
  }, [c])

  // ---- The far-left strip ----
  const strip = (
    <nav aria-label="Your constellations" className="cx-strip">
      <button
        type="button"
        className="cx-home"
        aria-label="Back to Glofly home: Chats, Friends and Groups"
        title="Back to Glofly"
        onClick={props.onHome}
      >
        <span className="cx-home-mark">
          <FireflyMark size={30} />
        </span>
        <span className="cx-home-label">Home</span>
      </button>
      <span className="cx-strip-line" aria-hidden="true" />
      <InboxStripButton
        onOpen={(constellationId, targetNebulaId, messageId) => {
          if (constellationId === c.id) {
            if (messageId) showMessage(targetNebulaId, messageId)
            else props.onSelectNebula(targetNebulaId)
            return
          }
          if (messageId) requestJump(targetNebulaId, messageId)
          if (props.onOpenPlace) props.onOpenPlace(constellationId, targetNebulaId)
          else props.onOpenConstellation(constellationId)
        }}
      />
      <button
        type="button"
        className="cx-strip-galaxy"
        aria-label="All your constellations"
        title="All constellations"
        onClick={props.onDashboard}
      >
        <GalaxyIcon size={24} color="#d9c2b1" />
      </button>
      <div className="cx-strip-list">
        {cards.map((card) => {
          const current = card.id === c.id
          const dot = !current && (card.mentionCount > 0 || card.unreadCount > 0)
          return (
            <button
              key={card.id}
              type="button"
              className={current ? 'cx-strip-item cx-strip-item--current' : 'cx-strip-item'}
              aria-label={`${card.name}${current ? ' (open)' : ''}${card.mentionCount ? `, ${card.mentionCount} mentions` : card.unreadCount ? ', new messages' : ''}`}
              aria-current={current ? 'page' : undefined}
              title={card.name}
              onClick={() => props.onOpenConstellation(card.id)}
              onMouseEnter={() => !current && void preloadConstellation(card.id)}
            >
              <ConstellationIcon
                id={card.id}
                name={card.name}
                color={card.color}
                iconVersion={card.iconVersion}
                className="cx-strip-icon"
                style={
                  card.color === 'ember' && !card.iconVersion
                    ? { background: current ? '#2a1c17' : '#2a1c17', color: '#ffb347' }
                    : undefined
                }
              />
              {dot && (
                <span
                  className={
                    card.mentionCount ? 'cx-strip-dot cx-strip-dot--mention' : 'cx-strip-dot'
                  }
                  aria-hidden="true"
                >
                  {card.mentionCount || ''}
                </span>
              )}
            </button>
          )
        })}
        <button
          type="button"
          className="cx-strip-add"
          aria-label="Create or join a constellation"
          title="Create or join"
          onClick={props.onCreate}
        >
          <PlusIcon size={20} strokeWidth={2} />
        </button>
      </div>
    </nav>
  )

  // ---- The nebula sidebar ----
  // 0.7.5: the sidebar as rows (your drag shows at once, before the server confirms it)
  const sections: { id: string; name: string | null; nebulas: Nebula[] }[] = []
  {
    const byId = new Map(c.nebulas.map((n) => [n.id, n]))
    for (const r of rows) {
      if (r.kind === 'cat') {
        sections.push({
          id: r.id,
          name: c.categories.find((x) => x.id === r.id)?.name ?? '',
          nebulas: []
        })
        continue
      }
      const n = byId.get(r.id)
      if (!n) continue
      if (!sections.length) sections.push({ id: 'none', name: null, nebulas: [] })
      sections[sections.length - 1].nebulas.push({ ...n, categoryId: r.categoryId })
    }
  }
  const settingsAllowed = SETTINGS_PERMISSIONS.some((p) => can(c, p))
  const myDot = myStatus.status === 'invisible' ? 'offline' : myStatus.status
  const roleDark = (ROLE_COLORS[myRole.color] ?? ROLE_COLORS.gray).dark

  const sidebar = (
    <aside aria-label={`${c.name} nebulas`} className="cx-side">
      <div className="cx-side-me">
        <button
          type="button"
          className="cx-face cx-side-me-face avatar--me"
          style={{
            width: 36,
            height: 36,
            background: '#f47a1f',
            color: '#2a1406',
            fontSize: 13,
            position: 'relative'
          }}
          aria-label={`Change your status (now ${STATUS_WORD[myStatus.status]})`}
          aria-expanded={statusOpen}
          title="Change your status"
          onClick={() => setStatusOpen((v) => !v)}
        >
          <AvatarFace id={me.id} name={me.displayName} avatarVersion={me.avatarVersion} />
          <StatusDot status={myDot} ring="#150e0b" size={11} />
        </button>
        {statusOpen && (
          <StatusMenu
            current={myStatus}
            onChange={props.onChangeStatus}
            onClose={() => setStatusOpen(false)}
          />
        )}
        <span className="cx-side-me-text">
          <span className="cx-side-me-name">{me.displayName}</span>
          <span
            className="cx-side-me-sub"
            style={{ color: myRole.kind === 'owner' ? '#ffb347' : roleDark }}
          >
            {inVoiceHere
              ? `In ${inVoiceHere.name}`
              : `${myRole.kind === 'member' ? 'Member' : myRole.name} · ${STATUS_WORD[myStatus.status]}`}
          </span>
        </span>
        <button
          type="button"
          className="cx-side-icon"
          aria-label={
            room && inVoiceHere
              ? room.localParticipant.isMicrophoneEnabled
                ? 'Mute microphone'
                : 'Unmute microphone'
              : 'Mute microphone (join a voice nebula first)'
          }
          title={
            room && inVoiceHere
              ? room.localParticipant.isMicrophoneEnabled
                ? 'Mute'
                : 'Unmute'
              : 'Join a voice nebula to talk'
          }
          disabled={!room || !inVoiceHere}
          onClick={calls.toggleMic}
        >
          <MicIconLine
            muted={!!room && !!inVoiceHere && !room.localParticipant.isMicrophoneEnabled}
          />
        </button>
        <button
          type="button"
          className="cx-side-icon"
          aria-label="Your settings"
          title="Settings"
          onClick={props.onAppSettings}
        >
          <GearIcon />
        </button>
      </div>
      {/* 0.7.5 identity: its banner photo, with the icon on it (the approved Identity board) */}
      {c.bannerVersion && (
        <div className="cx-side-photo">
          <BannerArt c={c} width={264} height={112} />
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color}
            iconVersion={c.iconVersion}
            className="cx-side-photo-icon"
            style={c.iconVersion ? undefined : { background: '#120c0a', color: 'var(--cxa)' }}
          />
        </div>
      )}
      <div
        className={
          c.bannerVersion ? 'cx-side-banner cx-side-banner--under-photo' : 'cx-side-banner'
        }
        style={{ background: theme.sideBanner }}
        ref={headRef}
      >
        <NebulaSky id={c.id} stars={skyStars} scale={0.55} />
        <div className="cx-side-banner-row">
          <h1>{c.name}</h1>
          {settingsAllowed && (
            <button
              type="button"
              className="cx-side-icon cx-side-settings"
              aria-label={`${c.name} settings`}
              title="Constellation settings"
              onClick={() => props.onSettings('overview')}
            >
              <GearIcon />
            </button>
          )}
          <button
            type="button"
            className="cx-side-icon cx-side-head-toggle"
            aria-label="Constellation settings"
            aria-haspopup="menu"
            aria-expanded={headMenu}
            onClick={() => setHeadMenu((v) => !v)}
          >
            <ChevronDown size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="cx-side-count">
          {c.members.length} {c.members.length === 1 ? 'member' : 'members'} · {onlineCount} online
        </div>
        {headMenu && (
          <div role="menu" className="cx-menu cx-head-menu">
            {can(c, 'invite') && (
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item"
                onClick={() => {
                  setHeadMenu(false)
                  props.onInvite()
                }}
              >
                Invite people
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="cx-menu-item"
              onClick={() => {
                setHeadMenu(false)
                props.onSettings('overview')
              }}
            >
              Constellation settings
            </button>
            {c.pendingRequests > 0 && (
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item"
                onClick={() => {
                  setHeadMenu(false)
                  props.onSettings('members')
                }}
              >
                Join requests ({c.pendingRequests})
              </button>
            )}
            {can(c, 'manageNebulas') && (
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item"
                onClick={() => {
                  setHeadMenu(false)
                  props.onSettings('nebulas')
                }}
              >
                Create a nebula
              </button>
            )}
            {canPlan && (
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item"
                onClick={() => {
                  setHeadMenu(false)
                  setEventDialog({ editing: null })
                }}
              >
                Plan an event
              </button>
            )}
            <span className="cx-menu-sub">Notifications</span>
            {(['all', 'mentions', 'none'] as const).map((level) => (
              <button
                key={level}
                type="button"
                role="menuitemradio"
                aria-checked={c.me.notify === level}
                className="cx-menu-item cx-menu-item--indent"
                onClick={async () => {
                  setHeadMenu(false)
                  const r = await api.notify(c.id, level)
                  if (!r.ok) props.onProblem(r.message)
                  else props.onReload()
                }}
              >
                {level === 'all'
                  ? 'All messages'
                  : level === 'mentions'
                    ? 'Only @mentions'
                    : 'Nothing'}
                {c.me.notify === level && <span className="cx-menu-check">✓</span>}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="cx-menu-item"
              onClick={async () => {
                setHeadMenu(false)
                await api.readAll(c.id)
                props.onReload()
              }}
            >
              Mark everything read
            </button>
            {c.roles.some((r) => r.selfAssign) && (
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item"
                onClick={() => {
                  setHeadMenu(false)
                  setRolesOpen(true)
                }}
              >
                Your roles
              </button>
            )}
            {!c.me.owner && (
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item cx-menu-item--danger"
                onClick={() => {
                  setHeadMenu(false)
                  setConfirm({ kind: 'leave' })
                }}
              >
                Leave constellation
              </button>
            )}
          </div>
        )}
      </div>

      <EventsChip
        events={cxEvents.events}
        now={Math.max(now, cxEvents.now)}
        onPlan={canPlan ? () => setEventDialog({ editing: null }) : null}
        onOpen={(e) => {
          if (e.messageId) showMessage(e.nebulaId, e.messageId)
          else props.onSelectNebula(e.nebulaId)
        }}
      />
      <div
        className={drag.drag ? 'cx-side-list cx-side-list--dragging' : 'cx-side-list'}
        ref={sideListRef}
      >
        {sections.map((section) => {
          const closed = collapsed.includes(section.id)
          const catKey = `cat:${section.id}`
          const catLifted = drag.drag?.key === catKey
          const withNews = section.nebulas.filter((n) => hasNews(n)).length
          return (
            <div key={section.id} className="cx-side-section">
              {section.name !== null && (
                <button
                  type="button"
                  data-row={catKey}
                  className={['cx-cat', closed && 'cx-cat--closed', catLifted && 'cx-cat--lifted']
                    .filter(Boolean)
                    .join(' ')}
                  style={catLifted ? liftStyle(drag.drag!.dy) : undefined}
                  aria-expanded={!closed}
                  onPointerDown={(e) => drag.onPointerDown(e, { kind: 'cat', id: section.id })}
                  onClick={() => {
                    if (drag.takeClick()) return
                    toggleCategory(section.id)
                  }}
                >
                  <ChevronDown />
                  {section.name}
                  {c.categories.find((x) => x.id === section.id)?.visibility === 'roles' && (
                    <span
                      className="cx-cat-lock"
                      role="img"
                      aria-label={`Only ${gateLabel(c, c.categories.find((x) => x.id === section.id)?.roleIds)}`}
                      title={`Only ${gateLabel(c, c.categories.find((x) => x.id === section.id)?.roleIds)}`}
                    >
                      <LockIcon size={11} />
                    </span>
                  )}
                  {closed && (
                    <span className={withNews ? 'cx-cat-hint cx-cat-hint--news' : 'cx-cat-hint'}>
                      {withNews ? `• ${withNews} with news` : 'folded'}
                    </span>
                  )}
                </button>
              )}
              {section.nebulas.map((n) => {
                const current = nebula?.id === n.id
                const unread =
                  n.kind === 'text' &&
                  !current &&
                  n.unreadCount > 0 &&
                  (n.notify ?? c.me.notify) !== 'none'
                const mention = !current && n.mentionCount > 0
                const v = n.kind === 'voice' ? c.voice.find((x) => x.nebulaId === n.id) : undefined
                const inIt = (v?.userIds ?? [])
                  .map((id) => people.get(id))
                  .filter((p): p is PublicUser => !!p)
                // 0.7.5: a folded category keeps only the nebula you're in and voice with people in
                // it (its header counts the news)
                if (closed && !current && !inIt.length) return null
                const rowKey = `neb:${n.id}`
                const lifted = drag.drag?.key === rowKey
                return (
                  <div
                    key={n.id}
                    data-row={rowKey}
                    className={lifted ? 'cx-neb-row cx-neb-row--lifted' : 'cx-neb-row'}
                    style={lifted ? liftStyle(drag.drag!.dy) : undefined}
                  >
                    <button
                      type="button"
                      data-nebula-id={n.id}
                      className={[
                        'cx-neb',
                        current && 'cx-neb--current',
                        (unread || mention) && 'cx-neb--unread'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-current={current ? 'page' : undefined}
                      onPointerDown={(e) =>
                        drag.onPointerDown(e, { kind: 'neb', id: n.id, categoryId: n.categoryId })
                      }
                      onClick={() => {
                        if (drag.takeClick()) return
                        props.onSelectNebula(n.id)
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setMenu(null)
                        setHeadMenu(false)
                        setNebMenu({ nebula: n, x: e.clientX, y: e.clientY })
                      }}
                      onDoubleClick={() =>
                        n.kind === 'voice' && inVoiceHere?.id !== n.id && joinVoice(n)
                      }
                    >
                      {canArrange && <GripDots />}
                      {n.kind === 'text' ? (
                        <StarIcon size={16} color={current ? '#ffb347' : 'currentColor'} />
                      ) : (
                        <SpeakerIcon size={16} color={current ? '#ffb347' : 'currentColor'} />
                      )}
                      <span className="cx-neb-name">{n.name}</span>
                      {n.visibility === 'roles' && (
                        <span
                          className="cx-neb-lock"
                          title={`Only ${gateLabel(c, n.roleIds)} can see it`}
                          aria-label={`Only ${gateLabel(c, n.roleIds)}`}
                        >
                          <LockIcon />
                          {gateLabel(c, n.roleIds)}
                        </span>
                      )}
                      {liveEventVoice.has(n.id) && <span className="ev-event-badge">EVENT</span>}
                      {(isQuiet(n) || n.notify === 'none') && (
                        <span
                          className="cx-neb-muted"
                          title={muteTitle(n)}
                          aria-label={muteTitle(n)}
                        >
                          <BellOffLine />
                        </span>
                      )}
                      {mention ? (
                        <span className="cx-neb-badge cx-neb-badge--mention">
                          @{n.mentionCount > 1 ? n.mentionCount : ''}
                        </span>
                      ) : unread ? (
                        <span className="cx-neb-badge">
                          {n.unreadCount > 99 ? '99+' : n.unreadCount}
                        </span>
                      ) : n.kind === 'voice' && inIt.length > 0 ? (
                        <InVoiceCount count={inIt.length} />
                      ) : null}
                    </button>
                    <VoiceFaces
                      people={inIt}
                      state={v}
                      meId={me.id}
                      inThisVoice={inVoiceHere?.id === n.id}
                      speakingIds={speakingIds}
                      onLive={(sharer, anchor, how) => showLive(n, sharer, anchor, how)}
                      onLiveLeave={leaveLive}
                    />
                  </div>
                )
              })}
            </div>
          )
        })}
        {drag.drag && drag.drag.lineTop !== null && (
          <div className="cx-drop-line" style={{ top: drag.drag.lineTop }} aria-hidden="true" />
        )}
        {c.nebulas.length === 0 && <p className="cx-side-empty">No nebulas yet.</p>}
      </div>

      {inVoiceHere && (
        <div className="cx-voice-connected">
          <button
            type="button"
            className="cx-voice-connected-text"
            onClick={() => props.onSelectNebula(inVoiceHere.id)}
          >
            <span className="cx-voice-connected-title">
              <span className="cx-voice-connected-dot" aria-hidden="true" />
              {calls.current?.phase === 'connected' ? 'Voice connected' : 'Connecting…'}
            </span>
            <span className="cx-voice-connected-where">
              {inVoiceHere.name} · {c.name}
            </span>
          </button>
          <button
            type="button"
            className="cx-side-icon"
            aria-label={`Leave ${inVoiceHere.name}`}
            title="Leave voice"
            onClick={calls.hangUp}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 15.5c5-4.7 13-4.7 18 0l-2.4 2.4-3.4-1.6v-2.6a12 12 0 0 0-6.4 0v2.6l-3.4 1.6z" />
            </svg>
          </button>
        </div>
      )}
    </aside>
  )

  // ---- The members panel ----
  const membersPanel = membersOpen && (
    <aside aria-label="Members" className="cx-members">
      {/* Oct 17: invite right from here, for anyone who can invite (no trip into Settings). */}
      <div className="cx-members-head">
        <span>Members · {c.members.length}</span>
        {can(c, 'invite') && (
          <button
            type="button"
            className="cx-members-invite"
            aria-label="Invite people"
            title="Invite people"
            onClick={props.onInvite}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 19.5a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z" />
            </svg>
          </button>
        )}
      </div>
      {/* 0.7.5: a constellation with just you in it says what to do next */}
      {c.members.length === 1 && (can(c, 'invite') || can(c, 'manageNebulas')) && (
        <EmptyScene
          kind="constellation"
          layout="small"
          title="Your constellation is ready"
          text="It’s quiet with just you. Invite a few friends, then add a voice nebula to hang out in."
        >
          {can(c, 'invite') && (
            <button type="button" className="primary-button" onClick={props.onInvite}>
              Invite friends
            </button>
          )}
          {can(c, 'manageNebulas') && (
            <button
              type="button"
              className="scene-button"
              onClick={() => props.onSettings('nebulas')}
            >
              Add a nebula
            </button>
          )}
        </EmptyScene>
      )}
      {/* 0.7.5: members list with life (the approved Members board) */}
      <MembersPanel
        c={c}
        me={me}
        groups={groups}
        now={now}
        openId={menu?.member.user.id ?? null}
        onOpen={(m, rect) => {
          setMemberMore(null)
          setMenu(
            menu?.member.user.id === m.user.id ? null : { member: m, x: rect.left - 8, y: rect.top }
          )
        }}
      />
    </aside>
  )

  // ---- A nebula's menu (right-click in the sidebar): notifications and mute ----
  async function setNebulaNotify(n: Nebula, level: NotifyLevel | null): Promise<void> {
    setNebMenu(null)
    const r = await api.nebulaNotify(c.id, n.id, level)
    if (!r.ok) props.onProblem(r.message)
    else props.onReload()
  }
  async function muteNebula(n: Nebula, duration: MuteDuration | null): Promise<void> {
    setNebMenu(null)
    const r = await window.glofly.conversations.mute(n.conversationId, duration)
    if (!r.ok) props.onProblem(r.message)
    props.onReload()
  }
  const nebMenuEl =
    nebMenu &&
    (() => {
      const n = nebMenu.nebula
      const muted = isQuiet(n)
      const level = n.notify
      const levelLabel = { all: 'All messages', mentions: 'Only @mentions', none: 'Nothing' }
      return (
        <div
          role="menu"
          aria-label={`${n.name} notifications`}
          className="cx-menu cx-neb-menu"
          style={{
            top: Math.min(nebMenu.y, window.innerHeight - 440),
            left: Math.min(nebMenu.x, window.innerWidth - 260)
          }}
        >
          <div className="cx-neb-menu-head">
            {n.kind === 'text' ? (
              <StarIcon size={15} color="#ffb347" />
            ) : (
              <SpeakerIcon size={15} color="#ffb347" />
            )}
            <strong>{n.name}</strong>
          </div>
          {(n.unreadCount > 0 || n.mentionCount > 0) && (
            <button
              type="button"
              role="menuitem"
              className="cx-menu-item"
              onClick={async () => {
                setNebMenu(null)
                await window.glofly.conversations.markRead(n.conversationId)
                props.onReload()
              }}
            >
              Mark as read
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="cx-menu-item cx-menu-item--pin"
            onClick={() => {
              setNebMenu(null)
              props.onTogglePin(n)
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
              <path d="M12 15v6" />
            </svg>
            {props.pinnedIds.has(n.id) ? 'Unpin from Glofly dock' : 'Pin to Glofly dock'}
          </button>
          <span className="cx-menu-sub">
            {muted ? `Muted ${mutedUntilText(n.mutedUntil!)}` : 'Mute'}
          </span>
          {muted ? (
            <button
              type="button"
              role="menuitem"
              className="cx-menu-item cx-menu-item--indent"
              onClick={() => void muteNebula(n, null)}
            >
              Unmute
            </button>
          ) : (
            MUTE_CHOICES.map((m) => (
              <button
                key={m.duration}
                type="button"
                role="menuitem"
                className="cx-menu-item cx-menu-item--indent"
                onClick={() => void muteNebula(n, m.duration)}
              >
                {m.label}
              </button>
            ))
          )}
          <span className="cx-menu-sub">Notify me about</span>
          {(['all', 'mentions', 'none'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={level === l}
              className="cx-menu-item cx-menu-item--indent"
              onClick={() => void setNebulaNotify(n, l)}
            >
              {levelLabel[l]}
              {level === l && <span className="cx-menu-check">✓</span>}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={level === null}
            className="cx-menu-item cx-menu-item--indent"
            onClick={() => void setNebulaNotify(n, null)}
          >
            Same as {c.name} ({levelLabel[c.me.notify].toLowerCase()})
            {level === null && <span className="cx-menu-check">✓</span>}
          </button>
        </div>
      )
    })()

  // ---- A member's menu ----
  const menuEl =
    menu &&
    (() => {
      const m = menu.member
      const mine = m.user.id === me.id
      const above = outranks(c, me.id, m.user.id)
      const inVoice = c.voice.find((v) => v.userIds.includes(m.user.id))
      const roles = c.roles.filter(
        (r) => r.kind !== 'owner' && r.kind !== 'member' && (c.me.owner || r.position < c.me.rank)
      )
      // 0.7.5: the member card (the approved Members board); its ⋯ shows the old menu's actions.
      const more = memberMore === m.user.id
      return (
        <div
          role="dialog"
          aria-label={m.user.displayName}
          className="cx-menu cx-member-card"
          style={{
            top: Math.max(12, Math.min(menu.y - 40, window.innerHeight - (more ? 620 : 470))),
            left: Math.max(12, menu.x - 340)
          }}
        >
          <MemberCardTop
            c={c}
            m={m}
            me={me}
            now={now}
            friend={props.friendIds.has(m.user.id)}
            more={more}
            onMore={() => setMemberMore(more ? null : m.user.id)}
            onMessage={() => {
              setMenu(null)
              props.onMessage(m.user)
            }}
            onCall={() => {
              setMenu(null)
              window.dispatchEvent(
                new CustomEvent('glofly:call-person', { detail: { userId: m.user.id } })
              )
            }}
            onViewProfile={() => {
              setMenu(null)
              props.onViewProfile(m.user)
            }}
          />
          {more && (
            <div
              className="cx-mcard-more-list"
              role="menu"
              aria-label={`More for ${m.user.displayName}`}
            >
              <button
                type="button"
                role="menuitem"
                className="cx-menu-item"
                onClick={() => {
                  setMenu(null)
                  props.onViewProfile(m.user)
                }}
              >
                View profile
              </button>
              {can(c, 'manageRoles') && (above || (mine && c.me.owner)) && roles.length > 0 && (
                <>
                  <span className="cx-menu-sub">Roles</span>
                  {roles.map((r) => {
                    const has = m.roleIds.includes(r.id)
                    return (
                      <button
                        key={r.id}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={has}
                        className="cx-menu-item cx-menu-item--indent"
                        disabled={busy}
                        onClick={() =>
                          void act(() =>
                            api.setMemberRoles(
                              c.id,
                              m.user.id,
                              has ? m.roleIds.filter((x) => x !== r.id) : [...m.roleIds, r.id]
                            )
                          )
                        }
                      >
                        <span
                          className="cx-role-dot"
                          style={{ background: (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot }}
                        />
                        {r.name}
                        {has && <span className="cx-menu-check">✓</span>}
                      </button>
                    )
                  })}
                </>
              )}
              {above && can(c, 'muteVoice') && inVoice && (
                <>
                  <span className="cx-menu-sub">Voice</span>
                  <button
                    type="button"
                    role="menuitem"
                    className="cx-menu-item cx-menu-item--indent"
                    onClick={async () => {
                      setMenu(null)
                      const r = await api.voiceMute(
                        c.id,
                        inVoice.nebulaId,
                        m.user.id,
                        !inVoice.muted.includes(m.user.id)
                      )
                      if (!r.ok) props.onProblem(r.message)
                    }}
                  >
                    {inVoice.muted.includes(m.user.id) ? 'Unmute in voice' : 'Mute in voice'}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="cx-menu-item cx-menu-item--indent"
                    onClick={async () => {
                      setMenu(null)
                      const r = await api.voiceDisconnect(c.id, inVoice.nebulaId, m.user.id)
                      if (!r.ok) props.onProblem(r.message)
                    }}
                  >
                    Disconnect from voice
                  </button>
                </>
              )}
              {above && can(c, 'timeoutKick') && (
                <>
                  <span className="cx-menu-sub">Time out</span>
                  {m.timedOutUntil ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="cx-menu-item cx-menu-item--indent"
                      onClick={() => void act(() => api.endTimeout(c.id, m.user.id))}
                    >
                      Remove time-out
                    </button>
                  ) : (
                    TIMEOUT_LENGTHS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        role="menuitem"
                        className="cx-menu-item cx-menu-item--indent"
                        onClick={() => void act(() => api.timeout(c.id, m.user.id, l.id))}
                      >
                        {l.name}
                      </button>
                    ))
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="cx-menu-item cx-menu-item--danger"
                    onClick={() => {
                      setMenu(null)
                      setConfirm({ kind: 'kick', member: m })
                    }}
                  >
                    Kick {firstName(m.user)}
                  </button>
                </>
              )}
              {above && can(c, 'ban') && (
                <button
                  type="button"
                  role="menuitem"
                  className="cx-menu-item cx-menu-item--danger"
                  onClick={() => {
                    setMenu(null)
                    setConfirm({ kind: 'ban', member: m })
                  }}
                >
                  Ban {firstName(m.user)}
                </button>
              )}
            </div>
          )}
        </div>
      )
    })()

  // ---- The main area ----
  let main: React.ReactNode
  if (!nebula) {
    main = (
      <main className="cx-main cx-main--empty">
        <p>
          This constellation has no nebulas yet.
          {can(c, 'manageNebulas') ? ' Make one from the menu by its name.' : ''}
        </p>
      </main>
    )
  } else if (nebula.kind === 'voice' && !voiceChatOpen) {
    main = (
      <VoiceStage
        me={me}
        nebulaName={nebula.name}
        constellationName={c.name}
        state={c.voice.find((v) => v.nebulaId === nebula.id) ?? null}
        people={people}
        joinedHere={inVoiceHere?.id === nebula.id}
        timedOut={!!c.me.timedOutUntil}
        onJoin={() => joinVoice(nebula)}
        onOpenChat={() => setVoiceChatOpen(true)}
      />
    )
  } else if (summary && chatNebula) {
    main = (
      <main className="cx-main">
        {voiceChatOpen && (
          <button
            type="button"
            className="cx-back-to-voice"
            onClick={() => setVoiceChatOpen(false)}
          >
            <SpeakerIcon size={16} color="currentColor" />
            Back to {chatNebula.name}
          </button>
        )}
        <ChatView
          key={summary.id}
          me={me}
          conversation={summary}
          presence={props.presence}
          now={now}
          onRead={() => {
            if (chatNebula.unreadCount > 0) props.onReload()
          }}
          onViewProfile={props.onViewProfile}
          onGroupSettings={() => props.onSettings('overview')}
          onTogglePin={() => undefined}
          onSessionExpired={props.onSessionExpired}
          onSearch={() => setSearching(true)}
          onMute={() => undefined}
          onReport={(m) => {
            const sender = people.get(m.senderId)
            if (sender) props.onReport(m, sender)
          }}
          jumpRequest={jump}
          nebula={{
            name: chatNebula.name,
            // 0.7.5: on its milestone cards
            constellationIcon: (
              <ConstellationIcon
                id={c.id}
                name={c.name}
                color={c.color}
                iconVersion={c.iconVersion}
                className="cx-milestone-cicon"
                style={c.iconVersion ? undefined : { background: '#120c0a', color: 'var(--cxa)' }}
              />
            ),
            topic: chatNebula.topic,
            cantPost,
            roleOf: roleBadge,
            canDelete: (senderId) =>
              can(c, 'deleteMessages') && (outranks(c, me.id, senderId) || !people.has(senderId)),
            membersOpen,
            onToggleMembers: () => setMembersOpen((v) => !v),
            voiceCards,
            lineBefore: newSince.info?.nebulaId === chatNebula.id ? newSince.lineBefore : undefined,
            // 0.8.0: the search button searches the whole constellation (Ctrl+F: this nebula)
            onSearchAll: () => setSearchAll(true),
            // 0.8.0 events: a card under its "made an event 📅" message
            bodyFor: (m) => (eventsByMessage.has(m.id) ? 'made an event 📅' : null),
            // Communities round: slash commands and a bot's buttons.
            commands,
            runCommand: async (input) => {
              const r = await integrations.runCommand(c.id, chatNebula.id, input)
              if (!r.ok) return r.message
              return r.data.delivered ? null : "The bot didn't answer. It may be offline."
            },
            cardFor: (m) => {
              const e = eventsByMessage.get(m.id)
              if (!e)
                return m.buttons?.length && people.get(m.senderId)?.bot ? (
                  <BotButtons constellationId={c.id} messageId={m.id} buttons={m.buttons} onProblem={props.onProblem} />
                ) : null
              const vs = e.voiceNebulaId
                ? c.voice.find((v) => v.nebulaId === e.voiceNebulaId)
                : null
              return (
                <EventCard
                  event={e}
                  constellation={c}
                  now={Math.max(now, cxEvents.now)}
                  inVoice={vs?.userIds.length ?? 0}
                  onChanged={cxEvents.setEvent}
                  onEdit={(ev) => setEventDialog({ editing: ev })}
                  onJoinVoice={(id) => {
                    const v = c.nebulas.find((n) => n.id === id)
                    if (v) {
                      props.onSelectNebula(v.id)
                      if (inVoiceHere?.id !== v.id) joinVoice(v)
                    }
                  }}
                  onProblem={props.onProblem}
                />
              )
            },
            headerExtra: (
              <NotifyButton
                level={chatNebula.notify}
                fallback={c.me.notify}
                onChange={(level) => void setNotify(level)}
              />
            )
          }}
        />
        {newSince.info?.nebulaId === chatNebula.id && !voiceChatOpen && (
          <NewSincePill
            info={newSince.info}
            onJump={() => void scrollToNewLine()}
            onMarkRead={() => {
              newSince.clear()
              void window.glofly.conversations.markRead(chatNebula.conversationId)
            }}
          />
        )}
        {searching && (
          <SearchPanel
            me={me}
            conversations={[summary]}
            chatId={summary.id}
            initialQuery=""
            onClose={() => setSearching(false)}
            onOpen={(_conversationId, messageId) => {
              setSearching(false)
              setJump((j) => ({ messageId, nonce: (j?.nonce ?? 0) + 1 }))
            }}
          />
        )}
      </main>
    )
  }

  return (
    <div
      className={hasAccent(c) ? 'cx-inside cx-accented' : 'cx-inside'}
      style={{
        ['--cx-accent' as string]: theme.accent,
        ['--cx-glow' as string]: hexA(theme.glow, 0.45),
        ...accentStyle(c)
      }}
    >
      {strip}
      {sidebar}
      {main}
      {/* 0.7.5: the welcome screen, once, right after you join (about, rules, pick your roles) */}
      {needsWelcome(c) && welcomeShownFor !== c.id && (
        <WelcomeDialog
          detail={c}
          me={me}
          friendIds={props.friendIds}
          onDone={(next) => {
            setWelcomeShownFor(c.id)
            if (next) props.onChanged(next)
          }}
          onProblem={props.onProblem}
        />
      )}
      {eventDialog && (
        <EventDialog
          constellation={c}
          nebulaId={nebula?.kind === 'text' ? nebula.id : null}
          editing={eventDialog.editing}
          onClose={() => setEventDialog(null)}
          onSaved={(e) => {
            setEventDialog(null)
            cxEvents.reload()
            if (e?.messageId && !eventDialog.editing) showMessage(e.nebulaId, e.messageId)
          }}
        />
      )}
      {rolesOpen && (
        <YourRolesDialog
          detail={c}
          me={me}
          onClose={() => setRolesOpen(false)}
          onChanged={props.onChanged}
          onProblem={props.onProblem}
        />
      )}
      {searchAll ? (
        <CxSearch
          constellation={c}
          onClose={() => setSearchAll(false)}
          onJump={(targetNebulaId, messageId) => showMessage(targetNebulaId, messageId)}
        />
      ) : (
        nebula && (nebula.kind === 'text' || voiceChatOpen) && membersPanel
      )}
      {menuEl}
      {nebMenuEl}
      {livePeek && (
        <LivePreview
          key={`${livePeek.nebula.id}:${livePeek.sharer.id}`}
          constellationId={c.id}
          nebulaId={livePeek.nebula.id}
          nebulaName={livePeek.nebula.name}
          sharer={livePeek.sharer}
          game={
            c.members
              .find((m) => m.user.id === livePeek.sharer.id)
              ?.activity?.replace(/^Playing /, '') ?? null
          }
          watching={Math.max(0, (peekState?.userIds.length ?? 1) - 1)}
          anchor={livePeek.anchor}
          onJoinAndWatch={() => {
            const n = livePeek.nebula
            setLivePeek(null)
            joinVoice(n)
          }}
          onJustJoin={() => {
            const n = livePeek.nebula
            setLivePeek(null)
            joinVoice(n, false)
          }}
          onClose={() => setLivePeek(null)}
          onHoverChange={(over) => {
            peekOver.current = over
            if (over) clearPeekTimer()
            else leaveLive()
          }}
        />
      )}
      {confirm &&
        (confirm.kind === 'leave' ? (
          <ConfirmDialog
            title={`Leave ${c.name}?`}
            message="You won't see its nebulas anymore. You can come back later if it's public or someone invites you."
            confirmLabel="Leave"
            danger
            busy={busy}
            onConfirm={() => void confirmAction()}
            onCancel={() => setConfirm(null)}
          />
        ) : (
          <div
            className="cx-dialog-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setConfirm(null)}
          >
            <div role="dialog" aria-modal="true" className="cx-dialog cx-dialog--small">
              <div className="cx-dialog-body">
                <h1>
                  {confirm.kind === 'kick' ? 'Kick' : 'Ban'} {confirm.member!.user.displayName}?
                </h1>
                <p>
                  {confirm.kind === 'kick'
                    ? 'They leave the constellation. They can come back if they have an invite (or it’s public).'
                    : 'They leave the constellation and can’t come back until someone unbans them.'}
                </p>
                <label className="cx-field">
                  Reason (optional, noted in Moderation)
                  <input
                    type="text"
                    value={reason}
                    maxLength={200}
                    onChange={(e) => setReason(e.target.value)}
                    autoFocus
                  />
                </label>
                <div className="cx-dialog-actions">
                  <button type="button" className="cx-button" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="cx-button cx-button--danger"
                    disabled={busy}
                    onClick={() => void confirmAction()}
                  >
                    {confirm.kind === 'kick' ? 'Kick' : 'Ban'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
    </div>
  )
}

/** The nebula's notifications (header bell). */
function NotifyButton({
  level,
  fallback,
  onChange
}: {
  level: NotifyLevel | null
  fallback: NotifyLevel
  onChange: (level: NotifyLevel | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const shown = level ?? fallback
  const label = { all: 'All messages', mentions: 'Only @mentions', none: 'Nothing' }
  return (
    <div className="chat-header-wrap" ref={ref}>
      <button
        type="button"
        className={
          shown !== 'all' ? 'chat-header-button chat-header-button--on' : 'chat-header-button'
        }
        aria-label={`Notifications: ${label[shown]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Notifications: ${label[shown]}`}
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          width="19"
          height="19"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
          {shown === 'none' && <path d="M3 3l18 18" />}
        </svg>
      </button>
      {open && (
        <div role="menu" className="menu chat-mute-menu">
          <span className="menu-subhead">Notify me about</span>
          {(['all', 'mentions', 'none'] as const).map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={level === l}
              className="menu-item menu-item--indent"
              onClick={() => {
                setOpen(false)
                onChange(l)
              }}
            >
              {label[l]}
              {level === l && ' ✓'}
            </button>
          ))}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={level === null}
            className="menu-item menu-item--indent"
            onClick={() => {
              setOpen(false)
              onChange(null)
            }}
          >
            Same as the constellation ({label[fallback]}){level === null && ' ✓'}
          </button>
        </div>
      )}
    </div>
  )
}

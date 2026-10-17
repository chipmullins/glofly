import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { attachmentSummary } from '@glofly/shared/attachments'
import { shortBody } from '@glofly/shared/gifs'
import type {
  ConversationSummary,
  Message,
  Presence,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import GroupAvatar from '../components/GroupAvatar'
import StatusDot from '../components/StatusDot'
import EmojiPicker from '../components/EmojiPicker'
import EmojiText from '../components/EmojiText'
import { colorsFor } from '../lib/avatarColors'
import { chatTitle } from '../lib/groups'
import { onMobile, STATUS_LABEL } from '../lib/presence'
import { CloseIcon, LinkOutIcon } from './bits'
import { FireflyMark } from './sky'
import './Dock.css'

// The DM Dock (Chip, Oct 17; "Glofly Constellations · DM Dock" canvas, approved): while you're in
// Constellations, your Glofly chats stay one move away. A soft glowing line at the bottom edge;
// move the mouse to the very bottom and the dock rises (Home, your DMs, your groups, All chats).
// Click a face and their chat pops up right above it. When a message arrives while the dock is
// hidden, their face peeks up with a preview and a quick reply.

const MAX_DMS = 6
const MAX_GROUPS = 3
const MAX_OPEN = 3
const PEEK_MS = 6000

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username
const muted = (c: ConversationSummary): boolean =>
  !!c.mutedUntil && new Date(c.mutedUntil).getTime() > Date.now()

/** A face in the dock: a person (round) or a group (rounded square). */
function DockFace({
  c,
  me,
  size
}: {
  c: ConversationSummary
  me: SignedInUser
  size: number
}): React.JSX.Element {
  if (c.kind === 'dm') {
    const [bg, fg] = colorsFor(c.partner.id)
    return (
      <span
        className="dock-face-inner"
        style={{ background: bg, color: fg, fontSize: Math.round(size * 0.32) }}
      >
        <AvatarFace
          id={c.partner.id}
          name={c.partner.displayName}
          avatarVersion={c.partner.avatarVersion}
        />
      </span>
    )
  }
  return (
    <span className="dock-face-inner dock-face-inner--group">
      <GroupAvatar members={c.members} me={me} size={size} ring="#1c1210" group={c} />
    </span>
  )
}

/** One chat, popped up above the dock. */
function MiniChat({
  c,
  me,
  presence,
  onMinimize,
  onClose,
  onOpenFull,
  onCall,
  onRead
}: {
  c: ConversationSummary
  me: SignedInUser
  presence: Presence | undefined
  onMinimize: () => void
  onClose: () => void
  onOpenFull: () => void
  onCall: (() => void) | null
  onRead: (conversationId: string) => void
}): React.JSX.Element {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [people, setPeople] = useState<Record<string, PublicUser>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const title = chatTitle(c)

  useEffect(() => {
    let stale = false
    void window.glofly.conversations.messages(c.id).then((r) => {
      if (stale) return
      if (!r.ok) {
        setProblem(r.message)
        setMessages([])
        return
      }
      setMessages(r.data.messages)
      setPeople(Object.fromEntries(r.data.people.map((p) => [p.id, p])))
    })
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'message:new' && event.message.conversationId === c.id) {
        setMessages((list) =>
          list && !list.some((m) => m.id === event.message.id) ? [...list, event.message] : list
        )
        if (event.people)
          setPeople((map) => ({
            ...map,
            ...Object.fromEntries(event.people!.map((p) => [p.id, p]))
          }))
      }
      if (event.type === 'message:updated' && event.message.conversationId === c.id) {
        setMessages(
          (list) => list?.map((m) => (m.id === event.message.id ? event.message : m)) ?? list
        )
      }
    })
    inputRef.current?.focus()
    return () => {
      stale = true
      stop()
    }
  }, [c.id])

  // Open and showing: it's read.
  const lastId = messages?.at(-1)?.id
  useEffect(() => {
    if (!lastId) return
    void window.glofly.conversations.markRead(c.id).then(() => onRead(c.id))
  }, [lastId, c.id, onRead])

  useLayoutEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  async function send(): Promise<void> {
    const body = draft.trim()
    if (!body || sending || !c.canMessage) return
    setSending(true)
    setProblem(null)
    const r = await window.glofly.conversations.send(c.id, body)
    setSending(false)
    if (!r.ok) {
      setProblem(r.message)
      return
    }
    setDraft('')
    setMessages((list) =>
      list && !list.some((m) => m.id === r.data.id) ? [...list, r.data] : list
    )
  }

  const nameOf = (id: string): string =>
    id === me.id
      ? 'You'
      : ((c.members.find((m) => m.id === id) ?? people[id])?.displayName.split(/\s+/)[0] ??
        'Someone')
  const lastMine = [...(messages ?? [])].reverse().find((m) => m.senderId === me.id && !m.event)
  const seen =
    c.kind === 'dm' && lastMine && c.partnerReadAt && c.partnerReadAt >= lastMine.createdAt

  const dot = c.kind === 'dm' ? (presence?.status ?? 'offline') : null
  return (
    <section className="mini-chat" aria-label={`Chat with ${title}`}>
      <header className="mini-chat-head">
        <span className="mini-chat-face">
          <DockFace c={c} me={me} size={38} />
          {dot && (
            <StatusDot
              status={dot}
              mobile={onMobile(presence)}
              ring="var(--glo-surface)"
              size={11}
            />
          )}
        </span>
        <span className="mini-chat-title">
          <strong>
            <EmojiText text={title} />
          </strong>
          <span
            className={
              dot === 'online' ? 'mini-chat-status mini-chat-status--online' : 'mini-chat-status'
            }
          >
            {c.kind === 'dm'
              ? presence
                ? STATUS_LABEL[presence.status]
                : 'Offline'
              : `${c.memberCount} members`}
          </span>
        </span>
        {onCall && (
          <button
            type="button"
            className="mini-chat-button"
            aria-label="Voice call"
            title="Voice call (opens Glofly)"
            onClick={onCall}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
            </svg>
          </button>
        )}
        <button
          type="button"
          className="mini-chat-button"
          aria-label="Open in Glofly"
          title="Open in Glofly"
          onClick={onOpenFull}
        >
          <LinkOutIcon />
        </button>
        <button
          type="button"
          className="mini-chat-button"
          aria-label="Minimize"
          title="Minimize"
          onClick={onMinimize}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 12h12" />
          </svg>
        </button>
        <button
          type="button"
          className="mini-chat-button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="mini-chat-list" ref={listRef}>
        {messages === null && <p className="mini-chat-note">Loading…</p>}
        {messages?.length === 0 && !problem && <p className="mini-chat-note">Say hello!</p>}
        {messages?.map((m, i) => {
          const mine = m.senderId === me.id
          if (m.event) return null
          const previous = messages[i - 1]
          const showName = c.kind === 'group' && !mine && previous?.senderId !== m.senderId
          const text = m.deleted
            ? 'This message was deleted.'
            : m.gif || m.poll || m.game
              ? shortBody(m.body)
              : m.body || attachmentSummary(m.attachments)
          return (
            <div key={m.id} className={mine ? 'mini-msg mini-msg--mine' : 'mini-msg'}>
              {showName && <span className="mini-msg-name">{nameOf(m.senderId)}</span>}
              <span className={m.deleted ? 'mini-bubble mini-bubble--deleted' : 'mini-bubble'}>
                <EmojiText text={text} />
                {!m.deleted && m.body && m.attachments.length > 0 && (
                  <span className="mini-bubble-files">{attachmentSummary(m.attachments)}</span>
                )}
              </span>
            </div>
          )
        })}
        {seen && <span className="mini-seen">Seen</span>}
      </div>
      {problem && <p className="mini-chat-problem">{problem}</p>}
      <form
        className="mini-chat-compose"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <label className="mini-chat-input">
          <input
            ref={inputRef}
            type="text"
            placeholder={
              c.canMessage
                ? `Message ${c.kind === 'dm' ? firstName(c.partner) : title}`
                : "You can't message here right now"
            }
            aria-label={`Message ${title}`}
            value={draft}
            maxLength={4000}
            disabled={!c.canMessage}
            onChange={(e) => {
              setDraft(e.target.value)
              window.glofly.conversations.typing(c.id)
            }}
          />
          <button
            type="button"
            className="mini-chat-emoji"
            aria-label="Emoji"
            disabled={!c.canMessage}
            onClick={(e) => setEmojiAnchor(emojiAnchor ? null : e.currentTarget)}
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
              <circle cx="12" cy="12" r="9" />
              <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01" />
            </svg>
          </button>
        </label>
      </form>
      {emojiAnchor && (
        <EmojiPicker
          anchor={emojiAnchor}
          userId={me.id}
          label="Add an emoji"
          onPick={(emoji) => {
            setDraft((d) => d + emoji)
            setEmojiAnchor(null)
            inputRef.current?.focus()
          }}
          onClose={() => setEmojiAnchor(null)}
        />
      )}
      <span className="mini-chat-tail" aria-hidden="true" />
    </section>
  )
}

type AllFilter = 'all' | 'unread' | 'dms' | 'groups'

/** "8:31 PM", "Yesterday", "Tue", or "Oct 3": when a chat last had something new. */
function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days <= 0) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

/** The last message as one line: "You: lol same", "Jacob: who's bringing the speaker?". */
function previewLine(c: ConversationSummary, me: SignedInUser): string {
  const m = c.lastMessage
  if (!m) return 'No messages yet'
  if (m.deleted) return 'Message deleted'
  const text = (shortBody(m.body) || attachmentSummary(m.attachments)).replace(/\s+/g, ' ').trim()
  if (m.event) return text
  if (m.senderId === me.id) return `You: ${text}`
  if (c.kind === 'group') {
    const who = c.members.find((p) => p.id === m.senderId)
    return who ? `${firstName(who)}: ${text}` : text
  }
  return text
}

/** Does this chat match what was typed in "Find a chat"? */
function chatMatches(c: ConversationSummary, q: string): boolean {
  if (!q) return true
  const has = (x: string | null | undefined): boolean => !!x && x.toLowerCase().includes(q)
  if (has(chatTitle(c))) return true
  if (c.kind === 'dm') return has(c.partner.displayName) || has(c.partner.username)
  return c.members.some((p) => has(p.displayName) || has(p.username))
}

/** "All chats" from the dock (approved Oct 17, canvas board 7): every chat, without leaving. */
function AllChats({
  me,
  chats,
  presence,
  left,
  tailLeft,
  onPick,
  onNewChat,
  onHome,
  onClose
}: {
  me: SignedInUser
  chats: ConversationSummary[]
  presence: Record<string, Presence>
  left: number
  tailLeft: number
  onPick: (conversationId: string) => void
  onNewChat: () => void
  onHome: () => void
  onClose: () => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<AllFilter>('all')
  const [now] = useState(() => new Date())
  const q = query.trim().toLowerCase()
  const unreadCount = chats.filter((c) => c.unreadCount > 0).length
  const shown = chats.filter(
    (c) =>
      chatMatches(c, q) &&
      (filter === 'all' ||
        (filter === 'unread' && c.unreadCount > 0) ||
        (filter === 'dms' && c.kind === 'dm') ||
        (filter === 'groups' && c.kind === 'group'))
  )
  const chips: { id: AllFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'dms', label: 'DMs' },
    { id: 'groups', label: 'Groups' }
  ]
  return (
    <section className="all-chats" role="dialog" aria-label="All chats" style={{ left }}>
      <header className="all-chats-head">
        <h2>All chats</h2>
        <button
          type="button"
          className="all-chats-icon"
          aria-label="New chat"
          title="New chat (opens Glofly)"
          onClick={onNewChat}
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
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button
          type="button"
          className="all-chats-icon"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </header>
      <div className="all-chats-search-row">
        <label className="all-chats-search">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Find a chat"
            aria-label="Find a chat"
            autoFocus
            value={query}
            maxLength={40}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && shown[0]) onPick(shown[0].id)
            }}
          />
        </label>
      </div>
      <div className="all-chats-filters" role="group" aria-label="Show">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="all-chats-chip"
            aria-pressed={filter === chip.id}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label}
            {chip.id === 'unread' && unreadCount > 0 && (
              <span className="all-chats-chip-count">{unreadCount}</span>
            )}
          </button>
        ))}
      </div>
      <ul className="all-chats-list">
        {shown.map((c) => {
          const p = c.kind === 'dm' ? presence[c.partner.id] : undefined
          const quiet = muted(c)
          const unread = c.unreadCount > 0
          return (
            <li key={c.id}>
              <button
                type="button"
                className={[
                  'all-chats-row',
                  unread && 'all-chats-row--unread',
                  quiet && 'all-chats-row--muted'
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`${chatTitle(c)}${unread ? `, ${c.unreadCount} unread` : ''}${quiet ? ', muted' : ''}`}
                onClick={() => onPick(c.id)}
              >
                <span
                  className={
                    c.kind === 'group' ? 'all-chats-face all-chats-face--group' : 'all-chats-face'
                  }
                >
                  <DockFace c={c} me={me} size={40} />
                  {c.kind === 'dm' && (
                    <StatusDot
                      status={p?.status ?? 'offline'}
                      mobile={onMobile(p)}
                      ring="#1c1210"
                      size={11}
                    />
                  )}
                </span>
                <span className="all-chats-text">
                  <span className="all-chats-name-row">
                    <span className="all-chats-name">
                      <EmojiText text={chatTitle(c)} />
                    </span>
                    {c.pinnedAt && (
                      <svg
                        className="all-chats-flag"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        role="img"
                        aria-label="Pinned"
                      >
                        <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
                        <path d="M12 15v6" />
                      </svg>
                    )}
                    {quiet && (
                      <svg
                        className="all-chats-flag all-chats-flag--muted"
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        role="img"
                        aria-label="Muted"
                      >
                        <path d="M6 10a6 6 0 0 1 10-4.5M18 10v4l2 3H8" />
                        <path d="M10 20a2 2 0 0 0 4 0M4 4l16 16" />
                      </svg>
                    )}
                  </span>
                  <span className="all-chats-preview">
                    <EmojiText text={previewLine(c, me)} />
                  </span>
                </span>
                <span className="all-chats-side">
                  <span className="all-chats-time">{listTime(c.activityAt, now)}</span>
                  <span className="all-chats-open">Open chat</span>
                  {unread && (
                    <span
                      className={
                        quiet ? 'all-chats-badge all-chats-badge--muted' : 'all-chats-badge'
                      }
                    >
                      {c.unreadCount > 99 ? '99+' : c.unreadCount}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="all-chats-empty">
            {chats.length === 0 ? 'No chats yet' : 'Nothing matches'}
          </li>
        )}
      </ul>
      <footer className="all-chats-foot">
        <span>
          {chats.length} {chats.length === 1 ? 'chat' : 'chats'}
        </span>
        <button type="button" className="all-chats-home" onClick={onHome}>
          Open Glofly
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M14 4h6v6M20 4l-8 8" />
            <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </button>
      </footer>
      <span className="all-chats-tail" aria-hidden="true" style={{ left: tailLeft }} />
    </section>
  )
}

export default function DmDock({
  me,
  conversations,
  presence,
  night,
  onHome,
  onOpenFull,
  onCall,
  onRead
}: {
  me: SignedInUser
  conversations: ConversationSummary[]
  presence: Record<string, Presence>
  /** On the night-sky dashboard: a touch more see-through */
  night: boolean
  /** Back to Glofly */
  onHome: () => void
  /** Back to Glofly with this chat open */
  onOpenFull: (conversationId: string) => void
  /** Back to Glofly and call them */
  onCall: (conversation: ConversationSummary) => void
  onRead: (conversationId: string) => void
}): React.JSX.Element {
  const [shown, setShown] = useState(false)
  const [open, setOpen] = useState<string[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ message: Message; conversationId: string } | null>(null)
  const [reply, setReply] = useState('')
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Touching the edge and wandering off without reaching the dock lowers it again a moment later.
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stayUp = (): void => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }
  const hideSoon = (): void => {
    stayUp()
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      setShown(false)
      setHover(null)
    }, 700)
  }
  useEffect(() => stayUp, [])
  const dockRef = useRef<HTMLElement>(null)
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())
  const [anchorX, setAnchorX] = useState<number | null>(null)
  /** "All chats" is open above the dock */
  const [allOpen, setAllOpen] = useState(false)
  const allRef = useRef<HTMLButtonElement>(null)
  const [allX, setAllX] = useState<number | null>(null)

  const visible = conversations.filter(
    (c) => !c.closedAt || (c.lastMessage?.createdAt && c.lastMessage.createdAt > c.closedAt)
  )
  const pinsFirst = (a: ConversationSummary, b: ConversationSummary): number =>
    (a.pinnedAt ? 0 : 1) - (b.pinnedAt ? 0 : 1) ||
    (a.pinnedAt && b.pinnedAt
      ? a.pinnedAt.localeCompare(b.pinnedAt)
      : b.activityAt.localeCompare(a.activityAt))
  const dms: ConversationSummary[] = visible
    .filter((c) => c.kind === 'dm')
    .sort(pinsFirst)
    .slice(0, MAX_DMS)
  const groups: ConversationSummary[] = visible
    .filter((c) => c.kind === 'group')
    .sort(pinsFirst)
    .slice(0, MAX_GROUPS)
  // A chat that's open but no longer in the top few stays in the dock while it's open.
  const extra = open
    .map((id) => conversations.find((c) => c.id === id))
    .filter((c): c is ConversationSummary => !!c && !dms.includes(c) && !groups.includes(c))
  const unreadChats = conversations.filter((c) => c.unreadCount > 0 && !muted(c)).length
  const byId = useCallback(
    (id: string) => conversations.find((c) => c.id === id) ?? null,
    [conversations]
  )
  const expandedChat = expanded ? byId(expanded) : null

  const popupOpen = !!expandedChat || allOpen
  const up = shown || popupOpen

  // Where the open chat sits: above its face in the dock.
  useLayoutEffect(() => {
    if (!expanded) return
    const el = itemRefs.current.get(expanded)
    if (el) {
      const r = el.getBoundingClientRect()
      setAnchorX(r.left + r.width / 2)
    }
  }, [expanded, up, conversations])

  function openChat(id: string): void {
    setOpen((list) => (list.includes(id) ? list : [...list, id].slice(-MAX_OPEN)))
    setExpanded(id)
    setPeek(null)
    setAllOpen(false)
  }

  // "All chats" sits above its button; Escape or a click anywhere else closes it.
  useLayoutEffect(() => {
    if (!allOpen) return
    const r = allRef.current?.getBoundingClientRect()
    if (r) setAllX(r.left + r.width / 2)
  }, [allOpen, up, conversations])
  useEffect(() => {
    if (!allOpen) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setAllOpen(false)
        return
      }
      const target = e.target as HTMLElement
      if (target.closest?.('.all-chats, .dock-all')) return
      setAllOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [allOpen])
  // The panel: 380 px wide, its tail under the All chats button (kept inside the window).
  const allLeft =
    allX === null ? 12 : Math.max(12, Math.min(window.innerWidth - 392, Math.round(allX - 320)))
  const allTail = allX === null ? 311 : Math.round(allX - allLeft - 9)
  const allChats = [...visible].sort(pinsFirst)
  function closeChat(id: string): void {
    setOpen((list) => list.filter((x) => x !== id))
    if (expanded === id) setExpanded(null)
  }

  // A message arrives while the dock is hidden: their face peeks up with a preview.
  useEffect(() => {
    return window.glofly.onEvent((event) => {
      if (event.type !== 'message:new') return
      const m = event.message
      if (m.senderId === me.id || m.event) return
      const c = conversations.find((x) => x.id === m.conversationId)
      if (!c || muted(c)) return
      if (expanded === c.id) return
      setPeek({ message: m, conversationId: c.id })
      setReply('')
      if (peekTimer.current) clearTimeout(peekTimer.current)
      peekTimer.current = setTimeout(() => setPeek(null), PEEK_MS)
    })
  }, [conversations, expanded, me.id])
  useEffect(
    () => () => {
      if (peekTimer.current) clearTimeout(peekTimer.current)
    },
    []
  )

  const peekChat = peek ? byId(peek.conversationId) : null
  const peekPerson =
    peek && peekChat
      ? peekChat.kind === 'dm'
        ? peekChat.partner
        : peekChat.members.find((m) => m.id === peek.message.senderId)
      : null

  async function sendReply(): Promise<void> {
    if (!peek || !reply.trim()) return
    const r = await window.glofly.conversations.send(peek.conversationId, reply.trim())
    if (r.ok) {
      setReply('')
      setPeek(null)
    }
  }

  const item = (c: ConversationSummary): React.JSX.Element => {
    const isOpen = open.includes(c.id)
    const p = c.kind === 'dm' ? presence[c.partner.id] : undefined
    const label = `${chatTitle(c)}${c.unreadCount ? `, ${c.unreadCount} unread` : ''}${p ? `, ${STATUS_LABEL[p.status]}` : ''}${isOpen ? ' (chat open)' : ''}`
    return (
      <span key={c.id} className="dock-slot">
        <button
          type="button"
          ref={(el) => {
            if (el) itemRefs.current.set(c.id, el)
            else itemRefs.current.delete(c.id)
          }}
          className={[
            'dock-item',
            c.kind === 'group' && 'dock-item--group',
            expanded === c.id && 'dock-item--current',
            c.kind === 'dm' && p?.status === 'offline' && 'dock-item--offline'
          ]
            .filter(Boolean)
            .join(' ')}
          aria-label={label}
          aria-current={expanded === c.id ? 'true' : undefined}
          onMouseEnter={() => setHover(c.id)}
          onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
          onFocus={() => setHover(c.id)}
          onBlur={() => setHover((h) => (h === c.id ? null : h))}
          onClick={() => (expanded === c.id ? setExpanded(null) : openChat(c.id))}
        >
          <DockFace c={c} me={me} size={50} />
          {c.unreadCount > 0 && !muted(c) && (
            <span className="dock-badge">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>
          )}
          {c.kind === 'dm' && p && p.status !== 'offline' && (
            <span className="dock-status">
              <StatusDot status={p.status} mobile={onMobile(p)} ring="#1c1210" size={13} />
            </span>
          )}
        </button>
        {isOpen && <span className="dock-running" aria-hidden="true" />}
        {hover === c.id && expanded !== c.id && (
          <span role="tooltip" className="dock-tip">
            <EmojiText text={chatTitle(c)} />
            {p && (
              <span
                className={
                  p.status === 'online'
                    ? 'dock-tip-status dock-tip-status--online'
                    : 'dock-tip-status'
                }
              >
                · {STATUS_LABEL[p.status]}
              </span>
            )}
          </span>
        )}
      </span>
    )
  }

  return (
    <div className={night ? 'dock-root dock-root--night' : 'dock-root'}>
      {/* The bottom edge: move the mouse here and the dock rises. */}
      <div
        className="dock-edge"
        aria-hidden="true"
        onMouseEnter={() => {
          stayUp()
          setShown(true)
        }}
        onMouseLeave={hideSoon}
      >
        {!up && !peek && (
          <>
            <span className="dock-hint" />
            {unreadChats > 0 && (
              <span className="dock-hint-count">{unreadChats > 9 ? '9+' : unreadChats}</span>
            )}
          </>
        )}
      </div>

      {allOpen && (
        <AllChats
          me={me}
          chats={allChats}
          presence={presence}
          left={allLeft}
          tailLeft={allTail}
          onPick={openChat}
          onNewChat={() => {
            setAllOpen(false)
            onHome()
          }}
          onHome={() => {
            setAllOpen(false)
            onHome()
          }}
          onClose={() => setAllOpen(false)}
        />
      )}

      {expandedChat && (
        <div className="mini-chat-wrap" style={{ left: anchorX ?? window.innerWidth / 2 }}>
          <MiniChat
            key={expandedChat.id}
            c={expandedChat}
            me={me}
            presence={expandedChat.kind === 'dm' ? presence[expandedChat.partner.id] : undefined}
            onMinimize={() => setExpanded(null)}
            onClose={() => closeChat(expandedChat.id)}
            onOpenFull={() => {
              closeChat(expandedChat.id)
              onOpenFull(expandedChat.id)
            }}
            onCall={expandedChat.canMessage ? () => onCall(expandedChat) : null}
            onRead={onRead}
          />
        </div>
      )}

      {/* Minimized chats wait as little pills beside the open one. */}
      {up && open.filter((id) => id !== expanded).length > 0 && (
        <div className="mini-pills">
          {open
            .filter((id) => id !== expanded)
            .map((id) => byId(id))
            .filter((c): c is ConversationSummary => !!c)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                className="mini-pill"
                aria-label={`${chatTitle(c)}'s chat, minimized${c.unreadCount ? `, ${c.unreadCount} unread` : ''}`}
                onClick={() => setExpanded(c.id)}
              >
                <span className="mini-pill-face">
                  <DockFace c={c} me={me} size={36} />
                </span>
                <span className="mini-pill-name">
                  {c.kind === 'dm' ? firstName(c.partner) : chatTitle(c)}
                </span>
                {c.unreadCount > 0 && (
                  <span className="dock-badge dock-badge--inline">{c.unreadCount}</span>
                )}
              </button>
            ))}
        </div>
      )}

      {peek && peekChat && !up && (
        <div
          className="dock-peek"
          onMouseEnter={() => peekTimer.current && clearTimeout(peekTimer.current)}
        >
          <div role="status" className="dock-peek-card">
            <div className="dock-peek-top">
              <span className="dock-peek-text">
                <strong>
                  <EmojiText
                    text={
                      peekChat.kind === 'dm'
                        ? peekChat.partner.displayName
                        : `${peekPerson ? firstName(peekPerson) : 'Someone'} · ${chatTitle(peekChat)}`
                    }
                  />
                </strong>
                <span>
                  <EmojiText
                    text={
                      peek.message.body
                        ? shortBody(peek.message.body)
                        : attachmentSummary(peek.message.attachments)
                    }
                  />
                </span>
              </span>
              <span className="dock-peek-when">now</span>
            </div>
            {peekChat.canMessage && (
              <form
                className="dock-peek-reply"
                onSubmit={(e) => {
                  e.preventDefault()
                  void sendReply()
                }}
              >
                <input
                  type="text"
                  placeholder={`Reply to ${peekChat.kind === 'dm' ? firstName(peekChat.partner) : chatTitle(peekChat)}`}
                  aria-label="Quick reply"
                  value={reply}
                  maxLength={4000}
                  onChange={(e) => setReply(e.target.value)}
                  onFocus={() => peekTimer.current && clearTimeout(peekTimer.current)}
                />
                <button type="submit" aria-label="Send" disabled={!reply.trim()}>
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </form>
            )}
          </div>
          <button
            type="button"
            className="dock-peek-face"
            aria-label={`Open ${chatTitle(peekChat)}'s chat`}
            onClick={() => openChat(peekChat.id)}
          >
            <DockFace c={peekChat} me={me} size={60} />
            <span className="dock-badge">1</span>
          </button>
        </div>
      )}

      <div
        className={up ? 'dock-bar dock-bar--up' : 'dock-bar'}
        onMouseEnter={stayUp}
        onMouseLeave={() => {
          stayUp()
          setShown(false)
          setHover(null)
        }}
      >
        <nav aria-label="Your Glofly chats" className="dock" ref={dockRef} aria-hidden={!up}>
          <span className="dock-slot">
            <button
              type="button"
              className="dock-item dock-home"
              aria-label="Back to Glofly home"
              tabIndex={up ? 0 : -1}
              onMouseEnter={() => setHover('home')}
              onMouseLeave={() => setHover(null)}
              onClick={onHome}
            >
              <FireflyMark size={30} />
            </button>
            {hover === 'home' && (
              <span role="tooltip" className="dock-tip">
                Back to Glofly
              </span>
            )}
          </span>
          {(dms.length > 0 || extra.some((c) => c.kind === 'dm')) && (
            <span className="dock-line" aria-hidden="true" />
          )}
          {[...dms, ...extra.filter((c) => c.kind === 'dm')].map(item)}
          {(groups.length > 0 || extra.some((c) => c.kind === 'group')) && (
            <span className="dock-line" aria-hidden="true" />
          )}
          {[...groups, ...extra.filter((c) => c.kind === 'group')].map(item)}
          <span className="dock-line" aria-hidden="true" />
          <span className="dock-slot">
            <button
              type="button"
              ref={allRef}
              className={allOpen ? 'dock-item dock-all dock-item--current' : 'dock-item dock-all'}
              aria-label={allOpen ? 'All your chats (open)' : 'All your chats'}
              aria-expanded={allOpen}
              aria-haspopup="dialog"
              tabIndex={up ? 0 : -1}
              onMouseEnter={() => setHover('all')}
              onMouseLeave={() => setHover(null)}
              onClick={() => {
                if (allOpen) {
                  setAllOpen(false)
                  return
                }
                setExpanded(null)
                setPeek(null)
                setAllOpen(true)
              }}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 5h16v10H9l-5 4z" />
                <path d="M8 9h8M8 12h5" />
              </svg>
            </button>
            {allOpen && <span className="dock-running" aria-hidden="true" />}
            {hover === 'all' && !allOpen && (
              <span role="tooltip" className="dock-tip">
                All chats
              </span>
            )}
          </span>
        </nav>
      </div>
    </div>
  )
}

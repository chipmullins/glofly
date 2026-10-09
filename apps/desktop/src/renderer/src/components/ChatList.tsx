import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationSummary, Presence, PublicUser } from '../../../preload/api-types'
import { attachmentSummary } from '../lib/attachments'
import type { ChatResult } from '../lib/chatSearch'
import { chatTitle, eventText, memberCountLabel, typingText } from '../lib/groups'
import { useTypingByChat } from '../lib/typingWatch'
import { joinedCount, useCalls } from '../calls/callState'
import { playing, presenceLine } from '../lib/presence'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import GroupAvatar from './GroupAvatar'
import { ChatIcon, GroupIcon, LeaveIcon, PlusIcon, ProfileIcon, SearchIcon } from './icons'

export function PinIcon({ size = 13 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 3h6l-1 6 4 4v2H6v-2l4-4z" />
    </svg>
  )
}

type ChatListProps = {
  me: PublicUser
  conversations: ConversationSummary[]
  presence: Record<string, Presence>
  now: number
  openChatId: string | null
  /** What's typed in "Find a friend or chat" */
  query: string
  results: ChatResult[]
  /** Which search result the arrow keys are on */
  highlighted: number
  onOpen: (conversationId: string) => void
  onOpenResult: (result: ChatResult) => void
  onTogglePin: (conversation: ConversationSummary) => void
  onViewProfile: (user: PublicUser) => void
  onGroupSettings: (conversation: ConversationSummary) => void
  onLeaveGroup: (conversation: ConversationSummary) => void
  onNewMessage: () => void
  onNewGroup: () => void
  /** Opens message search across all chats with this text */
  onSearchMessages: (query: string) => void
}

/** The sidebar's one-line preview of a chat's latest message. */
function lastMessagePreview(c: ConversationSummary, me: PublicUser): string {
  const last = c.lastMessage
  if (!last) return 'No messages yet'
  const nameOf = (id: string): string =>
    c.members.find((m) => m.id === id)?.displayName.split(/\s+/)[0] ?? 'Someone'
  if (last.event) return eventText(last.event, last.senderId, me.id, nameOf)
  const text = last.deleted
    ? 'Message deleted'
    : last.body.replace(/\s+/g, ' ') || attachmentSummary(last.attachments)
  // Groups say who sent it ("Maya: hi"); DMs only mark your own ("You: hi").
  const who =
    last.senderId === me.id ? 'You: ' : c.kind === 'group' ? `${nameOf(last.senderId)}: ` : ''
  return who + text
}

/** One chat in the sidebar (from the design: avatar with status, name, status or last message). */
function DmRow({
  c,
  me,
  active,
  presence,
  now,
  typingIds,
  onOpen,
  onMenu
}: {
  c: ConversationSummary
  me: PublicUser
  active: boolean
  presence: Presence | undefined
  now: number
  /** People typing in this chat right now */
  typingIds: string[] | undefined
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}): React.JSX.Element {
  // Like the design: friends show their status; otherwise the last message (groups always).
  // A call going on shows instead: "In call · 4 of 6" (GroupCall.dc.html).
  const calls = useCalls()
  const call = calls.callIn(c.id)
  const callLabel = call
    ? call.status === 'ringing' && joinedCount(call) <= 1
      ? 'Calling…'
      : c.kind === 'group'
        ? `In call · ${joinedCount(call)} of ${call.members.length}`
        : 'In call'
    : null
  // Someone typing in a chat you're not looking at: "typing…" (DMs) or "Maya is typing…" (groups).
  // The open chat shows its own typing line, so the sidebar leaves that one alone.
  const typingNames =
    !active && typingIds?.length
      ? typingIds
          .map((id) => c.members.find((m) => m.id === id)?.displayName.split(/\s+/)[0])
          .filter((name): name is string => !!name)
      : []
  const typingLabel =
    typingNames.length === 0 ? null : c.kind === 'dm' ? 'typing…' : typingText(typingNames)
  const preview =
    callLabel ??
    typingLabel ??
    (presence && c.kind === 'dm' ? presenceLine(presence, now) : lastMessagePreview(c, me))
  const title = chatTitle(c)
  const ring = active ? 'var(--glo-accent-soft)' : 'var(--glo-sidebar)'
  return (
    <button
      type="button"
      className={active ? 'dm-row dm-row--active' : 'dm-row'}
      aria-current={active ? 'page' : undefined}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        // From the keyboard (menu key) there's no pointer position: open it by the row.
        const rect = e.currentTarget.getBoundingClientRect()
        onMenu(e.clientX || rect.left + 40, e.clientY || rect.bottom)
      }}
    >
      {c.kind === 'dm' ? (
        <Avatar
          id={c.partner.id}
          name={c.partner.displayName}
          avatarVersion={c.partner.avatarVersion}
          size={40}
          status={presence?.status}
          ring={ring}
        />
      ) : (
        <GroupAvatar members={c.members} me={me} size={40} ring={ring} />
      )}
      <span className="dm-text">
        <span
          className={c.unreadCount > 0 || active ? 'dm-name dm-name--strong' : 'dm-name'}
          title={c.kind === 'group' ? `${title} · ${memberCountLabel(c.memberCount)}` : undefined}
        >
          <EmojiText text={title} />
        </span>
        <span
          className={
            callLabel
              ? 'dm-preview dm-preview--call'
              : typingLabel
                ? 'dm-preview dm-preview--typing'
                : c.kind === 'dm' && playing(presence)
                  ? 'dm-preview dm-preview--playing'
                  : 'dm-preview'
          }
        >
          {typingLabel && !callLabel && (
            <span className="dm-typing-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          )}
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
}

/** Right-click menu on a chat: pin or unpin, then view profile (DMs) or group options. */
function RowMenu({
  conversation,
  x,
  y,
  onTogglePin,
  onViewProfile,
  onGroupSettings,
  onLeaveGroup,
  onClose
}: {
  conversation: ConversationSummary
  x: number
  y: number
  onTogglePin: () => void
  onViewProfile: () => void
  onGroupSettings: () => void
  onLeaveGroup: () => void
  onClose: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  // Keep it inside the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8)
    })
    el.querySelector<HTMLButtonElement>('button')?.focus()
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const pinned = !!conversation.pinnedAt
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${chatTitle(conversation)} chat options`}
      className="menu row-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        onClick={() => {
          onClose()
          onTogglePin()
        }}
      >
        <PinIcon size={18} />
        {pinned ? 'Unpin chat' : 'Pin chat'}
      </button>
      {conversation.kind === 'dm' ? (
        <button
          type="button"
          role="menuitem"
          className="menu-item"
          onClick={() => {
            onClose()
            onViewProfile()
          }}
        >
          <ProfileIcon size={18} />
          View profile
        </button>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              onClose()
              onGroupSettings()
            }}
          >
            <GroupIcon size={18} />
            Group settings
          </button>
          <div className="menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-item--danger"
            onClick={() => {
              onClose()
              onLeaveGroup()
            }}
          >
            <LeaveIcon size={18} />
            Leave group
          </button>
        </>
      )}
    </div>
  )
}

export default function ChatList({
  me,
  conversations,
  presence,
  now,
  openChatId,
  query,
  results,
  highlighted,
  onOpen,
  onOpenResult,
  onTogglePin,
  onViewProfile,
  onGroupSettings,
  onLeaveGroup,
  onNewMessage,
  onNewGroup,
  onSearchMessages
}: ChatListProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const typing = useTypingByChat(me.id)
  const menuFor = conversations.find((c) => c.id === menu?.id) ?? null

  // Pinned chats in the order they were pinned; everything else by latest activity.
  const pinned = conversations
    .filter((c) => c.pinnedAt)
    .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? ''))
  const others = conversations.filter((c) => !c.pinnedAt)

  const row = (c: ConversationSummary): React.ReactNode => (
    <DmRow
      key={c.id}
      c={c}
      me={me}
      active={c.id === openChatId}
      presence={c.kind === 'dm' ? presence[c.partner.id] : undefined}
      now={now}
      typingIds={typing[c.id]}
      onOpen={() => onOpen(c.id)}
      onMenu={(x, y) => setMenu({ id: c.id, x, y })}
    />
  )

  if (query.trim()) {
    return (
      <>
        <div className="section-head">
          <span>Results</span>
        </div>
        {results.length === 0 ? (
          <p className="search-empty">No friends or chats match “{query.trim()}”.</p>
        ) : (
          <div
            className="dm-list"
            role="listbox"
            id="chat-search-results"
            aria-label="Friends and chats"
          >
            {results.map((r, i) => {
              if (r.kind === 'group') {
                const g = r.conversation
                return (
                  <button
                    key={g.id}
                    type="button"
                    role="option"
                    id={`chat-result-${i}`}
                    aria-selected={i === highlighted}
                    className={i === highlighted ? 'dm-row dm-row--highlight' : 'dm-row'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onOpenResult(r)}
                  >
                    <GroupAvatar
                      members={g.members}
                      me={me}
                      size={40}
                      ring={i === highlighted ? 'var(--glo-hover)' : 'var(--glo-sidebar)'}
                    />
                    <span className="dm-text">
                      <span className="dm-name dm-name--strong">
                        <EmojiText text={chatTitle(g)} />
                      </span>
                      <span className="dm-preview">Group · {memberCountLabel(g.memberCount)}</span>
                    </span>
                    {g.pinnedAt && (
                      <span className="dm-pin" title="Pinned">
                        <PinIcon />
                      </span>
                    )}
                  </button>
                )
              }
              const p = presence[r.user.id]
              return (
                <button
                  key={r.user.id}
                  type="button"
                  role="option"
                  id={`chat-result-${i}`}
                  aria-selected={i === highlighted}
                  className={i === highlighted ? 'dm-row dm-row--highlight' : 'dm-row'}
                  // Keep focus in the search box while picking with the mouse.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onOpenResult(r)}
                >
                  <Avatar
                    id={r.user.id}
                    name={r.user.displayName}
                    avatarVersion={r.user.avatarVersion}
                    size={40}
                    status={p?.status}
                    ring={i === highlighted ? 'var(--glo-hover)' : 'var(--glo-sidebar)'}
                  />
                  <span className="dm-text">
                    <span className="dm-name dm-name--strong">{r.user.displayName}</span>
                    <span className="dm-preview">
                      @{r.user.username}
                      {r.conversation ? '' : ' · Start a chat'}
                    </span>
                  </span>
                  {r.conversation?.pinnedAt && (
                    <span className="dm-pin" title="Pinned">
                      <PinIcon />
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {query.trim().length >= 2 && (
          <button
            type="button"
            className="search-messages-row"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSearchMessages(query.trim())}
          >
            <SearchIcon size={17} />
            <span>
              Search messages for <strong>“{query.trim()}”</strong>
            </span>
          </button>
        )}
      </>
    )
  }

  return (
    <>
      {pinned.length > 0 && (
        <>
          <div className="section-head section-head--pinned">
            <span>
              <PinIcon />
              Pinned
            </span>
          </div>
          <nav aria-label="Pinned chats" className="dm-list">
            {pinned.map(row)}
          </nav>
        </>
      )}

      <div className="section-head">
        <span>Chats</span>
        <span className="section-head-actions">
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label="New group chat"
            title="New group chat"
            onClick={onNewGroup}
          >
            <GroupIcon size={17} />
          </button>
          <button
            type="button"
            className="icon-button icon-button--small"
            aria-label="New message"
            title="New message"
            onClick={onNewMessage}
          >
            <PlusIcon />
          </button>
        </span>
      </div>

      {conversations.length === 0 ? (
        <div className="dm-empty">
          <ChatIcon />
          <p>No conversations yet. Messages and group chats with friends will show up here.</p>
        </div>
      ) : others.length === 0 ? (
        <p className="search-empty">All your chats are pinned.</p>
      ) : (
        <nav aria-label="Chats" className="dm-list">
          {others.map(row)}
        </nav>
      )}

      {menu && menuFor && (
        <RowMenu
          conversation={menuFor}
          x={menu.x}
          y={menu.y}
          onTogglePin={() => onTogglePin(menuFor)}
          onViewProfile={() => menuFor.partner && onViewProfile(menuFor.partner)}
          onGroupSettings={() => onGroupSettings(menuFor)}
          onLeaveGroup={() => onLeaveGroup(menuFor)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

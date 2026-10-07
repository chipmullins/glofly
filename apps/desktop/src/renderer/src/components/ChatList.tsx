import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ConversationSummary, Presence, PublicUser } from '../../../preload/api-types'
import { attachmentSummary } from '../lib/attachments'
import type { ChatResult } from '../lib/chatSearch'
import { presenceLine } from '../lib/presence'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import { ChatIcon, PlusIcon, ProfileIcon } from './icons'

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
  meId: string
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
  onNewMessage: () => void
}

/** One chat in the sidebar (from the design: avatar with status, name, status or last message). */
function DmRow({
  c,
  meId,
  active,
  presence,
  now,
  onOpen,
  onMenu
}: {
  c: ConversationSummary
  meId: string
  active: boolean
  presence: Presence | undefined
  now: number
  onOpen: () => void
  onMenu: (x: number, y: number) => void
}): React.JSX.Element {
  const last = c.lastMessage
  // Like the design: friends show their status; otherwise the last message.
  const preview = presence
    ? presenceLine(presence, now)
    : !last
      ? 'No messages yet'
      : `${last.senderId === meId ? 'You: ' : ''}${
          last.deleted
            ? 'Message deleted'
            : last.body.replace(/\s+/g, ' ') || attachmentSummary(last.attachments)
        }`
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
      <Avatar
        id={c.partner.id}
        name={c.partner.displayName}
        avatarVersion={c.partner.avatarVersion}
        size={40}
        status={presence?.status}
        ring={active ? 'var(--glo-accent-soft)' : 'var(--glo-sidebar)'}
      />
      <span className="dm-text">
        <span className={c.unreadCount > 0 || active ? 'dm-name dm-name--strong' : 'dm-name'}>
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
}

/** Right-click menu on a chat: pin or unpin, view profile. */
function RowMenu({
  conversation,
  x,
  y,
  onTogglePin,
  onViewProfile,
  onClose
}: {
  conversation: ConversationSummary
  x: number
  y: number
  onTogglePin: () => void
  onViewProfile: () => void
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
      aria-label={`${conversation.partner.displayName} chat options`}
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
    </div>
  )
}

export default function ChatList({
  meId,
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
  onNewMessage
}: ChatListProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
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
      meId={meId}
      active={c.id === openChatId}
      presence={presence[c.partner.id]}
      now={now}
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
        <span>Direct messages</span>
        <button
          type="button"
          className="icon-button icon-button--small"
          aria-label="New message or group chat"
          title="New message"
          onClick={onNewMessage}
        >
          <PlusIcon />
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="dm-empty">
          <ChatIcon />
          <p>No conversations yet. Messages with friends will show up here.</p>
        </div>
      ) : others.length === 0 ? (
        <p className="search-empty">All your chats are pinned.</p>
      ) : (
        <nav aria-label="Direct messages" className="dm-list">
          {others.map(row)}
        </nav>
      )}

      {menu && menuFor && (
        <RowMenu
          conversation={menuFor}
          x={menu.x}
          y={menu.y}
          onTogglePin={() => onTogglePin(menuFor)}
          onViewProfile={() => onViewProfile(menuFor.partner)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

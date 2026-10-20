import { useRef, useState } from 'react'
import type {
  ConversationSummary,
  MuteDuration,
  Presence,
  PublicUser
} from '../../../preload/api-types'
import type { ChatResult } from '../lib/chatSearch'
import { chatTitle, memberCountLabel, typingText } from '../lib/groups'
import { useTypingByChat } from '../lib/typingWatch'
import { useSocial } from '../lib/social'
import { BirthdayMark, GlowMark } from './Social'
import { joinedCount, useCalls } from '../calls/callState'
import { onMobile, playing, presenceLine } from '../lib/presence'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import GroupAvatar from './GroupAvatar'
import ContextMenu, { MenuItem } from './ContextMenu'
import MuteMenuItems from './MuteMenu'
import { isClosed, isMuted, mutedLabel } from '../lib/mentions'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellOffIcon,
  CloseIcon,
  GroupIcon,
  LeaveIcon,
  PlusIcon,
  ProfileIcon,
  SearchIcon
} from './icons'
import { ListSkeleton } from './Skeleton'
import { lastMessagePreview } from '../lib/chatPreview'
import EmptyScene from './EmptyScene'
import { useListGlide } from '../lib/listGlide'

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
  /** False until the first list arrives: placeholders show instead of "No conversations yet" */
  loaded?: boolean
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
  onMute: (conversation: ConversationSummary, duration: MuteDuration | null) => void
  /** Hides a chat from the sidebar (history kept) until a new message arrives */
  onCloseChat: (conversation: ConversationSummary) => void
  /** Saves a new order for the pinned chats (every pinned chat's id, top first) */
  onReorderPins: (ids: string[]) => void
  onNewMessage: () => void
  onNewGroup: () => void
  /** Opens message search across all chats with this text */
  onSearchMessages: (query: string) => void
  /** 0.7.5: "Find @name" when a search finds nobody (opens Add friend with it typed) */
  onFindUsername?: (username: string) => void
}

/** A pinned chat row's drag-to-reorder state and handlers. */
type PinDrag = {
  dragging: boolean
  drop: 'above' | 'below' | null
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
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
  onMenu,
  onCloseChat,
  drag
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
  /** Closes it in the sidebar (unpinned chats only); null hides the X */
  onCloseChat: (() => void) | null
  /** Pinned chats: dragging to change their order */
  drag?: PinDrag
}): React.JSX.Element {
  // Like the design: friends show their status; otherwise the last message (groups always).
  // A call going on shows instead: "In call · 4 of 6" (GroupCall.dc.html).
  const calls = useCalls()
  const social = useSocial()
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
  const muted = isMuted(c, now)
  return (
    <div
      className={[
        'dm-row-wrap',
        onCloseChat ? 'dm-row-wrap--closable' : '',
        drag?.dragging ? 'dm-row-wrap--dragging' : '',
        drag?.drop ? `dm-row-wrap--drop-${drag.drop}` : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-glide={c.id}
      draggable={drag ? true : undefined}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDrop={drag?.onDrop}
      onDragEnd={drag?.onDragEnd}
    >
      <button
        type="button"
        className={['dm-row', active ? 'dm-row--active' : '', muted ? 'dm-row--muted' : '']
          .filter(Boolean)
          .join(' ')}
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
            mobile={onMobile(presence ?? undefined)}
            ring={ring}
          />
        ) : (
          <GroupAvatar members={c.members} me={me} size={40} ring={ring} group={c} />
        )}
        <span className="dm-text">
          <span
            className={c.unreadCount > 0 || active ? 'dm-name dm-name--strong' : 'dm-name'}
            title={c.kind === 'group' ? `${title} · ${memberCountLabel(c.memberCount)}` : undefined}
          >
            <EmojiText text={title} />
            {c.kind === 'dm' && social.glows[c.partner.id] && (
              <GlowMark glow={social.glows[c.partner.id]} name={c.partner.displayName} />
            )}
            {c.kind === 'dm' && social.birthdays.includes(c.partner.id) && (
              <BirthdayMark name={c.partner.displayName} />
            )}
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
        {(muted || (c.unreadCount > 0 && !active)) && (
          <span className="dm-badges">
            {muted && (
              <span className="dm-muted" title={c.mutedUntil ? mutedLabel(c.mutedUntil) : 'Muted'}>
                <BellOffIcon size={15} />
              </span>
            )}
            {!active && (c.mentionCount ?? 0) > 0 && (
              <span
                className="badge badge--mention"
                aria-label={`${c.mentionCount} mention${c.mentionCount === 1 ? '' : 's'}`}
                title="You were mentioned"
              >
                @
              </span>
            )}
            {c.unreadCount > 0 && !active && (
              <span
                className={muted ? 'badge badge--muted' : 'badge'}
                aria-label={`${c.unreadCount} unread`}
              >
                {c.unreadCount > 99 ? '99+' : c.unreadCount}
              </span>
            )}
          </span>
        )}
      </button>
      {onCloseChat && (
        <button
          type="button"
          className="dm-close"
          aria-label={`Close ${title}`}
          title="Close chat"
          onClick={onCloseChat}
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
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
  onMute,
  onCloseChat,
  onMove,
  onClose
}: {
  conversation: ConversationSummary
  x: number
  y: number
  onCloseChat: () => void
  /** Pinned chats: move up (-1) or down (+1) among the pins; null where it can't move that way */
  onMove: { up: (() => void) | null; down: (() => void) | null } | null
  onTogglePin: () => void
  onViewProfile: () => void
  onGroupSettings: () => void
  onLeaveGroup: () => void
  onMute: (duration: MuteDuration | null) => void
  onClose: () => void
}): React.JSX.Element {
  const pinned = !!conversation.pinnedAt
  return (
    <ContextMenu x={x} y={y} label={`${chatTitle(conversation)} chat options`} onClose={onClose}>
      <MenuItem icon={<PinIcon size={18} />} onClose={onClose} onClick={onTogglePin}>
        {pinned ? 'Unpin chat' : 'Pin chat'}
      </MenuItem>
      {onMove && (onMove.up || onMove.down) && (
        <>
          <MenuItem
            icon={<ArrowUpIcon size={18} />}
            disabled={!onMove.up}
            onClose={onClose}
            onClick={() => onMove.up?.()}
          >
            Move up
          </MenuItem>
          <MenuItem
            icon={<ArrowDownIcon size={18} />}
            disabled={!onMove.down}
            onClose={onClose}
            onClick={() => onMove.down?.()}
          >
            Move down
          </MenuItem>
        </>
      )}
      <MuteMenuItems conversation={conversation} onMute={onMute} onClose={onClose} />
      {conversation.kind === 'dm' ? (
        <MenuItem icon={<ProfileIcon size={18} />} onClose={onClose} onClick={onViewProfile}>
          View profile
        </MenuItem>
      ) : (
        <>
          <MenuItem icon={<GroupIcon size={18} />} onClose={onClose} onClick={onGroupSettings}>
            Group settings
          </MenuItem>
          <div className="menu-divider" role="separator" />
          <MenuItem icon={<LeaveIcon size={18} />} danger onClose={onClose} onClick={onLeaveGroup}>
            Leave group
          </MenuItem>
        </>
      )}
      {!pinned && (
        <>
          <div className="menu-divider" role="separator" />
          <MenuItem icon={<CloseIcon size={18} />} onClose={onClose} onClick={onCloseChat}>
            Close chat
          </MenuItem>
        </>
      )}
    </ContextMenu>
  )
}

export default function ChatList({
  me,
  conversations,
  loaded = true,
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
  onMute,
  onCloseChat,
  onReorderPins,
  onNewMessage,
  onNewGroup,
  onSearchMessages,
  onFindUsername
}: ChatListProps): React.JSX.Element {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  // Dragging a pinned chat: which one, and where it would land (the line above or below a row).
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; where: 'above' | 'below' } | null>(null)
  const typing = useTypingByChat(me.id)
  const menuFor = conversations.find((c) => c.id === menu?.id) ?? null

  // Pinned chats in your order (drag to change it; saved as the order they were pinned in);
  // everything else by latest activity.
  const pinned = conversations
    .filter((c) => c.pinnedAt)
    .sort((a, b) => (a.pinnedAt ?? '').localeCompare(b.pinnedAt ?? ''))
  // Closed chats stay out of the list until something new arrives (or they're opened again).
  const others = conversations.filter((c) => !c.pinnedAt && (c.id === openChatId || !isClosed(c)))
  // 0.7.5: a chat bumped to the top glides there with a soft glow (not while searching).
  const chatsNav = useRef<HTMLElement | null>(null)
  useListGlide(
    chatsNav,
    query.trim() ? [] : others.map((c) => c.id),
    openChatId
  )

  /** Moves one pinned chat to a new place and saves the whole order. */
  function movePin(id: string, to: number): void {
    const ids = pinned.map((c) => c.id).filter((x) => x !== id)
    ids.splice(Math.max(0, Math.min(to, ids.length)), 0, id)
    if (ids.join() !== pinned.map((c) => c.id).join()) onReorderPins(ids)
  }

  function dropPin(targetId: string, where: 'above' | 'below'): void {
    if (!dragId || dragId === targetId) return
    const ids = pinned.map((c) => c.id).filter((x) => x !== dragId)
    const at = ids.indexOf(targetId)
    if (at < 0) return
    movePin(dragId, where === 'above' ? at : at + 1)
  }

  const pinDrag = (c: ConversationSummary): PinDrag | undefined =>
    pinned.length < 2
      ? undefined
      : {
          dragging: dragId === c.id,
          drop: drop?.id === c.id && dragId !== c.id ? drop.where : null,
          onDragStart: (e) => {
            setDragId(c.id)
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', c.id)
          },
          onDragOver: (e) => {
            if (!dragId) return // something else being dragged (a file, another list)
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            const rect = e.currentTarget.getBoundingClientRect()
            const where = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
            if (drop?.id !== c.id || drop.where !== where) setDrop({ id: c.id, where })
          },
          onDrop: (e) => {
            e.preventDefault()
            if (drop) dropPin(drop.id, drop.where)
            setDragId(null)
            setDrop(null)
          },
          onDragEnd: () => {
            setDragId(null)
            setDrop(null)
          }
        }

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
      onCloseChat={c.pinnedAt ? null : () => onCloseChat(c)}
      drag={c.pinnedAt ? pinDrag(c) : undefined}
    />
  )

  if (query.trim()) {
    return (
      <>
        <div className="section-head">
          <span>Results</span>
        </div>
        {results.length === 0 ? (
          <EmptyScene
            kind="search"
            layout="small"
            title={`No one called “${query.trim()}” here`}
            text="Check the spelling, or look them up by their username to send a friend request."
          >
            {onFindUsername && /^@?[a-z0-9._-]{2,}$/i.test(query.trim()) && (
              <button
                type="button"
                className="primary-button"
                onClick={() => onFindUsername(query.trim().replace(/^@/, ''))}
              >
                Find @{query.trim().replace(/^@/, '')}
              </button>
            )}
          </EmptyScene>
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
                      group={g}
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
                    mobile={onMobile(p ?? undefined)}
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
            aria-label="Create group"
            title="Create group"
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

      {!loaded ? (
        <ListSkeleton rows={6} label="Loading chats" />
      ) : conversations.length === 0 ? (
        <EmptyScene
          kind="hello"
          layout="small"
          title="No chats yet"
          text="Messages and group chats with friends will show up here."
        />
      ) : others.length === 0 ? (
        <p className="search-empty">
          {pinned.length
            ? 'All your other chats are pinned or closed.'
            : 'All your chats are closed. Search or a new message brings them back.'}
        </p>
      ) : (
        <nav aria-label="Chats" className="dm-list" ref={chatsNav}>
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
          onMute={(duration) => onMute(menuFor, duration)}
          onCloseChat={() => onCloseChat(menuFor)}
          onMove={
            menuFor.pinnedAt && pinned.length > 1
              ? (() => {
                  const i = pinned.findIndex((c) => c.id === menuFor.id)
                  return {
                    up: i > 0 ? () => movePin(menuFor.id, i - 1) : null,
                    down: i >= 0 && i < pinned.length - 1 ? () => movePin(menuFor.id, i + 1) : null
                  }
                })()
              : null
          }
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

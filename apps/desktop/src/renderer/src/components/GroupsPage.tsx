import { useState } from 'react'
import type {
  ConversationSummary,
  GroupSummary,
  Presence,
  PublicUser
} from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import { joinedCount, useCalls } from '../calls/callState'
import { chatTitle, groupMatches, listNames, memberCountLabel, sortGroups } from '../lib/groups'
import ContextMenu, { MenuItem } from './ContextMenu'
import EmojiText from './EmojiText'
import GroupAvatar from './GroupAvatar'
import { PinIcon } from './ChatList'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChatIcon,
  GripIcon,
  GroupIcon,
  LeaveIcon,
  MoreIcon,
  SearchIcon
} from './icons'

// The Groups page (sidebar → Groups, right under Friends): every group you're in, in your own
// order. Drag a group (or use Move up / Move down) to change its place; right-click for Pin to
// sidebar, Group settings and Leave. The order is saved on your account.

type GroupsPageProps = {
  me: PublicUser
  conversations: ConversationSummary[]
  presence: Record<string, Presence>
  /** Something to show above the list (a problem saving, say) */
  notice: string | null
  onOpen: (conversationId: string) => void
  onNewGroup: () => void
  onTogglePin: (group: GroupSummary) => void
  onGroupSettings: (group: GroupSummary) => void
  onLeave: (group: GroupSummary) => void
  /** Saves a new order (every group's id, top first). */
  onReorder: (ids: string[]) => void
  /** Extra items for a group's menu (mute, from the chat options) */
  extraMenu?: (group: GroupSummary, close: () => void) => React.ReactNode
}

type Drop = { id: string; where: 'above' | 'below' }

function GroupRow({
  group,
  me,
  online,
  dragging,
  drop,
  canDrag,
  onOpen,
  onMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: {
  group: GroupSummary
  me: PublicUser
  online: number
  dragging: boolean
  drop: 'above' | 'below' | null
  canDrag: boolean
  onOpen: () => void
  onMenu: (x: number, y: number) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}): React.JSX.Element {
  const calls = useCalls()
  const call = calls.callIn(group.id)
  const callLabel = call
    ? call.status === 'ringing' && joinedCount(call) <= 1
      ? 'Calling…'
      : `In call · ${joinedCount(call)} of ${call.members.length}`
    : null
  const title = chatTitle(group)
  const names = listNames(
    group.members.map((m) => m.displayName.trim().split(/\s+/)[0] || m.username),
    3
  )
  const className = [
    'friend-row',
    'friend-row--clickable',
    'group-row',
    dragging ? 'group-row--dragging' : '',
    drop ? `group-row--drop-${drop}` : ''
  ]
    .filter(Boolean)
    .join(' ')

  const openMenuAt = (e: React.MouseEvent): void => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    onMenu(e.clientX || rect.left + 60, e.clientY || rect.bottom)
  }

  return (
    <div
      className={className}
      role="listitem"
      draggable={canDrag}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={openMenuAt}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return
        onOpen()
      }}
    >
      {canDrag && (
        <span className="group-grip" title="Drag to move" aria-hidden="true">
          <GripIcon />
        </span>
      )}
      <GroupAvatar members={group.members} me={me} size={44} ring="var(--glo-bg)" group={group} />
      <div className="friend-text">
        <div className="friend-names">
          <span className="friend-name">
            <EmojiText text={title} />
          </span>
          {group.pinnedAt && (
            <span className="dm-pin" title="Pinned to the sidebar">
              <PinIcon />
            </span>
          )}
        </div>
        <span className={callLabel ? 'friend-sub group-sub--call' : 'friend-sub'}>
          {callLabel ??
            `${memberCountLabel(group.memberCount)} · ${online} online${group.name ? ` · ${names}` : ''}`}
        </span>
      </div>
      {group.unreadCount > 0 && (
        <span className="badge" aria-label={`${group.unreadCount} unread`}>
          {group.unreadCount > 99 ? '99+' : group.unreadCount}
        </span>
      )}
      <button
        type="button"
        className="round-button"
        aria-label={`Open ${title}`}
        title="Open chat"
        onClick={onOpen}
      >
        <ChatIcon />
      </button>
      <button
        type="button"
        className="round-button"
        aria-label={`More options for ${title}`}
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          onMenu(rect.right - 200, rect.bottom + 6)
        }}
      >
        <MoreIcon />
      </button>
    </div>
  )
}

export default function GroupsPage({
  me,
  conversations,
  presence,
  notice,
  onOpen,
  onNewGroup,
  onTogglePin,
  onGroupSettings,
  onLeave,
  onReorder,
  extraMenu
}: GroupsPageProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)

  const groups = sortGroups(conversations.filter((c): c is GroupSummary => c.kind === 'group'))
  const searching = search.trim().length > 0
  const shown = searching ? groups.filter((g) => groupMatches(g, search)) : groups
  const menuFor = groups.find((g) => g.id === menu?.id) ?? null
  const closeMenu = (): void => setMenu(null)

  const onlineIn = (g: GroupSummary): number =>
    g.members.filter((m) => (presence[m.id]?.status ?? 'offline') !== 'offline').length

  /** Moves one group to a new index and saves the whole order. */
  function move(id: string, to: number): void {
    const ids = groups.map((g) => g.id)
    const from = ids.indexOf(id)
    if (from < 0) return
    const target = Math.max(0, Math.min(ids.length - 1, to))
    if (target === from) return
    ids.splice(from, 1)
    ids.splice(target, 0, id)
    onReorder(ids)
  }

  function dropOn(targetId: string, where: 'above' | 'below'): void {
    if (!dragId || dragId === targetId) return
    const ids = groups.map((g) => g.id).filter((id) => id !== dragId)
    const at = ids.indexOf(targetId) + (where === 'below' ? 1 : 0)
    ids.splice(at, 0, dragId)
    onReorder(ids)
  }

  return (
    <>
      <header className="content-header">
        <div className="content-title">
          <GroupIcon size={22} />
          Groups
        </div>
        <span className="groups-count">
          {groups.length === 1 ? '1 group' : `${groups.length} groups`}
        </span>
        <button type="button" className="primary-button add-friend" onClick={onNewGroup}>
          <GroupIcon size={18} />
          New group
        </button>
      </header>

      <div className="content-body">
        {notice && (
          <div className="page-notice" role="alert">
            {notice}
          </div>
        )}
        {groups.length > 0 && (
          <div className="search search--wide">
            <SearchIcon />
            <input
              type="search"
              className="search-input"
              aria-label="Search groups"
              placeholder="Search groups"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {groups.length === 0 ? (
          <div className="empty-state">
            <img src={fireflyImg} alt="" className="empty-firefly" draggable={false} />
            <h2>No groups yet</h2>
            <p>Start a group with two or more friends and it&apos;ll show up here.</p>
            <button type="button" className="primary-button" onClick={onNewGroup}>
              <GroupIcon size={18} />
              New group
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="list-empty">No groups match “{search.trim()}”.</p>
        ) : (
          <section className="friend-group">
            <h2>
              {searching ? 'Results' : 'Your groups'} — {shown.length}
              {!searching && groups.length > 1 && (
                <span className="groups-hint"> · drag to change the order</span>
              )}
            </h2>
            <div role="list" aria-label="Groups">
              {shown.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  me={me}
                  online={onlineIn(g)}
                  canDrag={!searching && groups.length > 1}
                  dragging={dragId === g.id}
                  drop={drop?.id === g.id ? drop.where : null}
                  onOpen={() => onOpen(g.id)}
                  onMenu={(x, y) => setMenu({ id: g.id, x, y })}
                  onDragStart={(e) => {
                    setDragId(g.id)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', g.id)
                  }}
                  onDragOver={(e) => {
                    if (!dragId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    const rect = e.currentTarget.getBoundingClientRect()
                    const where = e.clientY < rect.top + rect.height / 2 ? 'above' : 'below'
                    if (drop?.id !== g.id || drop.where !== where) setDrop({ id: g.id, where })
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (drop) dropOn(drop.id, drop.where)
                    setDragId(null)
                    setDrop(null)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDrop(null)
                  }}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {menu && menuFor && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`${chatTitle(menuFor)} options`}
          onClose={closeMenu}
        >
          <MenuItem
            icon={<PinIcon size={18} />}
            onClose={closeMenu}
            onClick={() => onTogglePin(menuFor)}
          >
            {menuFor.pinnedAt ? 'Unpin from sidebar' : 'Pin to sidebar'}
          </MenuItem>
          {extraMenu?.(menuFor, closeMenu)}
          <div className="menu-divider" role="separator" />
          <MenuItem
            icon={<ArrowUpIcon size={18} />}
            disabled={groups[0]?.id === menuFor.id}
            onClose={closeMenu}
            onClick={() => move(menuFor.id, groups.indexOf(menuFor) - 1)}
          >
            Move up
          </MenuItem>
          <MenuItem
            icon={<ArrowDownIcon size={18} />}
            disabled={groups[groups.length - 1]?.id === menuFor.id}
            onClose={closeMenu}
            onClick={() => move(menuFor.id, groups.indexOf(menuFor) + 1)}
          >
            Move down
          </MenuItem>
          <div className="menu-divider" role="separator" />
          <MenuItem
            icon={<GroupIcon size={18} />}
            onClose={closeMenu}
            onClick={() => onGroupSettings(menuFor)}
          >
            Group settings
          </MenuItem>
          <MenuItem
            icon={<LeaveIcon size={18} />}
            danger
            onClose={closeMenu}
            onClick={() => onLeave(menuFor)}
          >
            Leave group
          </MenuItem>
        </ContextMenu>
      )}
    </>
  )
}

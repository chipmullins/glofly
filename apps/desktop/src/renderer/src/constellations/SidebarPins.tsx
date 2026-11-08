import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConstellationCard } from '@glofly/shared/constellations'
import ContextMenu from '../components/ContextMenu'
import EmojiText from '../components/EmojiText'
import { api } from '../lib/constellations'
import { ConstellationIcon } from './bits'
import './SidebarPins.css'

/**
 * 0.9.3: constellations pinned to the sidebar (approved canvas "Glofly pinned constellations",
 * up to 5), tucked under the Constellations button. Each shows unread / mentions and who's in
 * voice; a click goes straight into it. Right-click: Unpin, Move up / down, Mark as read, Mute.
 * Drag to reorder.
 */
export default function SidebarPins({
  cards,
  onOpen,
  onProblem
}: {
  cards: ConstellationCard[]
  onOpen: (card: ConstellationCard, from: HTMLElement) => void
  onProblem: (message: string) => void
}): React.JSX.Element | null {
  const pinned = useMemo(
    () =>
      cards
        .filter((c) => c.sidebarPin !== null && c.sidebarPin !== undefined)
        .sort((a, b) => (a.sidebarPin ?? 0) - (b.sidebarPin ?? 0)),
    [cards]
  )
  // While dragging, the order shown (and saved on drop).
  const [order, setOrder] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ card: ConstellationCard; x: number; y: number } | null>(null)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => setOrder(null), [cards])

  if (!pinned.length) return null
  const shown = order
    ? order.map((id) => pinned.find((c) => c.id === id)).filter((c): c is ConstellationCard => !!c)
    : pinned

  const save = async (ids: string[]): Promise<void> => {
    const r = await api.orderSidebarPins(ids)
    if (!r.ok) {
      setOrder(null)
      onProblem(r.message)
    }
  }
  const move = (card: ConstellationCard, step: -1 | 1): void => {
    const ids = shown.map((c) => c.id)
    const i = ids.indexOf(card.id)
    const j = i + step
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setOrder(ids)
    void save(ids)
  }

  return (
    <div className="sidebar-pins" role="list" aria-label="Pinned constellations">
      {shown.map((card) => {
        const voice = card.voice && card.voice.total > 0 ? card.voice : null
        const label = [
          card.name,
          card.muted ? 'muted' : null,
          !card.muted && card.mentionCount ? `${card.mentionCount} mentions` : null,
          !card.muted && !card.mentionCount && card.unreadCount ? 'unread' : null,
          voice ? `${voice.total} in ${voice.nebulaName}` : null
        ]
          .filter(Boolean)
          .join(', ')
        return (
          <div role="listitem" key={card.id}>
            <button
              ref={(el) => {
                if (el) refs.current.set(card.id, el)
                else refs.current.delete(card.id)
              }}
              type="button"
              className={[
                'sidebar-pin',
                card.muted && 'sidebar-pin--muted',
                dragId === card.id && 'sidebar-pin--dragging'
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={label}
              draggable
              onClick={(e) => onOpen(card, e.currentTarget)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ card, x: e.clientX, y: e.clientY })
              }}
              onKeyDown={(e) => {
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault()
                  const r = e.currentTarget.getBoundingClientRect()
                  setMenu({ card, x: r.left + 24, y: r.bottom })
                }
              }}
              onDragStart={(e) => {
                setDragId(card.id)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', card.id)
              }}
              onDragOver={(e) => {
                if (!dragId || dragId === card.id) return
                e.preventDefault()
                const ids = shown.map((c) => c.id).filter((id) => id !== dragId)
                ids.splice(ids.indexOf(card.id) + (shown.findIndex((c) => c.id === dragId) < shown.findIndex((c) => c.id === card.id) ? 1 : 0), 0, dragId)
                if (ids.join() !== shown.map((c) => c.id).join()) setOrder(ids)
              }}
              onDragEnd={() => {
                setDragId(null)
                if (order && order.join() !== pinned.map((c) => c.id).join()) void save(order)
              }}
            >
              <ConstellationIcon
                id={card.id}
                name={card.name}
                color={card.color}
                iconVersion={card.iconVersion}
                className="sidebar-pin-icon"
              />
              <span className="sidebar-pin-text">
                <span className="sidebar-pin-name">
                  <EmojiText text={card.name} />
                </span>
                <span className="sidebar-pin-sub">
                  {card.muted ? (
                    'Muted'
                  ) : voice ? (
                    <span className="sidebar-pin-voice">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
                      </svg>
                      {voice.total} in {voice.nebulaName}
                    </span>
                  ) : (
                    `${card.onlineCount} online`
                  )}
                </span>
              </span>
              {!card.muted && card.mentionCount > 0 ? (
                <span className="sidebar-pin-badge" aria-hidden="true">
                  {card.mentionCount > 99 ? '99+' : card.mentionCount}
                </span>
              ) : !card.muted && card.unreadCount > 0 ? (
                <span className="sidebar-pin-dot" aria-hidden="true" />
              ) : null}
            </button>
          </div>
        )
      })}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} label={`${menu.card.name} options`} onClose={() => setMenu(null)}>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              const card = menu.card
              setMenu(null)
              void api.sidebarPin(card.id, false).then((r) => !r.ok && onProblem(r.message))
            }}
          >
            Unpin from sidebar
          </button>
          {shown.findIndex((c) => c.id === menu.card.id) > 0 && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                const card = menu.card
                setMenu(null)
                move(card, -1)
              }}
            >
              Move up
            </button>
          )}
          {shown.findIndex((c) => c.id === menu.card.id) < shown.length - 1 && (
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={() => {
                const card = menu.card
                setMenu(null)
                move(card, 1)
              }}
            >
              Move down
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              const card = menu.card
              setMenu(null)
              void api.readAll(card.id).then((r) => !r.ok && onProblem(r.message))
            }}
          >
            Mark as read
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              const card = menu.card
              setMenu(null)
              void api
                .notifySettings(card.id, { mute: card.muted ? null : '1h' })
                .then((r) => !r.ok && onProblem(r.message))
            }}
          >
            {menu.card.muted ? 'Unmute' : 'Mute for 1 hour'}
          </button>
        </ContextMenu>
      )}
    </div>
  )
}

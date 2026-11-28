import { VoiceBubble } from '../components/Attachments'
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { attachmentSummary } from '@glofly/shared/attachments'
import { shortBody } from '@glofly/shared/gifs'
import {
  CONSTELLATION_THEME,
  ROLE_COLORS,
  type NebulaMention,
  type PinnedNebula
} from '@glofly/shared/constellations'
import type {
  ConstellationCard,
  ConstellationDetail,
  Message,
  Nebula,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import EmojiPicker from '../components/EmojiPicker'
import EmojiText from '../components/EmojiText'
import { colorsFor } from '../lib/avatarColors'
import { useCalls } from '../calls/callState'
import { api, can, topRole } from '../lib/constellations'
import { CloseIcon, ConstellationIcon, LinkOutIcon, MicIconLine, SpeakerIcon } from './bits'
import { hexA } from './colors'
import { GalaxyIcon } from './sky'
import type { CxPlace } from './phase'
import { preloadLastPlace } from './preload'
import './Dock.css'
import './HomeDock.css'
// 0.8.0: the Inbox replaces Mentions in the dock
import { useInboxCounts } from '../lib/community'
import { InboxIcon, InboxPanel } from './Inbox'

// The nebula dock on Glofly home (2.0; approved Oct 17, canvas boards 9–14): your constellations,
// nebulas you pinned, your @mentions and the voice nebula you're in, without leaving Glofly.
// It reuses the DM Dock's look and motion (Dock.css): hidden until the mouse touches the very
// bottom edge, the magnify, the tooltips, panels and mini chats popped up above their item.

const MAX_OPEN = 3
const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username
const quiet = (n: Nebula): boolean =>
  n.notify === 'none' || (!!n.mutedUntil && new Date(n.mutedUntil).getTime() > Date.now())

/** Text with @you picked out (purple in the dark panels, orange in the white mini chat). */
function WithMentions({
  text,
  me,
  className
}: {
  text: string
  me: SignedInUser
  className: string
}): React.JSX.Element {
  const parts = text.split(/(@[A-Za-z0-9_.]+)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('@') && part.slice(1).toLowerCase() === me.username.toLowerCase() ? (
          <span key={i} className={className}>
            {part}
          </span>
        ) : (
          <EmojiText key={i} text={part} />
        )
      )}
    </>
  )
}

/** A person's small round face (their photo, or initials in their colors). */
function Face({ person, size }: { person: PublicUser; size: number }): React.JSX.Element {
  const [bg, fg] = colorsFor(person.id)
  return (
    <span
      className="hd-face"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.38)
      }}
    >
      <AvatarFace id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
    </span>
  )
}

/** The little constellation tag in a nebula's corner (its icon, tiny). */
function CxTag({
  id,
  name,
  color,
  iconVersion,
  className = 'hd-tag'
}: {
  id: string
  name: string
  color: PinnedNebula['color']
  iconVersion: string | null
  className?: string
}): React.JSX.Element {
  return (
    <ConstellationIcon
      id={id}
      name={name}
      color={color}
      iconVersion={iconVersion}
      className={className}
    />
  )
}

function StarGlyph({
  size = 16,
  color = 'currentColor'
}: {
  size?: number
  color?: string
}): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
    </svg>
  )
}
function PinGlyph({ size = 15 }: { size?: number }): React.JSX.Element {
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
      <path d="M9 4h6l-1 6 4 3v2H6v-2l4-3z" />
      <path d="M12 15v6" />
    </svg>
  )
}
function ChevronGlyph(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export type HomeDockHandle = {
  /** Opens a nebula's mini chat (a notification was clicked, say) */
  openNebula: (constellationId: string, nebulaId: string, messageId?: string) => void
}

type Opened = { constellationId: string; nebulaId: string; highlight?: string }
type Panel =
  { kind: 'list'; constellationId: string } | { kind: 'mentions' } | { kind: 'voice' } | null

export default function HomeDock({
  me,
  cards,
  pins,
  onPins,
  onEnter,
  onCardsChanged,
  onProblem,
  handleRef
}: {
  me: SignedInUser
  cards: ConstellationCard[]
  pins: PinnedNebula[]
  onPins: (pins: PinnedNebula[]) => void
  /** Into Constellations (the starry swipe), optionally right at a nebula */
  onEnter: (place: CxPlace) => void
  /** Something was read: the cards' counts should refresh */
  onCardsChanged: () => void
  onProblem: (message: string) => void
  handleRef: React.Ref<HomeDockHandle>
}): React.JSX.Element {
  const calls = useCalls()
  void calls.tick
  // 0.7.5 instant fly-in: the constellation the Constellations button goes to, loaded ahead
  const cardIds = cards.map((c) => c.id).join(',')
  useEffect(() => preloadLastPlace(me.id, cardIds.split(',')), [me.id, cardIds])
  const [shown, setShown] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [open, setOpen] = useState<Opened[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, ConstellationDetail>>({})
  const [mentions, setMentions] = useState<{
    list: NebulaMention[]
    unread: number
    more: boolean
  }>({ list: [], unread: 0, more: false })
  // 0.8.0: the Inbox (mentions, replies, events, join requests) in place of Mentions
  const inbox = useInboxCounts(true)
  const inboxCount = inbox.counts?.all ?? 0
  const itemRefs = useRef(new Map<string, HTMLElement>())
  const [anchors, setAnchors] = useState<Record<string, number>>({})
  const anchorsKey = useRef('{}')
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

  // ---- Data ----
  const loadDetail = useCallback((id: string) => {
    void api.get(id).then((r) => {
      if (r.ok) setDetails((map) => ({ ...map, [id]: r.data.constellation }))
      else if (r.error === 'not_found' || r.error === 'forbidden')
        setDetails((map) => {
          const next = { ...map }
          delete next[id]
          return next
        })
    })
  }, [])
  const loadMentions = useCallback(() => {
    void api.mentions().then((r) => {
      if (r.ok) setMentions({ list: r.data.mentions, unread: r.data.unread, more: r.data.more })
    })
  }, [])
  const detailsRef = useRef(details)
  useEffect(() => {
    detailsRef.current = details
  }, [details])

  // Live: reload what's loaded, a moment later when it's busy.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const later = useCallback((key: string, run: () => void) => {
    if (timers.current.has(key)) return
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key)
        run()
      }, 500)
    )
  }, [])
  useEffect(() => {
    loadMentions()
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'constellation:activity') {
        if (detailsRef.current[event.constellationId])
          later(`d:${event.constellationId}`, () => loadDetail(event.constellationId))
        if (event.mentions.includes(me.id)) later('mentions', loadMentions)
      } else if (event.type === 'constellation:updated') {
        if (detailsRef.current[event.constellationId]) loadDetail(event.constellationId)
        later('mentions', loadMentions)
      } else if (event.type === 'constellation:voice') {
        setDetails((map) => {
          const d = map[event.constellationId]
          if (!d) return map
          const others = d.voice.filter((v) => v.nebulaId !== event.voice.nebulaId)
          return {
            ...map,
            [d.id]: { ...d, voice: event.voice.userIds.length || event.voice.discord ? [...others, event.voice] : others }
          }
        })
      } else if (event.type === 'constellation:removed') {
        setOpen((list) => list.filter((o) => o.constellationId !== event.constellationId))
        setPanel((p) =>
          p?.kind === 'list' && p.constellationId === event.constellationId ? null : p
        )
        later('mentions', loadMentions)
      } else if (event.type === 'constellations:changed') {
        later('mentions', loadMentions)
      } else if (event.type === 'connection' && event.connected) {
        loadMentions()
        for (const id of Object.keys(detailsRef.current)) loadDetail(id)
      }
    })
    const pending = timers.current
    return () => {
      stop()
      for (const t of pending.values()) clearTimeout(t)
      pending.clear()
    }
  }, [loadDetail, loadMentions, later, me.id])

  // The voice nebula you're in (from home): its constellation's details give the names.
  const voiceNebula = calls.current?.chat.kind === 'nebula' ? calls.current.chat.nebula : undefined
  const voiceCx = voiceNebula?.constellationId
  useEffect(() => {
    if (voiceCx && !detailsRef.current[voiceCx]) loadDetail(voiceCx)
  }, [voiceCx, loadDetail])

  const ensureDetail = (id: string): void => {
    if (!details[id]) loadDetail(id)
  }

  // ---- What's open ----
  function openNebula(constellationId: string, nebulaId: string, highlight?: string): void {
    ensureDetail(constellationId)
    setOpen((list) => {
      const rest = list.filter((o) => o.nebulaId !== nebulaId)
      return [...rest, { constellationId, nebulaId, highlight }].slice(-MAX_OPEN)
    })
    setExpanded(nebulaId)
    setPanel(null)
    setShown(true)
  }
  function closeNebula(nebulaId: string): void {
    setOpen((list) => list.filter((o) => o.nebulaId !== nebulaId))
    setExpanded((e) => (e === nebulaId ? null : e))
  }
  useImperativeHandle(handleRef, () => ({ openNebula }))

  const expandedOpen = open.find((o) => o.nebulaId === expanded) ?? null
  const up = shown || !!panel || !!expandedOpen
  const pinnedIds = useMemo(() => new Set(pins.map((p) => p.nebula.id)), [pins])

  async function togglePin(
    constellationId: string,
    nebula: { id: string; name: string }
  ): Promise<void> {
    const on = pinnedIds.has(nebula.id)
    const r = on
      ? await api.unpin(constellationId, nebula.id)
      : await api.pin(constellationId, nebula.id)
    if (!r.ok) onProblem(r.message)
    else onPins(r.data.pins)
  }

  // Which dock item a panel or mini chat sits above.
  const panelKey =
    panel?.kind === 'list'
      ? `c:${panel.constellationId}`
      : panel?.kind === 'mentions'
        ? 'mentions'
        : panel?.kind === 'voice'
          ? 'voice'
          : null
  const chatKey = expandedOpen
    ? pinnedIds.has(expandedOpen.nebulaId)
      ? `p:${expandedOpen.nebulaId}`
      : `c:${expandedOpen.constellationId}`
    : null
  useLayoutEffect(() => {
    const next: Record<string, number> = {}
    for (const key of [panelKey, chatKey]) {
      if (!key) continue
      const r = itemRefs.current.get(key)?.getBoundingClientRect()
      if (r) next[key] = r.left + r.width / 2
    }
    if (JSON.stringify(next) !== anchorsKey.current) {
      anchorsKey.current = JSON.stringify(next)
      setAnchors(next)
    }
  }, [panelKey, chatKey, up, cards, pins])

  // Escape or a click elsewhere closes a panel.
  useEffect(() => {
    if (!panel) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setPanel(null)
        return
      }
      if ((e.target as HTMLElement).closest?.('.hd-panel, .hd-trigger')) return
      setPanel(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [panel])

  /** Where a panel of this width goes, and its tail, above the item. */
  const placeFor = (key: string | null, width: number): { left: number; tail: number } => {
    const x = key ? (anchors[key] ?? window.innerWidth / 2) : window.innerWidth / 2
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, Math.round(x - width / 2)))
    return { left, tail: Math.max(18, Math.min(width - 36, Math.round(x - left - 9))) }
  }

  const togglePanel = (next: NonNullable<Panel>): void => {
    setExpanded(null)
    setPanel((p) =>
      p &&
      p.kind === next.kind &&
      (p.kind !== 'list' || (next.kind === 'list' && p.constellationId === next.constellationId))
        ? null
        : next
    )
  }

  // ---- Dock items ----
  const tip = (key: string, content: React.ReactNode): React.ReactNode =>
    hover === key && panelKey !== key && chatKey !== key ? (
      <span role="tooltip" className="dock-tip">
        {content}
      </span>
    ) : null
  const hoverProps = (
    key: string
  ): Pick<
    React.HTMLAttributes<HTMLElement>,
    'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur'
  > => ({
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover((h) => (h === key ? null : h)),
    onFocus: () => setHover(key),
    onBlur: () => setHover((h) => (h === key ? null : h))
  })
  function setItemRef(key: string, el: HTMLElement | null): void {
    if (el) itemRefs.current.set(key, el)
    else itemRefs.current.delete(key)
  }
  const unreadCards = cards.filter((c) => c.unreadCount > 0 || c.mentionCount > 0).length

  const cardItem = (c: ConstellationCard): React.JSX.Element => {
    const key = `c:${c.id}`
    const current = panelKey === key || chatKey === key
    const running = open.some((o) => o.constellationId === c.id && !pinnedIds.has(o.nebulaId))
    return (
      <span key={key} className="dock-slot">
        <button
          type="button"
          ref={(el) => setItemRef(key, el)}
          className={
            current ? 'dock-item hd-cx hd-trigger dock-item--current' : 'dock-item hd-cx hd-trigger'
          }
          aria-label={`${c.name}${c.mentionCount ? ', mentioned you' : c.unreadCount ? `, ${c.unreadCount} unread` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={panelKey === key}
          tabIndex={up ? 0 : -1}
          {...hoverProps(key)}
          onClick={() => {
            ensureDetail(c.id)
            togglePanel({ kind: 'list', constellationId: c.id })
          }}
        >
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color}
            iconVersion={c.iconVersion}
            className="dock-face-inner hd-cx-face"
          />
          {c.mentionCount > 0 ? (
            <span className="dock-badge hd-badge--mention">@</span>
          ) : c.unreadCount > 0 ? (
            <span className="dock-badge">{c.unreadCount > 99 ? '99+' : c.unreadCount}</span>
          ) : null}
        </button>
        {running && <span className="dock-running" aria-hidden="true" />}
        {tip(key, <EmojiText text={c.name} />)}
      </span>
    )
  }

  const pinItem = (p: PinnedNebula): React.JSX.Element => {
    const key = `p:${p.nebula.id}`
    const current = chatKey === key
    const running = open.some((o) => o.nebulaId === p.nebula.id)
    const n = p.nebula
    return (
      <span key={key} className="dock-slot">
        <button
          type="button"
          ref={(el) => setItemRef(key, el)}
          className={
            current
              ? 'dock-item hd-neb hd-trigger dock-item--current'
              : 'dock-item hd-neb hd-trigger'
          }
          aria-label={`#${n.name} in ${p.constellationName}, pinned${n.mentionCount ? ', mentioned you' : n.unreadCount ? `, ${n.unreadCount} unread` : ''}`}
          tabIndex={up ? 0 : -1}
          {...hoverProps(key)}
          onClick={() => {
            if (n.kind === 'voice') {
              onEnter({ constellationId: p.constellationId, nebulaId: n.id })
              return
            }
            if (expanded === n.id) setExpanded(null)
            else openNebula(p.constellationId, n.id)
          }}
        >
          {n.kind === 'voice' ? (
            <SpeakerIcon size={22} color="#ffb347" />
          ) : (
            <StarGlyph size={22} color="#ffb347" />
          )}
          <CxTag
            id={p.constellationId}
            name={p.constellationName}
            color={p.color}
            iconVersion={p.iconVersion}
          />
          {n.mentionCount > 0 ? (
            <span className="dock-badge hd-badge--mention">@</span>
          ) : n.unreadCount > 0 ? (
            <span className="dock-badge">{n.unreadCount > 99 ? '99+' : n.unreadCount}</span>
          ) : null}
        </button>
        {running && <span className="dock-running" aria-hidden="true" />}
        {tip(
          key,
          <>
            #{n.name} <span className="dock-tip-status">· {p.constellationName} · pinned</span>
          </>
        )}
      </span>
    )
  }

  // ---- The voice nebula you're in ----
  const voiceDetail = voiceNebula ? details[voiceNebula.constellationId] : undefined
  const voiceNeb = voiceDetail?.nebulas.find((n) => n.id === voiceNebula?.nebulaId)
  const voiceState = voiceDetail?.voice.find((v) => v.nebulaId === voiceNebula?.nebulaId)
  const room = calls.room
  const speaking = new Set<string>()
  if (room) {
    for (const p of room.remoteParticipants.values()) if (p.isSpeaking) speaking.add(p.identity)
    if (room.localParticipant.isSpeaking) speaking.add(me.id)
  }
  const micOn = room ? room.localParticipant.isMicrophoneEnabled : false
  const voicePeople: PublicUser[] = voiceDetail
    ? (voiceState?.userIds ?? [me.id])
        .map(
          (id) =>
            voiceDetail.members.find((m) => m.user.id === id)?.user ??
            (id === me.id ? me : undefined)
        )
        .filter((p): p is PublicUser => !!p)
    : []

  // ---- Panels ----
  const listCx = panel?.kind === 'list' ? panel.constellationId : null
  const listCard = listCx ? cards.find((c) => c.id === listCx) : undefined
  const listDetail = listCx ? details[listCx] : undefined

  return (
    <div className="dock-root hd-root">
      {/* The very bottom edge raises the dock (the message box above stays clickable). */}
      {/* 0.7.4: it says what it is (it only exists for people in a constellation: MainScreen). */}
      <div
        className="dock-edge hd-edge"
        aria-hidden="true"
        title="Your constellations and pinned nebulas"
        onMouseEnter={() => {
          stayUp()
          setShown(true)
        }}
        onMouseLeave={hideSoon}
      >
        {!up && (
          <>
            <span className="dock-hint" />
            {(mentions.unread > 0 || inboxCount > 0 || unreadCards > 0) && (
              <span
                className={
                  mentions.unread > 0 || inboxCount > 0
                    ? 'dock-hint-count hd-badge--mention'
                    : 'dock-hint-count'
                }
              >
                {mentions.unread > 0 && !inboxCount
                  ? '@'
                  : inboxCount > 0
                    ? inboxCount > 9
                      ? '9+'
                      : inboxCount
                    : unreadCards > 9
                      ? '9+'
                      : unreadCards}
              </span>
            )}
          </>
        )}
      </div>

      {panel?.kind === 'list' && listCx && (
        <NebulaList
          card={listCard}
          detail={listDetail}
          place={placeFor(panelKey, 360)}
          pinnedIds={pinnedIds}
          me={me}
          onPick={(n) => {
            if (n.kind === 'voice') {
              setPanel(null)
              onEnter({ constellationId: listCx, nebulaId: n.id })
            } else openNebula(listCx, n.id)
          }}
          onTogglePin={(n) => void togglePin(listCx, n)}
          onOpenFull={() => {
            setPanel(null)
            onEnter({ constellationId: listCx, nebulaId: null })
          }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel?.kind === 'mentions' && (
        <InboxPanel
          className="hd-panel inbox--dock"
          style={{ left: placeFor(panelKey, 520).left }}
          onCounts={() => inbox.reload()}
          onOpenMessage={(i) => {
            if (i.nebula && i.messageId) openNebula(i.constellation.id, i.nebula.id, i.messageId)
          }}
          onOpenEvent={(i) => {
            setPanel(null)
            if (i.nebula) {
              if (i.messageId) openNebula(i.constellation.id, i.nebula.id, i.messageId)
              else onEnter({ constellationId: i.constellation.id, nebulaId: i.nebula.id })
            }
          }}
          onClose={() => {
            setPanel(null)
            inbox.reload()
            onCardsChanged()
          }}
        />
      )}

      {panel?.kind === 'voice' && voiceNebula && (
        <section
          className="all-chats hd-panel hd-voice-card"
          role="dialog"
          aria-label={`${voiceNeb?.name ?? 'Voice'} voice`}
          style={{ left: placeFor(panelKey, 340).left }}
        >
          <header className="hd-vc-head">
            <span className="hd-vc-icon">
              <SpeakerIcon size={20} color="#6fd39a" />
            </span>
            <span className="hd-vc-title">
              <strong>{voiceNeb?.name ?? 'Voice'}</strong>
              <span>Voice connected · {voiceDetail?.name ?? ''}</span>
            </span>
            <button
              type="button"
              className="all-chats-icon"
              aria-label="Close"
              onClick={() => setPanel(null)}
            >
              <CloseIcon />
            </button>
          </header>
          <ul className="hd-vc-people">
            {voicePeople.map((p) => {
              const live = voiceState?.sharing.includes(p.id)
              const mutedByMod = voiceState?.muted.includes(p.id)
              const mine = p.id === me.id
              const micOff = mine
                ? !micOn
                : room
                  ? !(room.remoteParticipants.get(p.id)?.isMicrophoneEnabled ?? true)
                  : false
              return (
                <li key={p.id} className="hd-vc-person">
                  <span className={speaking.has(p.id) ? 'hd-vc-face hd-talking' : 'hd-vc-face'}>
                    <Face person={p} size={36} />
                  </span>
                  <span className="hd-vc-text">
                    <strong>
                      {mine ? `${firstName(p)} (you)` : firstName(p)}
                      {live && <span className="cx-live">LIVE</span>}
                      {(micOff || mutedByMod) && !live && (
                        <span className="hd-vc-muted" aria-label="Muted">
                          <MicIconLine size={14} muted />
                        </span>
                      )}
                    </strong>
                    <span>
                      {live
                        ? 'Sharing their screen'
                        : mutedByMod
                          ? 'Muted by a moderator'
                          : micOff
                            ? 'Muted'
                            : mine
                              ? 'Talking from Glofly'
                              : speaking.has(p.id)
                                ? 'Talking'
                                : 'Listening'}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
          {voiceState && voiceState.sharing.length > 0 && (
            <div className="hd-vc-watch-row">
              <button
                type="button"
                className="hd-vc-watch"
                onClick={() => {
                  setPanel(null)
                  onEnter({
                    constellationId: voiceNebula.constellationId,
                    nebulaId: voiceNebula.nebulaId
                  })
                }}
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
                  <rect x="3" y="4" width="18" height="13" rx="2" />
                  <path d="M8 21h8M12 17v4" />
                </svg>
                Watch{' '}
                {(() => {
                  const who = voiceDetail?.members.find(
                    (m) => m.user.id === voiceState.sharing[0]
                  )?.user
                  return who ? `${firstName(who)}’s` : 'the'
                })()}{' '}
                screen
              </button>
            </div>
          )}
          <div className="hd-vc-controls">
            <button
              type="button"
              className={micOn ? 'hd-vc-btn' : 'hd-vc-btn hd-vc-btn--off'}
              aria-pressed={!micOn}
              onClick={() => calls.toggleMic()}
            >
              <MicIconLine size={18} muted={!micOn} />
              {micOn ? 'Mute' : 'Unmute'}
            </button>
            <button
              type="button"
              className="hd-vc-btn hd-vc-btn--leave"
              aria-label="Leave voice"
              onClick={() => {
                setPanel(null)
                calls.hangUp()
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 14c5-4.5 13-4.5 18 0l-2.5 2.5-3-1.5v-2.5a9 9 0 0 0-7 0V15l-3 1.5z" />
              </svg>
              Leave
            </button>
          </div>
          <footer className="all-chats-foot hd-vc-foot">
            <button
              type="button"
              className="all-chats-home"
              onClick={() => {
                setPanel(null)
                onEnter({
                  constellationId: voiceNebula.constellationId,
                  nebulaId: voiceNebula.nebulaId
                })
              }}
            >
              Open in Constellations
              <LinkOutIcon size={14} />
            </button>
          </footer>
          <span
            className="all-chats-tail"
            aria-hidden="true"
            style={{ left: placeFor(panelKey, 340).tail }}
          />
        </section>
      )}

      {expandedOpen && (
        <div
          className="mini-chat-wrap hd-mini-wrap"
          style={{
            left: chatKey ? (anchors[chatKey] ?? window.innerWidth / 2) : window.innerWidth / 2
          }}
        >
          <NebulaMini
            key={expandedOpen.nebulaId}
            opened={expandedOpen}
            detail={details[expandedOpen.constellationId]}
            me={me}
            pinned={pinnedIds.has(expandedOpen.nebulaId)}
            onTogglePin={(n) => void togglePin(expandedOpen.constellationId, n)}
            onOpenFull={() => {
              closeNebula(expandedOpen.nebulaId)
              onEnter({
                constellationId: expandedOpen.constellationId,
                nebulaId: expandedOpen.nebulaId
              })
            }}
            onMinimize={() => setExpanded(null)}
            onClose={() => closeNebula(expandedOpen.nebulaId)}
            onRead={() => {
              onCardsChanged()
              loadMentions()
            }}
          />
        </div>
      )}

      {/* Minimized nebula chats wait as pills. */}
      {up && open.filter((o) => o.nebulaId !== expanded).length > 0 && (
        <div className="mini-pills">
          {open
            .filter((o) => o.nebulaId !== expanded)
            .map((o) => {
              const d = details[o.constellationId]
              const n = d?.nebulas.find((x) => x.id === o.nebulaId)
              return (
                <button
                  key={o.nebulaId}
                  type="button"
                  className="mini-pill"
                  aria-label={`#${n?.name ?? 'nebula'}, minimized`}
                  onClick={() => setExpanded(o.nebulaId)}
                >
                  <span className="mini-pill-face hd-pill-face">
                    <StarGlyph size={16} color="#ffb347" />
                  </span>
                  <span className="mini-pill-name">#{n?.name ?? '…'}</span>
                  {n && n.unreadCount > 0 && (
                    <span className="dock-badge dock-badge--inline">{n.unreadCount}</span>
                  )}
                </button>
              )
            })}
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
        <nav aria-label="Your constellations" className="dock" aria-hidden={!up}>
          <span className="dock-slot">
            <button
              type="button"
              className="dock-item dock-home hd-galaxy"
              aria-label="Open Constellations"
              tabIndex={up ? 0 : -1}
              {...hoverProps('galaxy')}
              onClick={() => onEnter(null)}
            >
              <GalaxyIcon size={25} sparkles />
            </button>
            {tip('galaxy', 'Constellations')}
          </span>
          <span className="dock-line" aria-hidden="true" />
          {cards.map(cardItem)}
          {pins.length > 0 && <span className="dock-line" aria-hidden="true" />}
          {pins.map(pinItem)}
          <span className="dock-slot">
            <button
              type="button"
              ref={(el) => setItemRef('mentions', el)}
              className={
                panelKey === 'mentions'
                  ? 'dock-item hd-mentions hd-trigger dock-item--current'
                  : 'dock-item hd-mentions hd-trigger'
              }
              aria-label={`Inbox${inboxCount ? `, ${inboxCount} new` : ''}`}
              aria-haspopup="dialog"
              aria-expanded={panelKey === 'mentions'}
              tabIndex={up ? 0 : -1}
              {...hoverProps('mentions')}
              onClick={() => {
                if (panelKey !== 'mentions') loadMentions()
                togglePanel({ kind: 'mentions' })
              }}
            >
              <InboxIcon size={24} />
              {inboxCount > 0 && (
                <span className="dock-badge hd-badge--mention">
                  {inboxCount > 99 ? '99+' : inboxCount}
                </span>
              )}
            </button>
            {panelKey === 'mentions' && <span className="dock-running" aria-hidden="true" />}
            {tip('mentions', 'Inbox')}
          </span>
          {voiceNebula && (
            <span className="dock-slot">
              <button
                type="button"
                ref={(el) => setItemRef('voice', el)}
                className={[
                  'dock-item hd-voice hd-trigger',
                  panelKey === 'voice' && 'dock-item--current',
                  speaking.size > 0 && panelKey !== 'voice' && 'hd-talking'
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`In voice: ${voiceNeb?.name ?? 'a voice nebula'}, ${voicePeople.length} ${voicePeople.length === 1 ? 'person' : 'people'}`}
                aria-haspopup="dialog"
                aria-expanded={panelKey === 'voice'}
                tabIndex={up ? 0 : -1}
                {...hoverProps('voice')}
                onClick={() => {
                  ensureDetail(voiceNebula.constellationId)
                  togglePanel({ kind: 'voice' })
                }}
              >
                <SpeakerIcon size={22} color="#6fd39a" />
                {voicePeople.length > 0 && (
                  <span className="dock-badge hd-badge--voice">{voicePeople.length}</span>
                )}
              </button>
              <span className="dock-running" aria-hidden="true" />
              {tip(
                'voice',
                <>
                  {voiceNeb?.name ?? 'Voice'}{' '}
                  <span className="dock-tip-status">· {voiceDetail?.name ?? ''}</span>
                </>
              )}
            </span>
          )}
        </nav>
      </div>
    </div>
  )
}

/** A constellation's nebulas, popped up above its icon (board 10). */
function NebulaList({
  card,
  detail,
  place,
  pinnedIds,
  me,
  onPick,
  onTogglePin,
  onOpenFull,
  onClose
}: {
  card: ConstellationCard | undefined
  detail: ConstellationDetail | undefined
  place: { left: number; tail: number }
  pinnedIds: Set<string>
  me: SignedInUser
  onPick: (n: Nebula) => void
  onTogglePin: (n: Nebula) => void
  onOpenFull: () => void
  onClose: () => void
}): React.JSX.Element {
  const name = detail?.name ?? card?.name ?? ''
  const color = detail?.color ?? card?.color ?? 'ember'
  const theme = CONSTELLATION_THEME[color]
  const id = detail?.id ?? card?.id ?? ''
  const people = useMemo(
    () => new Map((detail?.members ?? []).map((m) => [m.user.id, m.user])),
    [detail?.members]
  )
  const groups = detail
    ? [
        ...detail.categories.map((cat) => ({
          id: cat.id,
          name: cat.name,
          nebulas: detail.nebulas.filter((n) => n.categoryId === cat.id)
        })),
        { id: 'none', name: '', nebulas: detail.nebulas.filter((n) => !n.categoryId) }
      ].filter((g) => g.nebulas.length > 0)
    : []
  const online = detail
    ? detail.members.filter((m) => m.status !== 'offline').length
    : (card?.onlineCount ?? 0)
  const members = detail ? detail.members.length : (card?.memberCount ?? 0)

  return (
    <section
      className="all-chats hd-panel hd-list"
      role="dialog"
      aria-label={`${name} nebulas`}
      style={{ left: place.left }}
    >
      <header
        className="hd-list-head"
        style={{
          background: `linear-gradient(180deg, ${hexA(theme.icon, 0.28)}, rgba(28,18,16,0))`
        }}
      >
        {id && (
          <ConstellationIcon
            id={id}
            name={name}
            color={color}
            iconVersion={detail?.iconVersion ?? card?.iconVersion ?? null}
            className="hd-list-icon"
          />
        )}
        <span className="hd-list-title">
          <strong>
            <EmojiText text={name} />
          </strong>
          <span>
            {members} {members === 1 ? 'member' : 'members'} ·{' '}
            <span className="hd-online">{online} online</span>
          </span>
        </span>
        <button type="button" className="all-chats-icon" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <ul className="hd-list-body">
        {!detail && <li className="all-chats-empty">Loading…</li>}
        {groups.map((g) => (
          <li key={g.id} className="hd-cat-group">
            {g.name && (
              <span className="hd-cat">
                <ChevronGlyph />
                {g.name}
              </span>
            )}
            <ul>
              {g.nebulas.map((n) => {
                const unread = n.unreadCount > 0
                const mention = n.mentionCount > 0
                const muted = quiet(n)
                const pinned = pinnedIds.has(n.id)
                const v =
                  n.kind === 'voice' ? detail?.voice.find((x) => x.nebulaId === n.id) : undefined
                const inIt = (v?.userIds ?? [])
                  .map((uid) => people.get(uid))
                  .filter((p): p is PublicUser => !!p)
                return (
                  <li key={n.id}>
                    <div
                      className={[
                        'hd-row',
                        (unread || mention) && !muted && 'hd-row--unread',
                        muted && 'hd-row--muted'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        type="button"
                        className="hd-row-main"
                        aria-label={`${n.kind === 'voice' ? 'Voice nebula' : '#'}${n.name}${mention ? ', mentioned you' : unread ? `, ${n.unreadCount} unread` : ''}${muted ? ', muted' : ''}${n.kind === 'voice' ? ' (opens Constellations)' : ''}`}
                        onClick={() => onPick(n)}
                      >
                        {n.kind === 'voice' ? <SpeakerIcon size={16} /> : <StarGlyph size={15} />}
                        <span className="hd-row-name">{n.name}</span>
                        {pinned && (
                          <span className="hd-row-pinned" aria-label="Pinned to your dock">
                            <PinGlyph size={13} />
                          </span>
                        )}
                        {mention ? (
                          <span className="hd-count hd-count--mention">@</span>
                        ) : unread ? (
                          <span className={muted ? 'hd-count hd-count--muted' : 'hd-count'}>
                            {n.unreadCount > 99 ? '99+' : n.unreadCount}
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className={pinned ? 'hd-row-pin hd-row-pin--on' : 'hd-row-pin'}
                        aria-label={
                          pinned ? `Unpin #${n.name} from your dock` : `Pin #${n.name} to your dock`
                        }
                        title={pinned ? 'Unpin from dock' : 'Pin to dock'}
                        onClick={() => onTogglePin(n)}
                      >
                        <PinGlyph size={13} />
                        <span>{pinned ? 'Pinned' : 'Pin to dock'}</span>
                      </button>
                    </div>
                    {inIt.length > 0 && (
                      <div className="hd-row-voice">
                        {inIt.map((p) => (
                          <span key={p.id} className="hd-row-voice-person">
                            <Face person={p} size={22} />
                            {p.id === me.id ? `${firstName(p)} (you)` : firstName(p)}
                            {v?.sharing.includes(p.id) && <span className="cx-live">LIVE</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
        {detail && groups.length === 0 && <li className="all-chats-empty">No nebulas yet</li>}
      </ul>
      <footer className="all-chats-foot">
        <span>Hover a nebula to pin it</span>
        <button type="button" className="all-chats-home" onClick={onOpenFull}>
          Open in Constellations
          <LinkOutIcon size={14} />
        </button>
      </footer>
      <span className="all-chats-tail" aria-hidden="true" style={{ left: place.tail }} />
    </section>
  )
}

/** A nebula's chat popped up above the dock (board 11). */
function NebulaMini({
  opened,
  detail,
  me,
  pinned,
  onTogglePin,
  onOpenFull,
  onMinimize,
  onClose,
  onRead
}: {
  opened: Opened
  detail: ConstellationDetail | undefined
  me: SignedInUser
  pinned: boolean
  onTogglePin: (n: Nebula) => void
  onOpenFull: () => void
  onMinimize: () => void
  onClose: () => void
  onRead: () => void
}): React.JSX.Element {
  const nebula = detail?.nebulas.find((n) => n.id === opened.nebulaId)
  const conversationId = nebula?.conversationId ?? null
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [openedAt] = useState(() => Date.now())
  const [people, setPeople] = useState<Record<string, PublicUser>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [emojiAnchor, setEmojiAnchor] = useState<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const onReadRef = useRef(onRead)
  useEffect(() => {
    onReadRef.current = onRead
  })

  useEffect(() => {
    if (!conversationId) return
    let stale = false
    void window.glofly.conversations.messages(conversationId).then((r) => {
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
      if (event.type === 'message:new' && event.message.conversationId === conversationId) {
        setMessages((list) =>
          list && !list.some((m) => m.id === event.message.id) ? [...list, event.message] : list
        )
        if (event.people)
          setPeople((map) => ({
            ...map,
            ...Object.fromEntries(event.people!.map((p) => [p.id, p]))
          }))
      }
      if (event.type === 'message:updated' && event.message.conversationId === conversationId) {
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
  }, [conversationId])

  // Open and showing: it's read.
  const lastId = messages?.at(-1)?.id
  useEffect(() => {
    if (!lastId || !conversationId) return
    void window.glofly.conversations.markRead(conversationId).then(() => onReadRef.current())
  }, [lastId, conversationId])

  // Scroll to the bottom, or to the @mention it was opened for (highlighted a moment).
  const [highlighted, setHighlighted] = useState<string | null>(opened.highlight ?? null)
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !messages) return
    const target = highlighted ? el.querySelector<HTMLElement>(`[data-id="${highlighted}"]`) : null
    if (target) target.scrollIntoView({ block: 'center' })
    else el.scrollTop = el.scrollHeight
  }, [messages, highlighted])
  useEffect(() => {
    if (!highlighted) return
    const t = setTimeout(() => setHighlighted(null), 2600)
    return () => clearTimeout(t)
  }, [highlighted])

  const members = useMemo(
    () => new Map((detail?.members ?? []).map((m) => [m.user.id, m.user])),
    [detail?.members]
  )
  const personOf = (id: string): PublicUser | undefined => members.get(id) ?? people[id]
  const roleOf = (
    id: string
  ): { name: string; light: string; badgeBg: string; badgeText: string } | null => {
    if (!detail || !members.has(id)) return null
    const role = topRole(detail, id)
    if (role.kind === 'member') return null
    const colors = ROLE_COLORS[role.color] ?? ROLE_COLORS.gray
    return {
      name: role.name,
      light: colors.light,
      badgeBg: colors.badgeBg,
      badgeText: colors.badgeText
    }
  }

  // Can I post here? (The server checks too.)
  const timedOut =
    detail?.me.timedOutUntil && new Date(detail.me.timedOutUntil).getTime() > openedAt
      ? detail.me.timedOutUntil
      : null
  const readOnlyForMe =
    !!nebula?.readOnly &&
    !!detail &&
    !can(detail, 'manageNebulas') &&
    !can(detail, 'deleteMessages')
  const cantPost = timedOut
    ? `You're timed out until ${new Date(timedOut).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : readOnlyForMe
      ? 'Only moderators post in this nebula'
      : null

  async function send(): Promise<void> {
    const body = draft.trim()
    if (!body || sending || cantPost || !conversationId) return
    setSending(true)
    setProblem(null)
    const r = await window.glofly.conversations.send(conversationId, body)
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

  async function vote(m: Message, index: number): Promise<void> {
    if (!conversationId || !m.poll) return
    const mine = m.poll.options
      .map((o, i) => (o.votes.includes(me.id) ? i : -1))
      .filter((i) => i >= 0)
    const next = mine.includes(index)
      ? mine.filter((i) => i !== index)
      : m.poll.multi
        ? [...mine, index]
        : [index]
    const r = await window.glofly.chat.vote(conversationId, m.id, next)
    if (!r.ok) setProblem(r.message)
    else setMessages((list) => list?.map((x) => (x.id === r.data.id ? r.data : x)) ?? list)
  }

  const title = nebula ? `#${nebula.name}` : '#…'
  const online = detail ? detail.members.filter((m) => m.status !== 'offline').length : 0
  const visible = (messages ?? []).filter((m) => !m.event)

  return (
    <section
      className="mini-chat hd-mini"
      aria-label={`${title}${detail ? ` in ${detail.name}` : ''}`}
    >
      <header className="mini-chat-head">
        <span className="hd-mini-icon">
          {nebula?.kind === 'voice' ? (
            <SpeakerIcon size={18} color="#ffb347" />
          ) : (
            <StarGlyph size={18} color="#ffb347" />
          )}
          {detail && (
            <CxTag
              id={detail.id}
              name={detail.name}
              color={detail.color}
              iconVersion={detail.iconVersion}
              className="hd-tag hd-tag--mini"
            />
          )}
        </span>
        <span className="mini-chat-title">
          <strong>
            <EmojiText text={title} />
          </strong>
          <span className="mini-chat-status">
            {detail ? (
              <>
                <EmojiText text={detail.name} /> · {online} online
              </>
            ) : (
              'Loading…'
            )}
          </span>
        </span>
        {nebula && (
          <button
            type="button"
            className={pinned ? 'mini-chat-button hd-pin-on' : 'mini-chat-button'}
            aria-label={pinned ? 'Unpin from dock' : 'Pin to dock'}
            aria-pressed={pinned}
            title={pinned ? 'Pinned to your dock (click to unpin)' : 'Pin to your dock'}
            onClick={() => onTogglePin(nebula)}
          >
            <PinGlyph size={17} />
          </button>
        )}
        <button
          type="button"
          className="mini-chat-button"
          aria-label="Open in Constellations"
          title="Open in Constellations"
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
      <div className="mini-chat-list hd-mini-list" ref={listRef}>
        {(messages === null || !detail) && <p className="mini-chat-note">Loading…</p>}
        {messages?.length === 0 && !problem && (
          <p className="mini-chat-note">No messages yet. Say hi!</p>
        )}
        {visible.map((m, i) => {
          const sender = personOf(m.senderId)
          const role = roleOf(m.senderId)
          const previous = visible[i - 1]
          const grouped =
            previous &&
            previous.senderId === m.senderId &&
            new Date(m.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60_000
          // 0.7.1: voice messages play right here.
          const voices = m.deleted ? [] : m.attachments.filter((a) => a.kind === 'file' && a.voice)
          const others = m.attachments.filter((a) => !voices.includes(a))
          const text = m.deleted
            ? 'This message was deleted.'
            : m.poll
              ? ''
              : m.gif || m.game
                ? shortBody(m.body)
                : m.body || (others.length ? attachmentSummary(others) : '')
          return (
            <div
              key={m.id}
              data-id={m.id}
              className={[
                'hd-msg',
                grouped && 'hd-msg--grouped',
                highlighted === m.id && 'hd-msg--highlight'
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {grouped ? (
                <span className="hd-msg-gap" aria-hidden="true" />
              ) : sender ? (
                <Face person={sender} size={32} />
              ) : (
                <span className="hd-face hd-face--blank" />
              )}
              <div className="hd-msg-main">
                {!grouped && (
                  <div className="hd-msg-head">
                    <span className="hd-msg-name" style={role ? { color: role.light } : undefined}>
                      {m.senderId === me.id ? 'You' : sender ? firstName(sender) : 'Someone'}
                    </span>
                    {role && (
                      <span
                        className="hd-role-badge"
                        style={{ background: role.badgeBg, color: role.badgeText }}
                      >
                        {role.name.toUpperCase()}
                      </span>
                    )}
                    <span className="hd-msg-time">
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </span>
                  </div>
                )}
                {text && (
                  <div className={m.deleted ? 'hd-msg-body hd-msg-body--deleted' : 'hd-msg-body'}>
                    <WithMentions text={text} me={me} className="hd-at" />
                    {!m.deleted && m.body && others.length > 0 && (
                      <span className="mini-bubble-files">{attachmentSummary(others)}</span>
                    )}
                  </div>
                )}
                {voices.map((a) => (
                  <VoiceBubble key={a.id} conversationId={m.conversationId} attachment={a} />
                ))}
                {m.poll && !m.deleted && (
                  <div className="hd-poll">
                    <div className="hd-poll-q">
                      <EmojiText text={m.poll.question} />
                    </div>
                    {(() => {
                      const total = m.poll.options.reduce((s, o) => s + o.votes.length, 0)
                      return m.poll.options.map((o, oi) => {
                        const mine = o.votes.includes(me.id)
                        const pct = total ? Math.round((o.votes.length / total) * 100) : 0
                        return (
                          <button
                            key={oi}
                            type="button"
                            className={mine ? 'hd-poll-opt hd-poll-opt--mine' : 'hd-poll-opt'}
                            disabled={!!m.poll?.closedAt || !!cantPost}
                            aria-pressed={mine}
                            onClick={() => void vote(m, oi)}
                          >
                            <span className="hd-poll-fill" style={{ width: `${pct}%` }} />
                            <span className="hd-poll-label">
                              <EmojiText text={o.text} />
                              {mine && ' ✓'}
                            </span>
                            <span className="hd-poll-count">{o.votes.length}</span>
                          </button>
                        )
                      })
                    })()}
                    {m.poll.closedAt && <span className="hd-poll-closed">Poll closed</span>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
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
            placeholder={cantPost ?? `Message ${title}`}
            aria-label={`Message ${title}`}
            value={draft}
            maxLength={4000}
            disabled={!!cantPost || !conversationId}
            onChange={(e) => {
              setDraft(e.target.value)
              if (conversationId) window.glofly.conversations.typing(conversationId)
            }}
          />
          <button
            type="button"
            className="mini-chat-emoji"
            aria-label="Emoji"
            disabled={!!cantPost || !conversationId}
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
      <span className="mini-chat-tail hd-mini-tail" aria-hidden="true" />
    </section>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConversationSummary,
  FriendEntry,
  Presence,
  PublicUser
} from '../../../preload/api-types'
import type { ConstellationCard, Nebula } from '@glofly/shared/constellations'
import { chatTitle } from '../lib/groups'
import { onMobile, presenceLine } from '../lib/presence'
import { isMac, isWeb } from '../lib/platform'
import {
  SETTINGS_PLACES,
  matchScore,
  readRecent,
  type RecentPlace,
  type SettingsPlace
} from '../lib/quickSwitch'
import { api as cxApi } from '../lib/constellations'
import Avatar from './Avatar'
import GroupAvatar from './GroupAvatar'
import EmojiText from './EmojiText'
import { lastMessagePreview } from '../lib/chatPreview'
import { ConstellationIcon, GearIcon, SpeakerIcon, StarIcon } from '../constellations/bits'
import { SearchIcon } from './icons'
import './QuickSwitcher.css'

// 0.7.5 Ctrl+K / ⌘K quick switcher (QuickSwitcher.dc.html): opens from anywhere and jumps to a
// chat, a friend, a constellation or one of its nebulas, or a setting. Empty, it shows the
// places you've been lately. ↑ ↓ move, Enter opens, Ctrl+Enter opens a nebula in a mini chat
// on the home dock, Esc closes.

type Item =
  | { kind: 'chat'; key: string; conversation: ConversationSummary }
  | { kind: 'friend'; key: string; friend: FriendEntry }
  | { kind: 'constellation'; key: string; card: ConstellationCard }
  | { kind: 'nebula'; key: string; card: ConstellationCard; nebula: Nebula }
  | { kind: 'setting'; key: string; place: SettingsPlace }

type Group = { title: string; items: Item[] }

export type QuickSwitcherProps = {
  me: PublicUser
  conversations: ConversationSummary[]
  friends: FriendEntry[]
  presence: Record<string, Presence>
  cards: ConstellationCard[]
  now: number
  onClose: () => void
  onOpenChat: (conversationId: string) => void
  onOpenFriend: (userId: string) => void
  onOpenConstellation: (constellationId: string, nebulaId: string | null) => void
  /** Ctrl+Enter on a nebula: its mini chat on the home dock (null when there's no dock) */
  onMiniNebula: ((constellationId: string, nebulaId: string) => void) | null
  onOpenSettings: (page: SettingsPlace['page'], focus?: string) => void
}

const LIMITS = { chat: 5, friend: 4, constellation: 5, setting: 4 }

export default function QuickSwitcher(props: QuickSwitcherProps): React.JSX.Element {
  const { me, conversations, friends, presence, cards, now, onClose } = props
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreFocus = useRef<Element | null>(null)
  /** Nebulas of each constellation, loaded once the switcher opens */
  const [nebulas, setNebulas] = useState<Record<string, Nebula[]>>({})

  useEffect(() => {
    restoreFocus.current = document.activeElement
    inputRef.current?.focus()
    return () => {
      const el = restoreFocus.current as HTMLElement | null
      if (el && typeof el.focus === 'function' && document.contains(el)) el.focus()
    }
  }, [])

  // Each constellation's nebulas (a few small requests, only while the switcher is open).
  useEffect(() => {
    let cancelled = false
    for (const card of cards.slice(0, 20)) {
      void cxApi.get(card.id).then((r) => {
        if (cancelled || !r.ok) return
        setNebulas((all) => ({ ...all, [card.id]: r.data.constellation.nebulas }))
      })
    }
    return () => {
      cancelled = true
    }
    // Loaded once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const groups = useMemo<Group[]>(() => {
    const q = query.trim()
    if (!q) {
      // Recent places, then the newest chats to fill it up.
      const recent: Item[] = []
      const seen = new Set<string>()
      const add = (item: Item | null): void => {
        if (!item || seen.has(item.key) || recent.length >= 6) return
        seen.add(item.key)
        recent.push(item)
      }
      for (const place of readRecent(me.id)) add(itemForRecent(place, conversations, cards))
      for (const c of conversations) add({ kind: 'chat', key: `chat:${c.id}`, conversation: c })
      return recent.length ? [{ title: 'Recent', items: recent }] : []
    }
    const score = <T,>(list: T[], text: (x: T) => string, keywords?: (x: T) => string): T[] =>
      list
        .map((x) => ({ x, s: matchScore(q, text(x), keywords?.(x)) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((r) => r.x)

    const chats = score(
      conversations,
      (c) => chatTitle(c),
      (c) =>
        c.kind === 'dm' ? `${c.partner.username}` : c.members.map((m) => m.displayName).join(' ')
    ).slice(0, LIMITS.chat)
    // Friends whose chat is already listed under Chats aren't listed twice.
    const shownChats = new Set(chats.map((c) => (c.kind === 'dm' ? c.partner.id : '')))
    const people = score(
      friends.filter((f) => !shownChats.has(f.id)),
      (f) => f.displayName,
      (f) => f.username
    ).slice(0, LIMITS.friend)
    const cxItems: Item[] = []
    for (const card of score(cards, (c) => c.name)) {
      cxItems.push({ kind: 'constellation', key: `cx:${card.id}`, card })
    }
    for (const card of cards) {
      for (const n of score(
        nebulas[card.id] ?? [],
        (n) => n.name,
        () => card.name
      )) {
        cxItems.push({ kind: 'nebula', key: `nb:${n.id}`, card, nebula: n })
      }
    }
    const settings = score(
      SETTINGS_PLACES.filter(
        (p) =>
          !p.only ||
          (p.only === 'desktop' && !isWeb) ||
          (p.only === 'windows' && window.glofly.platform === 'win32' && !!window.glofly.overlay)
      ),
      (p) => p.name,
      (p) => p.keywords
    ).slice(0, LIMITS.setting)
    const out: Group[] = [
      {
        title: 'Chats',
        items: chats.map((c) => ({ kind: 'chat', key: `chat:${c.id}`, conversation: c }))
      },
      {
        title: 'Friends',
        items: people.map((f) => ({
          kind: 'friend',
          key: `friend:${f.id}`,
          friend: f
        }))
      },
      { title: 'Constellations', items: cxItems.slice(0, LIMITS.constellation) },
      {
        title: 'Settings',
        items: settings.map((p) => ({ kind: 'setting', key: `set:${p.id}`, place: p }))
      }
    ]
    return out.filter((g) => g.items.length > 0)
  }, [query, conversations, friends, cards, nebulas, me.id])

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups])
  const current = flat[Math.min(active, flat.length - 1)]

  // Keep the highlighted row in view.
  useEffect(() => {
    if (!current) return
    document.getElementById(`qs-${cssId(current.key)}`)?.scrollIntoView({ block: 'nearest' })
  }, [current])

  function open(item: Item, mini: boolean): void {
    onClose()
    if (item.kind === 'chat') props.onOpenChat(item.conversation.id)
    else if (item.kind === 'friend') props.onOpenFriend(item.friend.id)
    else if (item.kind === 'constellation') props.onOpenConstellation(item.card.id, null)
    else if (item.kind === 'nebula') {
      if (mini && props.onMiniNebula) props.onMiniNebula(item.card.id, item.nebula.id)
      else props.onOpenConstellation(item.card.id, item.nebula.id)
    } else props.onOpenSettings(item.place.page, item.place.focus)
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown' && flat.length) {
      e.preventDefault()
      setActive((i) => (i + 1) % flat.length)
    } else if (e.key === 'ArrowUp' && flat.length) {
      e.preventDefault()
      setActive((i) => (i - 1 + flat.length) % flat.length)
    } else if (e.key === 'Enter' && current && !e.nativeEvent.isComposing) {
      e.preventDefault()
      open(current, e.ctrlKey || e.metaKey)
    } else if (e.key === 'Tab') {
      e.preventDefault() // focus stays in the box; arrows choose
    }
  }

  const ctrl = isMac ? '⌘' : 'Ctrl'
  let index = -1
  return (
    <div
      className="qs-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="qs-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
        onKeyDown={onKeyDown}
      >
        <div className="qs-search">
          <SearchIcon size={22} />
          <input
            ref={inputRef}
            className="qs-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0) // back to the top when the results change
            }}
            placeholder="Jump to a chat, friend, constellation or setting"
            aria-label="Jump to a chat, friend, constellation or setting"
            role="combobox"
            aria-expanded="true"
            aria-controls="qs-results"
            aria-activedescendant={current ? `qs-${cssId(current.key)}` : undefined}
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="qs-esc">Esc</kbd>
        </div>
        <div className="qs-results" id="qs-results" role="listbox" ref={listRef}>
          {groups.map((g) => (
            <div className="qs-group" key={g.title} role="group" aria-label={g.title}>
              <div className="qs-group-title" aria-hidden="true">
                {g.title}
              </div>
              {g.items.map((item) => {
                index += 1
                const i = index
                const on = current?.key === item.key
                return (
                  <div
                    key={item.key}
                    id={`qs-${cssId(item.key)}`}
                    role="option"
                    aria-selected={on}
                    className={on ? 'qs-row qs-row--on' : 'qs-row'}
                    onMouseMove={() => active !== i && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => open(item, e.ctrlKey || e.metaKey)}
                  >
                    <Row item={item} me={me} presence={presence} now={now} />
                    {on && (
                      <span className="qs-enter" aria-hidden="true">
                        Enter ↵
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="qs-empty">
              {query.trim()
                ? 'Nothing matches. Try a name, a group or a setting.'
                : 'Start typing a name, a group or a setting.'}
            </p>
          )}
        </div>
        <div className="qs-foot" aria-hidden="true">
          <span>
            <b>↑ ↓</b> move
          </span>
          <span>
            <b>Enter</b> open
          </span>
          {current?.kind === 'nebula' && props.onMiniNebula && (
            <span>
              <b>{ctrl}+Enter</b> open in mini chat
            </span>
          )}
          <span className="qs-foot-spacer" />
          <span>
            <b>{ctrl}+/</b> all shortcuts
          </span>
        </div>
      </div>
    </div>
  )
}

function itemForRecent(
  place: RecentPlace,
  conversations: ConversationSummary[],
  cards: ConstellationCard[]
): Item | null {
  if (place.kind === 'chat') {
    const c = conversations.find((x) => x.id === place.id)
    return c ? { kind: 'chat', key: `chat:${c.id}`, conversation: c } : null
  }
  const card = cards.find((x) => x.id === place.id)
  return card ? { kind: 'constellation', key: `cx:${card.id}`, card } : null
}

const cssId = (key: string): string => key.replace(/[^a-zA-Z0-9_-]/g, '-')

function Row({
  item,
  me,
  presence,
  now
}: {
  item: Item
  me: PublicUser
  presence: Record<string, Presence>
  now: number
}): React.JSX.Element {
  if (item.kind === 'chat') {
    const c = item.conversation
    const p = c.kind === 'dm' ? presence[c.partner.id] : undefined
    const unread = c.unreadCount
    return (
      <>
        {c.kind === 'dm' ? (
          <Avatar
            id={c.partner.id}
            name={c.partner.displayName}
            avatarVersion={c.partner.avatarVersion}
            size={34}
            status={p?.status}
            mobile={onMobile(p ?? undefined)}
            ring="var(--qs-row-bg)"
          />
        ) : (
          <GroupAvatar members={c.members} me={me} size={34} ring="var(--qs-row-bg)" group={c} />
        )}
        <span className="qs-text">
          <span className="qs-name">
            <EmojiText text={chatTitle(c)} />
          </span>
          <span className="qs-sub">
            {c.kind === 'group' ? 'Group · ' : ''}
            <EmojiText text={lastMessagePreview(c, me)} />
          </span>
        </span>
        {unread > 0 && (
          <span className="qs-badge" aria-label={`${unread} unread`}>
            {unread > 99 ? '99+' : unread} new
          </span>
        )}
      </>
    )
  }
  if (item.kind === 'friend') {
    const f = item.friend
    const p = presence[f.id] ?? f.presence
    const line = presenceLine(p, now)
    return (
      <>
        <Avatar
          id={f.id}
          name={f.displayName}
          avatarVersion={f.avatarVersion}
          size={34}
          status={p?.status}
          mobile={onMobile(p ?? undefined)}
          ring="var(--qs-row-bg)"
        />
        <span className="qs-text">
          <span className="qs-name">
            <EmojiText text={f.displayName} />
          </span>
          <span className="qs-sub">
            @{f.username}
            {line ? ` · ${line}` : ''}
          </span>
        </span>
      </>
    )
  }
  if (item.kind === 'constellation') {
    const card = item.card
    const news = card.unreadCount
    return (
      <>
        <ConstellationIcon
          className="qs-cx-icon"
          id={card.id}
          name={card.name}
          color={card.color}
          iconVersion={card.iconVersion}
        />
        <span className="qs-text">
          <span className="qs-name">
            <EmojiText text={card.name} />
          </span>
          <span className="qs-sub">
            Constellation · {card.onlineCount} online
            {card.voice ? ` · ${card.voice.total} in ${card.voice.nebulaName}` : ''}
          </span>
        </span>
        {news > 0 && (
          <span className="qs-badge" aria-label={`${news} unread`}>
            {news > 99 ? '99+' : news} new
          </span>
        )}
      </>
    )
  }
  if (item.kind === 'nebula') {
    const n = item.nebula
    return (
      <>
        <span className="qs-tile qs-tile--night" aria-hidden="true">
          {n.kind === 'voice' ? <SpeakerIcon size={16} /> : <StarIcon size={15} />}
        </span>
        <span className="qs-text">
          <span className="qs-name">
            {n.kind === 'text' ? '# ' : ''}
            <EmojiText text={n.name} />
          </span>
          <span className="qs-sub">
            {n.kind === 'voice' ? 'Voice nebula' : 'Nebula'} in <EmojiText text={item.card.name} />
          </span>
        </span>
        {n.unreadCount > 0 && (
          <span className="qs-badge" aria-label={`${n.unreadCount} unread`}>
            {n.unreadCount > 99 ? '99+' : n.unreadCount} new
          </span>
        )}
      </>
    )
  }
  return (
    <>
      <span className="qs-tile" aria-hidden="true">
        <GearIcon size={17} />
      </span>
      <span className="qs-text">
        <span className="qs-name">{item.place.name}</span>
        <span className="qs-sub">{item.place.where}</span>
      </span>
    </>
  )
}

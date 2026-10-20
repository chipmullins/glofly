import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CONSTELLATION_THEME,
  CONSTELLATION_TYPES,
  voiceLine,
  type ConstellationCard,
  type ConstellationInvite,
  type ConstellationType,
  type DirectoryEntry
} from '@glofly/shared/constellations'
import type { MyStatus, SignedInUser } from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import StatusDot from '../components/StatusDot'
import { api } from '../lib/constellations'
import {
  BannerStars,
  ConstellationIcon,
  LinkOutIcon,
  PlusIcon,
  SearchIconLine,
  SpeakerIcon,
  StarIcon
} from './bits'
import { DashboardSky, FireflyMark } from './sky'
import NebulaSky from './NebulaSky'
import './Discover.css'

// The Constellations dashboard (Dashboard.dc.html, approved): the night sky, "Back to Glofly" top
// left, search, your profile top right; your constellations as cards in 3 columns; invites from
// friends. Searching also looks in the directory of public constellations.

const STATUS_WORD: Record<MyStatus['status'], string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do not disturb',
  invisible: 'Invisible'
}

export function MeChip({
  me,
  status
}: {
  me: SignedInUser
  status: MyStatus['status']
}): React.JSX.Element {
  const [bg, fg] = ['#f47a1f', '#2a1406']
  const dot = status === 'invisible' ? 'offline' : status
  return (
    <div className="cx-me">
      <span
        className="avatar"
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          background: bg,
          color: fg,
          fontSize: 13,
          position: 'relative'
        }}
      >
        <AvatarFace id={me.id} name={me.displayName} avatarVersion={me.avatarVersion} />
        <StatusDot status={dot} ring="#1c1210" size={11} />
      </span>
      <span>
        <span className="cx-me-name">{me.displayName}</span>
        <span className={`cx-me-status cx-me-status--${dot}`}>{STATUS_WORD[status]}</span>
      </span>
    </div>
  )
}

/** "Active today", "Quiet since yesterday", "Quiet since Monday", "Quiet since Oct 3". */
function quietLabel(iso: string, now: number): string {
  const d = new Date(iso)
  const today = new Date(now)
  const startOf = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000)
  if (days <= 0) return 'Active today'
  if (days === 1) return 'Quiet since yesterday'
  if (days < 7) return `Quiet since ${d.toLocaleDateString(undefined, { weekday: 'long' })}`
  return `Quiet since ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function Card({
  card,
  now,
  onOpen,
  dragging,
  dragProps
}: {
  card: ConstellationCard
  now: number
  onOpen: () => void
  dragging: boolean
  dragProps: React.HTMLAttributes<HTMLButtonElement> & { draggable: boolean }
}): React.JSX.Element {
  const t = CONSTELLATION_THEME[card.color]
  const badge =
    card.mentionCount > 0
      ? '@you'
      : card.unreadCount > 0
        ? `${card.unreadCount > 99 ? '99+' : card.unreadCount} new`
        : null
  return (
    <button
      type="button"
      className={dragging ? 'cx-card cx-card--mine cx-card--dragging' : 'cx-card cx-card--mine'}
      onClick={onOpen}
      aria-label={`${card.name}, ${card.memberCount} members, ${card.onlineCount} online${badge ? `, ${badge}` : ''}`}
      {...dragProps}
    >
      <div className="cx-banner" style={{ background: t.banner }}>
        {card.sky?.length ? (
          <NebulaSky
            id={card.id}
            stars={card.sky.map((star, i) => ({ ...star, key: String(i), label: '' }))}
            scale={0.6}
          />
        ) : (
          <BannerStars id={card.id} color={card.color} />
        )}
        {badge && (
          <span
            className="cx-card-badge"
            style={
              card.mentionCount > 0
                ? {
                    background: CONSTELLATION_THEME.violet.badge,
                    color: CONSTELLATION_THEME.violet.badgeText
                  }
                : { background: '#f47a1f', color: '#2a1406' }
            }
          >
            {badge}
          </span>
        )}
      </div>
      <div className="cx-card-body">
        <ConstellationIcon
          id={card.id}
          name={card.name}
          color={card.color}
          iconVersion={card.iconVersion}
          className="cx-card-icon"
          style={
            card.color === 'ember' && !card.iconVersion
              ? { background: '#120c0a', color: '#ffb347' }
              : undefined
          }
        />
        <span className="cx-card-name">{card.name}</span>
        <span className="cx-card-count">
          {card.memberCount} {card.memberCount === 1 ? 'member' : 'members'} ·{' '}
          <span className="cx-online">{card.onlineCount} online</span>
        </span>
        {card.voice ? (
          <span className="cx-card-line">
            <SpeakerIcon size={15} color="#6fd39a" />
            <span>{voiceLine(card.voice.people, card.voice.nebulaName, card.voice.total)}</span>
            {card.voice.live && <span className="cx-live">LIVE</span>}
          </span>
        ) : card.lastMention ? (
          <span className="cx-card-line">
            <StarIcon size={15} color={t.accent} />
            <span>
              {card.lastMention.by.displayName.split(/\s+/)[0]} mentioned you in{' '}
              {card.lastMention.nebulaName}
            </span>
          </span>
        ) : (
          <span className="cx-card-line cx-card-line--quiet">
            <StarIcon size={15} color="#d9c2b1" />
            <span>{quietLabel(card.activityAt, now)}</span>
          </span>
        )}
        <span className="cx-card-role" style={{ color: card.role.owner ? '#ffb347' : t.accent }}>
          {card.role.owner ? "You're the Owner" : card.role.name}
        </span>
      </div>
    </button>
  )
}

/** A constellation in the directory (or a search result there). */
export function DirectoryCard({
  entry,
  busy,
  onJoin,
  onOpen,
  onTag
}: {
  entry: DirectoryEntry
  busy: boolean
  onJoin: () => void
  onOpen: () => void
  onTag: (tag: string) => void
}): React.JSX.Element {
  const t = CONSTELLATION_THEME[entry.color]
  const typeName = CONSTELLATION_TYPES.find((x) => x.id === entry.type)?.name
  return (
    <div className="cx-card" style={{ cursor: 'default' }}>
      <div className="cx-banner" style={{ background: t.banner }}>
        <BannerStars id={entry.id} color={entry.color} />
        {typeName && (
          <span
            className="cx-card-badge"
            style={{ background: 'rgba(18,12,10,.65)', color: '#f5ede6' }}
          >
            {typeName}
          </span>
        )}
      </div>
      <div className="cx-card-body">
        <ConstellationIcon
          id={entry.id}
          name={entry.name}
          color={entry.color}
          iconVersion={entry.iconVersion}
          className="cx-card-icon"
        />
        <span className="cx-card-name">{entry.name}</span>
        <span className="cx-card-count">
          {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'} ·{' '}
          <span className="cx-online">{entry.onlineCount} online</span>
        </span>
        {entry.description && <span className="cx-dir-desc">{entry.description}</span>}
        {entry.tags.length > 0 && (
          <span className="cx-tags">
            {entry.tags.map((tag) => (
              <button key={tag} type="button" className="cx-tag" onClick={() => onTag(tag)}>
                #{tag}
              </button>
            ))}
          </span>
        )}
        <span className="cx-dir-foot">
          <span className="cx-dir-friends">
            {entry.friends.length > 0
              ? `${entry.friends.map((f) => f.displayName.split(/\s+/)[0]).join(', ')} ${entry.friends.length === 1 ? 'is' : 'are'} in it`
              : entry.visibility === 'approval'
                ? 'A moderator lets people in'
                : 'Anyone can join'}
          </span>
          {entry.joined ? (
            <button type="button" className="cx-small-pill" onClick={onOpen}>
              Open
            </button>
          ) : entry.requested ? (
            <button type="button" className="cx-small-pill" disabled>
              Asked to join
            </button>
          ) : (
            <button
              type="button"
              className="cx-small-pill cx-small-pill--join"
              disabled={busy}
              onClick={onJoin}
            >
              {entry.visibility === 'approval' ? 'Ask to join' : 'Join'}
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

export default function Dashboard({
  me,
  myStatus,
  cards,
  invites,
  loaded,
  onBack,
  onOpen,
  onCreate,
  onJoined,
  onReorder,
  onProblem,
  onAskToJoin
}: {
  me: SignedInUser
  myStatus: MyStatus
  cards: ConstellationCard[]
  invites: ConstellationInvite[]
  loaded: boolean
  onBack: () => void
  onOpen: (constellationId: string) => void
  onCreate: (tab: 'create' | 'join') => void
  /** Joined from an invite or the directory: open it */
  onJoined: (constellationId: string) => void
  onReorder: (ids: string[]) => void
  onProblem: (message: string) => void
  /** Public, approval needed: write a note to the moderators */
  onAskToJoin: (entry: DirectoryEntry) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [type, setType] = useState<ConstellationType | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [found, setResults] = useState<DirectoryEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[] | null>(null)
  const [now] = useState(() => Date.now())
  /** The directory shows while you search (or after "Browse public constellations"). */
  const [browse, setBrowse] = useState(false)
  const searching = query.trim().length > 0 || type !== null || tag !== null
  const seq = useRef(0)
  // "Adventure to new constellations": popular tags and a few to try (quietly empty on failure).
  const [discover, setDiscover] = useState<{ tags: string[]; suggestions: DirectoryEntry[] }>({
    tags: [],
    suggestions: []
  })
  useEffect(() => {
    let stale = false
    void api.discover().then((r) => {
      if (!stale && r.ok) setDiscover(r.data)
    })
    return () => {
      stale = true
    }
  }, [cards.length])
  const results = searching ? found : null

  // The directory, as you type (a moment after you stop).
  useEffect(() => {
    const n = ++seq.current
    if (!searching) return
    const timer = setTimeout(() => {
      void api.directory(query, type, tag).then((r) => {
        if (n !== seq.current) return
        if (r.ok) {
          setResults(r.data.results)
          setHasMore(r.data.hasMore)
        } else onProblem(r.message)
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [query, type, tag, searching, onProblem])

  const shown = useMemo(() => {
    const ordered = order
      ? order.map((id) => cards.find((c) => c.id === id)).filter((c): c is ConstellationCard => !!c)
      : cards
    const extra = cards.filter((c) => !ordered.includes(c))
    const all = [...ordered, ...extra]
    const q = query.trim().toLowerCase()
    return q ? all.filter((c) => c.name.toLowerCase().includes(q)) : all
  }, [cards, order, query])

  async function more(): Promise<void> {
    const r = await api.directory(query, type, tag, results?.length ?? 0)
    if (r.ok) {
      setResults([...(results ?? []), ...r.data.results])
      setHasMore(r.data.hasMore)
    }
  }

  async function join(entry: DirectoryEntry): Promise<void> {
    if (entry.visibility === 'approval') {
      onAskToJoin(entry)
      return
    }
    setBusy(entry.id)
    const r = await api.join(entry.id)
    setBusy(null)
    if (!r.ok) {
      onProblem(r.message)
      return
    }
    onJoined(entry.id)
  }

  async function acceptInvite(invite: ConstellationInvite): Promise<void> {
    setBusy(invite.id)
    const r = await api.join(invite.constellation.id)
    setBusy(null)
    if (!r.ok) {
      onProblem(r.message)
      return
    }
    onJoined(invite.constellation.id)
  }

  async function dismiss(invite: ConstellationInvite): Promise<void> {
    setBusy(invite.id)
    await api.dismissInvite(invite.id)
    setBusy(null)
  }

  function dragPropsFor(
    card: ConstellationCard
  ): React.HTMLAttributes<HTMLButtonElement> & { draggable: boolean } {
    if (searching) return { draggable: false }
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragId(card.id)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver: (e) => {
        if (!dragId || dragId === card.id) return
        e.preventDefault()
        const ids = shown.map((c) => c.id)
        const from = ids.indexOf(dragId)
        const to = ids.indexOf(card.id)
        if (from < 0 || to < 0) return
        ids.splice(to, 0, ids.splice(from, 1)[0])
        setOrder(ids)
      },
      onDragEnd: () => {
        if (dragId && order) onReorder(order)
        setDragId(null)
      }
    }
  }

  return (
    <div className="cx-dash">
      <DashboardSky />
      <header className="cx-dash-header">
        <button
          type="button"
          className="cx-back"
          aria-label="Back to Glofly home: Chats, Friends and Groups"
          onClick={onBack}
        >
          <span className="cx-back-mark">
            <FireflyMark size={24} />
          </span>
          Back to Glofly
        </button>
        <span style={{ flex: 1 }} />
        <label className="cx-search">
          <SearchIconLine />
          <input
            type="search"
            placeholder="Find a constellation"
            aria-label="Find a constellation"
            value={query}
            maxLength={60}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setBrowse(true)}
          />
        </label>
        <MeChip me={me} status={myStatus.status} />
      </header>

      <main className="cx-dash-main">
        <div className="cx-dash-title-row">
          <div className="cx-dash-title">
            <h1>Your constellations</h1>
            <p>Communities you belong to. Pick one to fly in.</p>
          </div>
          <button type="button" className="cx-pill" onClick={() => onCreate('join')}>
            <LinkOutIcon />
            Join with an invite
          </button>
          <button
            type="button"
            className="cx-pill cx-pill--gold"
            onClick={() => onCreate('create')}
          >
            <PlusIcon />
            Create a constellation
          </button>
        </div>

        {shown.length > 0 ? (
          <div className="cx-cards">
            {shown.map((card) => (
              <Card
                key={card.id}
                card={card}
                now={now}
                onOpen={() => onOpen(card.id)}
                dragging={dragId === card.id}
                dragProps={dragPropsFor(card)}
              />
            ))}
          </div>
        ) : loaded && !searching ? (
          <div className="cx-empty">
            <h2>No constellations yet</h2>
            <p>
              Make one for your crew, join one with a friend’s invite, or find a public one to fly
              into.
            </p>
            {!browse && (
              <button
                type="button"
                className="cx-pill"
                style={{ margin: '16px auto 0' }}
                onClick={() => setBrowse(true)}
              >
                Browse public constellations
              </button>
            )}
          </div>
        ) : searching && query.trim() ? (
          <p className="cx-dash-title" style={{ color: '#d9c2b1', margin: 0 }}>
            None of yours match “{query.trim()}”.
          </p>
        ) : null}

        {invites.length > 0 && !searching && (
          <section className="cx-invites" aria-labelledby="cx-inv-head">
            <h2 id="cx-inv-head" className="cx-section-head">
              Invites
            </h2>
            {invites.map((inv) => (
              <div key={inv.id} className="cx-invite">
                <ConstellationIcon
                  id={inv.constellation.id}
                  name={inv.constellation.name}
                  color={inv.constellation.color}
                  iconVersion={inv.constellation.iconVersion}
                  className="cx-invite-icon"
                />
                <span className="cx-invite-text">
                  <strong>{inv.constellation.name}</strong>
                  <span>
                    {inv.by.displayName.split(/\s+/)[0]} invited you ·{' '}
                    {inv.constellation.memberCount}{' '}
                    {inv.constellation.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </span>
                <button
                  type="button"
                  className="cx-small-pill"
                  disabled={busy === inv.id}
                  onClick={() => void dismiss(inv)}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="cx-small-pill cx-small-pill--join"
                  disabled={busy === inv.id}
                  onClick={() => void acceptInvite(inv)}
                >
                  Join
                </button>
              </div>
            ))}
          </section>
        )}

        {!browse && !searching && (
          <Adventure
            tags={discover.tags}
            suggestions={discover.suggestions.filter(
              (e) => !e.joined && !cards.some((c) => c.id === e.id)
            )}
            busyId={busy}
            onBrowse={() => setBrowse(true)}
            onType={(t) => {
              setBrowse(true)
              setType(t)
            }}
            onTag={(t) => {
              setBrowse(true)
              setTag(t)
            }}
            onJoin={(e) => void join(e)}
          />
        )}

        {(browse || searching) && (
          <section className="cx-invites" aria-labelledby="cx-dir-head">
            <h2 id="cx-dir-head" className="cx-section-head">
              {searching ? 'In the directory' : 'Public constellations'}
            </h2>
            <div className="cx-chips" role="group" aria-label="Kind of constellation">
              {CONSTELLATION_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="cx-chip"
                  aria-pressed={type === t.id}
                  onClick={() => setType((cur) => (cur === t.id ? null : t.id))}
                >
                  {t.name}
                </button>
              ))}
              {tag && (
                <button type="button" className="cx-chip" aria-pressed onClick={() => setTag(null)}>
                  #{tag} ✕
                </button>
              )}
            </div>
            {results && results.length > 0 && (
              <div className="cx-cards">
                {results.map((entry) => (
                  <DirectoryCard
                    key={entry.id}
                    entry={entry}
                    busy={busy === entry.id}
                    onJoin={() => void join(entry)}
                    onOpen={() => onOpen(entry.id)}
                    onTag={(t) => setTag(t)}
                  />
                ))}
              </div>
            )}
            {results && results.length === 0 && (
              <p style={{ margin: 0, color: '#d9c2b1' }}>No public constellations match yet.</p>
            )}
            {!results && !searching && (
              <p style={{ margin: 0, color: '#d9c2b1' }}>
                Pick a kind above, or type a name or a tag in the search, to find constellations you
                can join.
              </p>
            )}
            {hasMore && (
              <button
                type="button"
                className="cx-pill"
                style={{ alignSelf: 'center' }}
                onClick={() => void more()}
              >
                Show more
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  )
}

/** "Adventure to new constellations" (Discover board, approved Oct 17): kinds, popular tags, and a
 * few public constellations to try, under your own so a short dashboard never looks empty. */
function Adventure({
  tags,
  suggestions,
  busyId,
  onBrowse,
  onType,
  onTag,
  onJoin
}: {
  tags: string[]
  suggestions: DirectoryEntry[]
  busyId: string | null
  onBrowse: () => void
  onType: (type: ConstellationType) => void
  onTag: (tag: string) => void
  onJoin: (entry: DirectoryEntry) => void
}): React.JSX.Element {
  return (
    <section className="cx-adv" aria-labelledby="cx-adv-head">
      <div className="cx-adv-top">
        <div className="cx-adv-titles">
          <h2 id="cx-adv-head" className="cx-adv-head">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffb347" aria-hidden="true">
              <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
              <circle cx="19" cy="4" r="1.2" />
              <circle cx="5" cy="19" r="1" />
            </svg>
            Adventure to new constellations
          </h2>
          <p>Find a crew by what you’re into.</p>
        </div>
        <button type="button" className="cx-adv-browse" onClick={onBrowse}>
          Browse all
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="cx-adv-kinds" role="group" aria-label="Kinds">
        {CONSTELLATION_TYPES.filter((t) => t.id !== 'other').map((t) => (
          <button key={t.id} type="button" className="cx-adv-kind" onClick={() => onType(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      {tags.length > 0 && (
        <div className="cx-adv-tags" role="group" aria-label="Popular tags">
          <span className="cx-adv-label">Popular tags</span>
          {tags.map((t) => (
            <button key={t} type="button" className="cx-adv-tag" onClick={() => onTag(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="cx-adv-cards">
          {suggestions.map((e) => (
            <SuggestionCard key={e.id} entry={e} busy={busyId === e.id} onJoin={() => onJoin(e)} />
          ))}
        </div>
      )}
    </section>
  )
}

/** A compact constellation to try: icon, name, kind and size, one line about it, two tags. */
function SuggestionCard({
  entry,
  busy,
  onJoin
}: {
  entry: DirectoryEntry
  busy: boolean
  onJoin: () => void
}): React.JSX.Element {
  const typeName = CONSTELLATION_TYPES.find((x) => x.id === entry.type)?.name
  const friend = entry.friends[0]
  const hint = friend
    ? entry.friends.length > 1
      ? `${firstOf(friend.displayName)} and ${entry.friends.length - 1} more are in it`
      : `${firstOf(friend.displayName)} is in it`
    : entry.visibility === 'approval'
      ? 'A moderator lets people in'
      : 'Anyone can join'
  return (
    <article className="cx-adv-card">
      <div className="cx-adv-card-top">
        <ConstellationIcon
          id={entry.id}
          name={entry.name}
          color={entry.color}
          iconVersion={entry.iconVersion}
          className="cx-adv-card-icon"
        />
        <span className="cx-adv-card-text">
          <span className="cx-adv-card-name">{entry.name}</span>
          <span className="cx-adv-card-meta">
            {typeName ? `${typeName} · ` : ''}
            {entry.memberCount} {entry.memberCount === 1 ? 'member' : 'members'} ·{' '}
            <span className="cx-online">{entry.onlineCount} online</span>
          </span>
        </span>
        {entry.requested ? (
          <span className="cx-adv-asked">Asked</span>
        ) : entry.visibility === 'approval' ? (
          <button type="button" className="cx-adv-ask" disabled={busy} onClick={onJoin}>
            Ask to join
          </button>
        ) : (
          <button type="button" className="cx-adv-join" disabled={busy} onClick={onJoin}>
            Join
          </button>
        )}
      </div>
      {entry.description && <span className="cx-adv-card-desc">{entry.description}</span>}
      <span className="cx-adv-card-foot">
        {entry.tags.slice(0, 2).map((t) => (
          <span key={t} className="cx-adv-card-tag">
            #{t}
          </span>
        ))}
        <span className="cx-adv-card-hint">{hint}</span>
      </span>
    </article>
  )
}

const firstOf = (name: string): string => name.trim().split(/\s+/)[0] || name

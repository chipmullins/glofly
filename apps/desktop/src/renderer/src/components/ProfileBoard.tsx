import { useEffect, useState } from 'react'
import type {
  ActivityItem,
  BoardTileView,
  MutualConstellation,
  ProfileConstellation,
  PublicUser
} from '../../../preload/api-types'
import { playtimeLabel, type ConstellationColor } from '@glofly/shared/constellations'
import { colorsFor } from '../lib/avatarColors'
import { relativeDay } from '../lib/myGamesTime'
import { api } from '../lib/constellations'
import { gameCoverUrl } from '../lib/media'
import { IGDB_CREDIT, IGDB_URL } from '@glofly/shared'
import { ConstellationIcon } from '../constellations/bits'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import { GameIcon } from './icons'
import './ProfileBoard.css'

// Profiles 2.0 (0.9.1, canvas "Glofly profiles" boards Main and Tabs): the board's tiles, the
// Mutual friends / Mutual constellations / Activity tabs. Used by the profile card and the live
// preview in Settings → Profile.

/** A game's picture. Until box art arrives it's the game's colors and letters. */
export function GameArt({
  name,
  cover,
  className = 'pb-art'
}: {
  name: string
  /** Box art's image id (IGDB) */
  cover?: string | null
  className?: string
}): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const [bg, fg] = colorsFor(name)
  if (cover && cover !== failed) {
    return (
      <span className={`${className} pb-art--cover`} aria-hidden="true" style={{ background: bg }}>
        <img src={gameCoverUrl(cover)} alt="" draggable={false} loading="lazy" onError={() => setFailed(cover)} />
      </span>
    )
  }
  const letters = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? '')
    .join('')
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ background: `linear-gradient(160deg, ${bg}, color-mix(in srgb, ${bg} 55%, #fff))`, color: fg }}
    >
      {letters || '?'}
    </span>
  )
}

const hours = (s: number): string => (s >= 3600 ? `${Math.round(s / 3600)} h` : playtimeLabel(s))

function ConstellationTile({
  c,
  onOpen,
  preview
}: {
  c: ProfileConstellation
  onOpen?: (id: string) => void
  preview?: boolean
}): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'busy' | 'joined' | 'asked'>(c.joined ? 'joined' : 'idle')
  const [problem, setProblem] = useState<string | null>(null)
  const join = async (): Promise<void> => {
    setState('busy')
    setProblem(null)
    const r = await api.join(c.id)
    if (!r.ok) {
      setState('idle')
      setProblem(r.message)
    } else setState('requested' in r.data ? 'asked' : 'joined')
  }
  return (
    <div className="pb-tile pb-tile--night">
      <span className="pb-label">A constellation I love</span>
      <div className="pb-cx">
        <ConstellationIcon
          id={c.id}
          name={c.name}
          color={c.color as ConstellationColor}
          iconVersion={c.iconVersion}
          className="pb-cx-icon"
        />
        <div>
          <b>{c.name}</b>
          <div className="pb-cx-sub">
            {c.memberCount.toLocaleString()} {c.memberCount === 1 ? 'member' : 'members'}
          </div>
        </div>
      </div>
      {!preview &&
        (state === 'joined' ? (
          <button type="button" className="pb-cx-button pb-cx-button--quiet" onClick={() => onOpen?.(c.id)}>
            Open
          </button>
        ) : state === 'asked' ? (
          <span className="pb-cx-asked">Asked to join</span>
        ) : (
          <button type="button" className="pb-cx-button" disabled={state === 'busy'} onClick={() => void join()}>
            {c.visibility === 'approval' ? 'Ask to join' : 'Join'}
          </button>
        ))}
      {problem && (
        <span className="pb-problem" role="alert">
          {problem}
        </span>
      )}
    </div>
  )
}

/** The board's tiles in a 3-column grid (games and I'm into take two columns). */
export function BoardGrid({
  tiles,
  name,
  onOpenConstellation,
  onAllGames,
  preview
}: {
  tiles: BoardTileView[]
  name: string
  onOpenConstellation?: (id: string) => void
  onAllGames?: () => void
  /** The small live preview in Settings (no buttons) */
  preview?: boolean
}): React.JSX.Element {
  return (
    <div className={preview ? 'pb-grid pb-grid--preview' : 'pb-grid'}>
      {tiles.map((t, i) => {
        switch (t.kind) {
          case 'games':
            return (
              <div key={i} className="pb-tile pb-tile--wide pb-tile--line">
                <span className="pb-label">Favorite games</span>
                <div className="pb-games">
                  {t.games.map((g) => (
                    <div key={g.key} className="pb-game">
                      <GameArt name={g.name} cover={g.cover} />
                      <b>{g.name}</b>
                      {g.seconds !== undefined && <span>{hours(g.seconds)}</span>}
                    </div>
                  ))}
                </div>
                {!preview && t.games.some((g) => g.cover) && (
                  <a className="pb-credit" href={IGDB_URL} target="_blank" rel="noreferrer">
                    {IGDB_CREDIT}
                  </a>
                )}
                {onAllGames && !preview && (
                  <button type="button" className="pb-link" onClick={onAllGames}>
                    All {name}’s games (My games)
                  </button>
                )}
              </div>
            )
          case 'note':
            return (
              <div key={i} className="pb-tile pb-tile--note">
                <span className="pb-label">Note</span>
                <p>
                  <EmojiText text={t.text} />
                </p>
              </div>
            )
          case 'constellation':
            return (
              <ConstellationTile key={t.constellation.id} c={t.constellation} onOpen={onOpenConstellation} preview={preview} />
            )
          case 'into':
            return (
              <div key={i} className="pb-tile pb-tile--wide pb-tile--line">
                <span className="pb-label">I’m into</span>
                <div className="pb-tags">
                  {t.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              </div>
            )
          case 'playing':
            return (
              <div key={i} className="pb-tile pb-tile--night">
                <span className="pb-label">Playing now</span>
                {t.game ? (
                  <div className="pb-cx">
                    <GameArt name={t.game} cover={t.cover} className="pb-art pb-art--small" />
                    <b>{t.game}</b>
                  </div>
                ) : (
                  <span className="pb-cx-sub">
                    <GameIcon size={15} /> Nothing right now
                  </span>
                )}
              </div>
            )
        }
      })}
    </div>
  )
}

/** Mutual friends tab. */
export function MutualFriends({
  userId,
  onViewPerson
}: {
  userId: string
  onViewPerson: (p: PublicUser) => void
}): React.JSX.Element {
  const m = useMutuals(userId)
  if (m === undefined) return <p className="pb-empty">Loading…</p>
  if (m === null || !m.friends.length)
    return <p className="pb-empty">{m === null ? 'They keep this to themselves.' : 'No friends in common yet.'}</p>
  return (
    <div className="pb-list">
      {m.friends.map((f) => (
        <div key={f.id} className="pb-person">
          <Avatar id={f.id} name={f.displayName} avatarVersion={f.avatarVersion} size={40} />
          <div className="pb-person-text">
            <b>{f.displayName}</b>
            <span>@{f.username}</span>
          </div>
          <button type="button" className="pb-person-button" onClick={() => onViewPerson(f)}>
            Profile
          </button>
        </div>
      ))}
      <span className="pb-note">Only friends you both have. Nobody sees someone’s whole friend list.</span>
    </div>
  )
}

/** Mutual constellations tab. */
export function MutualConstellations({
  userId,
  name,
  onOpenConstellation
}: {
  userId: string
  name: string
  onOpenConstellation?: (id: string) => void
}): React.JSX.Element {
  const m = useMutuals(userId)
  if (m === undefined) return <p className="pb-empty">Loading…</p>
  if (m === null || !m.constellations.length)
    return <p className="pb-empty">{m === null ? 'They keep this to themselves.' : 'No constellations in common yet.'}</p>
  return (
    <div className="pb-cx-list">
      {m.constellations.map((c: MutualConstellation) => (
        <button key={c.id} type="button" className="pb-cx-row" onClick={() => onOpenConstellation?.(c.id)}>
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color as ConstellationColor}
            iconVersion={c.iconVersion}
            className="pb-cx-icon"
          />
          <span>
            <b>{c.name}</b>
            <span className="pb-cx-sub">
              {name.split(' ')[0]}: {c.roles.length ? c.roles.join(' · ') : 'Member'}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

type MutualsData = { friends: PublicUser[]; constellations: MutualConstellation[] } | null | undefined
const mutualsCache = new Map<string, { at: number; data: MutualsData }>()

/** Both mutual tabs share one load. undefined = loading, null = hidden. */
function useMutuals(userId: string): MutualsData {
  const cached = mutualsCache.get(userId)
  const fresh = cached && Date.now() - cached.at < 30_000 ? cached.data : undefined
  const [data, setData] = useState<MutualsData>(fresh)
  useEffect(() => {
    if (fresh !== undefined) return
    let cancelled = false
    void window.glofly.profile.mutuals(userId).then((r) => {
      const value: MutualsData = r.ok ? (r.data.shown ? r.data : null) : null
      mutualsCache.set(userId, { at: Date.now(), data: value })
      if (!cancelled) setData(value)
    })
    return () => {
      cancelled = true
    }
  }, [userId, fresh])
  return data
}

function activityText(i: ActivityItem): { title: string; sub: string } {
  const day = relativeDay(i.at)
  const Day = day.charAt(0).toUpperCase() + day.slice(1)
  if (i.kind === 'played') return { title: `Played ${i.game}`, sub: `${playtimeLabel(i.seconds)} in all · ${day}` }
  if (i.kind === 'started') return { title: `Started playing ${i.game}`, sub: `${Day} · new to their games` }
  return { title: `Joined ${i.constellation.name}`, sub: `${Day} · a public constellation` }
}

/** Activity tab. */
export function ActivityList({ userId, as }: { userId: string; as?: 'friend' | 'everyone' }): React.JSX.Element {
  const [items, setItems] = useState<ActivityItem[] | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void window.glofly.profile.activity(userId, as).then((r) => {
      if (!cancelled) setItems(r.ok && r.data.shown ? r.data.items : null)
    })
    return () => {
      cancelled = true
    }
  }, [userId, as])
  if (items === undefined) return <p className="pb-empty">Loading…</p>
  if (items === null) return <p className="pb-empty">They keep this to themselves.</p>
  if (!items.length) return <p className="pb-empty">Nothing in the last 30 days.</p>
  return (
    <div className="pb-list">
      {items.map((i, n) => {
        const t = activityText(i)
        return (
          <div key={n} className="pb-activity">
            {i.kind === 'joined' ? (
              <ConstellationIcon
                id={i.constellation.id}
                name={i.constellation.name}
                color={i.constellation.color as ConstellationColor}
                iconVersion={i.constellation.iconVersion}
                className="pb-cx-icon pb-cx-icon--big"
              />
            ) : (
              <GameArt name={i.game} cover={i.cover} className="pb-art pb-art--row" />
            )}
            <div className="pb-person-text">
              <b>{t.title}</b>
              <span>{t.sub}</span>
            </div>
          </div>
        )
      })}
      <span className="pb-note">Only things that already show elsewhere: games (if My games is shared) and public constellations. Never chats, calls or private constellations.</span>
    </div>
  )
}

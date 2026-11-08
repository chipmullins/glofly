import { useEffect, useState } from 'react'
import EmptyScene from './EmptyScene'
import {
  MY_GAMES_VISIBILITY,
  playtimeLabel,
  type MyGame,
  type MyGamesVisibility
} from '@glofly/shared/constellations'
import { api } from '../lib/constellations'
import { colorsFor } from '../lib/avatarColors'
import { gameCoverUrl } from '../lib/media'
import { IGDB_CREDIT, IGDB_URL } from '@glofly/shared'
import { relativeDay } from '../lib/myGamesTime'
import './MyGames.css'

// My games (Glofly 2.0): a pop-out from a profile card with the games someone has played,
// favorites (starred) first, then by playtime. Playtime comes from "Playing …" (the desktop app
// notices the game), counted a minute at a time by the server. On your own card you can star or
// hide games, remove one, and pick who sees the list (Everyone / Friends / Only me).

function GameTile({ name, cover }: { name: string; cover?: string }): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const [bg, fg] = colorsFor(name)
  if (cover && cover !== failed) {
    return (
      <span className="mg-tile mg-tile--cover" aria-hidden="true" style={{ background: bg }}>
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
    <span className="mg-tile" aria-hidden="true" style={{ background: bg, color: fg }}>
      {letters || '?'}
    </span>
  )
}

export default function MyGamesPanel({
  userId,
  name,
  isMe,
  onClose,
  leaving = false
}: {
  userId: string
  name: string
  isMe: boolean
  onClose: () => void
  /** 0.9.1: on its way out (closing animation) */
  leaving?: boolean
}): React.JSX.Element {
  const [games, setGames] = useState<MyGame[] | null>(null)
  const [visibility, setVisibility] = useState<MyGamesVisibility>('friends')
  const [shared, setShared] = useState(true)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    const load = (): void => {
      void (isMe ? api.myGames() : api.gamesOf(userId)).then((r) => {
        if (stale) return
        if (!r.ok) {
          setProblem(r.message)
          return
        }
        setGames(r.data.games)
        setVisibility(r.data.visibility)
        setShared('shared' in r.data ? (r.data as { shared: boolean }).shared : true)
      })
    }
    load()
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'games:changed' && isMe) load()
    })
    return () => {
      stale = true
      stop()
    }
  }, [isMe, userId])

  async function change(
    key: string,
    changes: { favorite?: boolean; hidden?: boolean }
  ): Promise<void> {
    const r = await api.setGame(key, changes)
    if (r.ok) setGames(r.data.games)
    else setProblem(r.message)
  }
  async function remove(key: string): Promise<void> {
    const r = await api.removeGame(key)
    if (r.ok) setGames(r.data.games)
    else setProblem(r.message)
  }

  const favorites = (games ?? []).filter((g) => g.favorite)
  const rest = (games ?? []).filter((g) => !g.favorite)
  const first = name.trim().split(/\s+/)[0] || name

  const row = (g: MyGame): React.JSX.Element => (
    <li key={g.key} className={g.hidden ? 'mg-game mg-game--hidden' : 'mg-game'}>
      <span className="mg-tile-wrap">
        <GameTile name={g.name} cover={g.cover} />
        {/* 0.9.3: Steam counted this game's time (board 7) */}
        {g.steam && (
          <span className="mg-steam" title="Playtime from Steam">
            STEAM
          </span>
        )}
      </span>
      <span className="mg-game-text">
        <strong>{g.name}</strong>
        <span>
          {playtimeLabel(g.seconds)} · last played {relativeDay(g.lastPlayedAt)}
          {g.hidden ? ' · hidden' : ''}
        </span>
      </span>
      {isMe && (
        <span className="mg-game-actions">
          <button
            type="button"
            className={g.favorite ? 'mg-star mg-star--on' : 'mg-star'}
            aria-pressed={g.favorite}
            aria-label={g.favorite ? `Unstar ${g.name}` : `Star ${g.name} as a favorite`}
            title={g.favorite ? 'Favorite' : 'Star as a favorite'}
            onClick={() => void change(g.key, { favorite: !g.favorite })}
          >
            ★
          </button>
          <button
            type="button"
            className="mg-small"
            aria-label={g.hidden ? `Show ${g.name} to others` : `Hide ${g.name} from others`}
            title={g.hidden ? 'Show to others' : 'Hide from others'}
            onClick={() => void change(g.key, { hidden: !g.hidden })}
          >
            {g.hidden ? 'Show' : 'Hide'}
          </button>
          <button
            type="button"
            className="mg-small mg-small--danger"
            aria-label={`Remove ${g.name}`}
            title="Remove from your list"
            onClick={() => void remove(g.key)}
          >
            ×
          </button>
        </span>
      )}
      {!isMe && g.favorite && (
        <span className="mg-fav" aria-label="Favorite">
          ★
        </span>
      )}
    </li>
  )

  return (
    <aside className={leaving ? 'mg-panel glo-side-out' : 'mg-panel glo-side-in'} inert={leaving || undefined} role="dialog" aria-label={isMe ? 'My games' : `${first}'s games`}>
      <header className="mg-head">
        <h3>{isMe ? 'My games' : `${first}'s games`}</h3>
        <button type="button" className="mg-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {isMe && (
        <div className="mg-visibility" role="radiogroup" aria-label="Who can see your games">
          <span>Who sees this</span>
          <span className="mg-segment">
            {MY_GAMES_VISIBILITY.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={visibility === v.id}
                onClick={async () => {
                  const r = await api.setGamesVisibility(v.id)
                  if (r.ok) setVisibility(r.data.visibility)
                  else setProblem(r.message)
                }}
              >
                {v.name}
              </button>
            ))}
          </span>
        </div>
      )}
      {problem && <p className="mg-note mg-note--problem">{problem}</p>}
      {games === null && !problem && <p className="mg-note">Loading…</p>}
      {games !== null && !shared && (
        <p className="mg-note">
          {first} keeps their games{' '}
          {visibility === 'only_me' ? 'to themselves' : 'for friends only'}.
        </p>
      )}
      {games !== null && shared && games.length === 0 && (
        <EmptyScene
          kind="games"
          layout="small"
          title="No games yet"
          text={
            isMe
              ? 'When Glofly sees you playing something (Settings → General → Show what I’m playing), its time adds up here.'
              : `${first} hasn't played anything Glofly has seen yet.`
          }
        />
      )}
      {favorites.length > 0 && (
        <>
          <h4 className="mg-sub">Favorites</h4>
          <ul className="mg-list">{favorites.map(row)}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          {favorites.length > 0 && <h4 className="mg-sub">Most played</h4>}
          <ul className="mg-list">{rest.map(row)}</ul>
        </>
      )}
      {games?.some((g) => g.cover) && (
        <a className="mg-credit" href={IGDB_URL} target="_blank" rel="noreferrer">
          {IGDB_CREDIT}
        </a>
      )}
    </aside>
  )
}

// 0.11.4 "See what you're playing" (approved canvas "Glofly: See what you're playing"): your own
// game in your name panel, exactly as friends see it. Click it for a card with what friends see,
// the "Show what I'm playing" switch, a way to fix a wrong game, and My games.
//
// Where the game comes from:
// - this Windows computer (it looks for games itself; with sharing off you still see it, as "Only you")
// - otherwise what the server says friends see (another computer, or Steam), from GET /users/me/status
import { useEffect, useRef, useState } from 'react'
import { gameKey, type Activity, type MyStatus } from '@glofly/shared'
import { activityLine } from '../lib/presence'
import { api as cx } from '../lib/constellations'
import { sendErrorReport } from '../lib/errorReports'
import { GameArt } from './ProfileBoard'
import { GameIcon } from './icons'
import type { GameState } from '../../../preload/api-types'
import './MyGame.css'

export type MyGameInfo = {
  name: string
  since: string
  /** Friends see it (false: "Only you") */
  shared: boolean
  /** Where it was found */
  from: 'here' | 'steam' | 'elsewhere'
  /** The program that matched on this computer (to fix a wrong game) */
  exe: string | null
  /** This computer's own setting (Windows) */
  local: boolean
}

/** Your game right now, from this computer first, then from what friends see. */
export function useMyGame(myStatus: MyStatus): MyGameInfo | null {
  const [games, setGames] = useState<GameState | null>(null)
  useEffect(() => {
    let alive = true
    void window.glofly.games.state().then((s) => alive && setGames(s))
    const stop = window.glofly.games.onChange(setGames)
    return () => {
      alive = false
      stop()
    }
  }, [])
  const seen: Activity | null = myStatus.activity ?? null
  if (games?.supported && games.detected) {
    const shared = games.enabled
    return {
      name: games.detected,
      since: (shared && seen?.name === games.detected ? seen.since : games.since) ?? new Date().toISOString(),
      shared,
      from: 'here',
      exe: games.exe ?? null,
      local: true
    }
  }
  if (!seen) return null
  return { name: seen.name, since: seen.since, shared: true, from: myStatus.activityFromSteam ? 'steam' : 'elsewhere', exe: null, local: false }
}

/** The box art from My games (it's counted there once it's been shared); null = letter tile. */
function useCover(name: string | null): string | null {
  const [cover, setCover] = useState<{ name: string; id: string | null } | null>(null)
  useEffect(() => {
    if (!name) return
    let alive = true
    void cx.myGames().then((r) => {
      if (!alive || !r.ok) return
      const key = gameKey(name)
      setCover({ name, id: r.data.games.find((g) => g.key === key)?.cover ?? null })
    })
    return () => {
      alive = false
    }
  }, [name])
  return cover && cover.name === name ? cover.id : null
}

/** A minute-by-minute clock for "1h 12m" (only while a game shows). */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [on])
  return now
}

/** The game's box art next to your name (only while friends can see the game). */
export function MyGameCover({ game }: { game: MyGameInfo }): React.JSX.Element | null {
  const cover = useCover(game.name)
  return game.shared ? <GameArt name={game.name} cover={cover} className="mygame-cover" /> : null
}

/** The line under your name; a button that opens the card. */
export function MyGameLine({
  game,
  meName,
  meUsername,
  avatar,
  onMyGames
}: {
  game: MyGameInfo
  meName: string
  meUsername: string
  /** Your avatar, small, for the "what friends see" row */
  avatar: React.ReactNode
  onMyGames: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const now = useNow(true)
  const cover = useCover(game.name)
  const line = activityLine({ name: game.name, since: game.since }, now)
  return (
    <>
      <button
        type="button"
        className={game.shared ? 'mygame-line' : 'mygame-line mygame-line--private'}
        aria-expanded={open}
        aria-label={game.shared ? `What friends see: ${line}` : `Only you see this: Playing ${game.name}`}
        title={game.shared ? line : `Only you see this · Playing ${game.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {game.shared ? <GameIcon size={14} /> : <EyeOffIcon />}
        <span>{game.shared ? line : `Only you · Playing ${game.name}`}</span>
      </button>
      {open && (
        <MyGameCard
          game={game}
          line={line}
          cover={cover}
          meName={meName}
          meUsername={meUsername}
          avatar={avatar}
          onMyGames={() => {
            setOpen(false)
            onMyGames()
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function MyGameCard({
  game,
  line,
  cover,
  meName,
  meUsername,
  avatar,
  onMyGames,
  onClose
}: {
  game: MyGameInfo
  line: string
  cover: string | null
  meName: string
  meUsername: string
  avatar: React.ReactNode
  onMyGames: () => void
  onClose: () => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const [fixing, setFixing] = useState(false)
  const [right, setRight] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    box.current?.querySelector<HTMLElement>('input, button')?.focus()
    const away = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])

  const where =
    game.from === 'here' ? 'found on this computer' : game.from === 'steam' ? 'from Steam' : 'from your other computer'

  // This computer's own setting, or (for a game from another computer) a request to it.
  const setSharing = async (change: { share?: boolean; hide?: string }): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      if (game.local) {
        if (change.share !== undefined) await window.glofly.games.setEnabled(change.share)
        if (change.hide) await window.glofly.games.hide(change.hide, true)
        if (change.hide) onClose()
        return
      }
      const r = await window.glofly.status.activitySharing(change)
      if (!r.ok) setNote(r.message)
      else if (change.hide) onClose()
      else setNote('Sent to your computer. It changes in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const fix = async (): Promise<void> => {
    const name = right.trim()
    if (!name) return
    setBusy(true)
    // Fixed on this computer at once (your own name for that program) ...
    if (game.exe) await window.glofly.games.add(game.exe, name)
    // ... and reported, so Glofly's game list gets it right for everyone.
    sendErrorReport(new Error(`Wrong game: found "${game.name}" (${game.exe ?? game.from}), really "${name}"`), 'game detection')
    setBusy(false)
    setFixing(false)
    setNote(game.exe ? `Thanks! This computer will call it ${name} from now on.` : 'Thanks! We’ll look into it.')
  }

  return (
    <div ref={box} className="mygame-card" role="dialog" aria-label="What friends see">
      <div className="mygame-card-head">
        <GameArt name={game.name} cover={cover} className="mygame-card-cover" />
        <div className="mygame-card-title">
          <strong>{game.name}</strong>
          <span>
            {line.replace(/^Playing [^·]*· /, 'Playing for ')} · {where}
          </span>
          {cover && <span className="mygame-igdb">Game info by IGDB</span>}
        </div>
      </div>

      <div className="mygame-card-label">What friends see</div>
      <div className="mygame-preview">
        {avatar}
        <span className="mygame-preview-text">
          <span>
            <b>{meName}</b> <span className="mygame-faint">@{meUsername}</span>
          </span>
          <span className="mygame-faint">{game.shared ? line : 'Your normal status (not the game)'}</span>
        </span>
      </div>

      {game.from === 'steam' ? (
        <p className="mygame-hint">This comes from your linked Steam account. Change it in Settings → Connections.</p>
      ) : (
        <label className="mygame-switch">
          <span>Show what I’m playing</span>
          <input
            type="checkbox"
            checked={game.shared}
            disabled={busy}
            onChange={(e) => void setSharing({ share: e.target.checked })}
          />
        </label>
      )}

      {note && (
        <p className="mygame-note" role="status">
          {note}
        </p>
      )}

      <div className="mygame-links">
        {fixing ? (
          <form
            className="mygame-fix"
            onSubmit={(e) => {
              e.preventDefault()
              void fix()
            }}
          >
            <label htmlFor="mygame-right">What are you really playing?</label>
            <div>
              <input
                id="mygame-right"
                value={right}
                maxLength={64}
                placeholder="Game name"
                onChange={(e) => setRight(e.target.value)}
              />
              <button type="submit" className="button button--primary" disabled={busy || !right.trim()}>
                Send
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="mygame-link" onClick={() => setFixing(true)}>
            Not {game.name}? Tell us the right game
          </button>
        )}
        {game.from !== 'steam' && (
          <button type="button" className="mygame-link" disabled={busy} onClick={() => void setSharing({ hide: game.name })}>
            Don’t show this game
          </button>
        )}
        <button type="button" className="mygame-link" onClick={onMyGames}>
          Open My games
        </button>
      </div>
    </div>
  )
}

function EyeOffIcon(): React.JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.6M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1.1" />
    </svg>
  )
}

import { useEffect, useState } from 'react'
import type { GameState } from '../../../preload/api-types'
import { GameIcon } from './icons'

/**
 * The one-time note the first time Glofly shares a game: "Your friends can now see you're
 * playing Guild Wars 2", with a shortcut to Settings to turn it off.
 */
export default function GameNotice({
  onOpenSettings
}: {
  onOpenSettings: () => void
}): React.JSX.Element | null {
  const [game, setGame] = useState<string | null>(null)

  useEffect(() => {
    const consider = (s: GameState | null): void => {
      if (!s || s.noticeShown || !s.current) return
      setGame(s.current)
      window.glofly.games.noticeShown() // shown once, ever, on this computer
    }
    void window.glofly.games.state().then(consider)
    return window.glofly.games.onChange(consider)
  }, [])

  useEffect(() => {
    if (!game) return
    const timer = setTimeout(() => setGame(null), 15_000)
    return () => clearTimeout(timer)
  }, [game])

  if (!game) return null
  return (
    <div className="call-toast game-notice" role="status">
      <GameIcon size={18} />
      <span>
        Your friends can now see you&apos;re playing <strong>{game}</strong>.
      </span>
      <button
        type="button"
        className="game-notice-settings"
        onClick={() => {
          setGame(null)
          onOpenSettings()
        }}
      >
        Settings
      </button>
      <button type="button" aria-label="Dismiss" onClick={() => setGame(null)}>
        ×
      </button>
    </div>
  )
}

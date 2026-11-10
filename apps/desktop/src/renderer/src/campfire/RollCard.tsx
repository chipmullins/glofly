import type { ChatRoll } from '@glofly/shared/campfire/types'
import './RollCard.css'

// Campfire's /roll in any chat (Start board, "In the nebula's chat"): the server rolls it and
// saves an optional `roll` on the message; its body is the plain text older apps show. A message
// with a roll that doesn't look right falls back to that text.

export function ChatRollCard({
  roll,
  fallback
}: {
  roll: ChatRoll
  fallback: string
}): React.JSX.Element {
  const d20 = roll.dice.find((d) => d.kept && (d.crit || d.fumble))
  // "1d20+3 → (14) + 3 = 17": the math part, without repeating the total.
  const math = roll.breakdown.replace(/\s*=\s*-?\d+\s*$/, '')
  return (
    <div
      className={`chat-roll${d20?.crit ? ' chat-roll--crit' : d20?.fumble ? ' chat-roll--fumble' : ''}`}
      role="group"
      aria-label={fallback}
    >
      <span className="chat-roll-die" aria-hidden="true">
        {roll.total}
      </span>
      <span className="chat-roll-text">
        <strong>{roll.label || (d20?.crit ? 'Natural 20!' : `Rolled ${roll.expression}`)}</strong>
        <span className="chat-roll-math">{math}</span>
      </span>
    </div>
  )
}

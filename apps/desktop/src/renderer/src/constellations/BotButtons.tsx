import { useState } from 'react'
import type { MessageButton } from '@glofly/shared'
import { integrations } from '../lib/integrations'

// Communities round (Nov 2026): buttons under a bot's message (approved mockup board 4). A click
// only tells the bot (with my roles); what happens next is the bot's decision, and anything it
// does through Glofly is checked again on the server.
export default function BotButtons({
  constellationId,
  messageId,
  buttons,
  onProblem
}: {
  constellationId: string
  messageId: string
  buttons: MessageButton[]
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  return (
    <div className="cx-bot-buttons" role="group" aria-label="Bot buttons">
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={`cx-bot-button cx-bot-button--${b.style}`}
          disabled={busy !== null}
          aria-busy={busy === b.id}
          onClick={() => {
            setBusy(b.id)
            void integrations.clickButton(constellationId, messageId, b.id).then((r) => {
              setBusy(null)
              if (!r.ok) onProblem(r.message)
              else if (!r.data.delivered) onProblem("The bot didn't answer. Try again in a moment.")
              else {
                setSent(b.id)
                setTimeout(() => setSent((x) => (x === b.id ? null : x)), 1500)
              }
            })
          }}
        >
          {sent === b.id ? 'Sent ✓' : b.label}
        </button>
      ))}
    </div>
  )
}

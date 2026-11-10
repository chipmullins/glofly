import type { ChatRoll } from '@glofly/shared/campfire/types'

// Campfire's /roll in chats: the optional `roll` field on a message, checked.

/** The message's roll, if it has a usable one. */
export function rollOf(m: object): ChatRoll | null {
  const r = (m as { roll?: unknown }).roll as Partial<ChatRoll> | null | undefined
  if (!r || typeof r !== 'object') return null
  if (
    typeof r.total !== 'number' ||
    typeof r.expression !== 'string' ||
    typeof r.breakdown !== 'string'
  )
    return null
  return {
    expression: r.expression.slice(0, 200),
    label: typeof r.label === 'string' ? r.label.slice(0, 100) : null,
    total: r.total,
    breakdown: r.breakdown.slice(0, 400),
    dice: Array.isArray(r.dice) ? r.dice.slice(0, 100) : []
  }
}

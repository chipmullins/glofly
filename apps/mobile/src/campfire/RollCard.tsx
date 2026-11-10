import { View } from 'react-native'
import type { ChatRoll, Message } from '@glofly/shared'
import { Text } from '@/ui/kit'
import { DieFace } from './ui'
import { useFire } from './lib'

// `/roll` in any chat (Start board): the server rolls it and the message carries an optional
// `roll` field; this card shows it. Messages without it (or older servers) show their body text.

export const chatRollOf = (m: Message): ChatRoll | null => {
  const r = (m as Message & { roll?: unknown }).roll as ChatRoll | undefined
  return r && typeof r.total === 'number' && typeof r.expression === 'string' ? r : null
}

export function RollCard({ roll }: { roll: ChatRoll }) {
  const fire = useFire()
  const crit = roll.dice.some((d) => d.crit && d.kept)
  const fumble = !crit && roll.dice.some((d) => d.fumble && d.kept)
  const title = roll.label?.trim() || (crit ? 'Natural 20!' : fumble ? 'Natural 1' : `Rolled ${roll.expression}`)
  // "1d20+3 → (14) + 3 = 17" → "1d20+3 → 14 + 3", like the board (the total is on the die)
  const math = roll.breakdown.replace(/\s*=\s*-?\d+\s*$/, '').replace(/[()]/g, '')
  return (
    <View
      accessible
      accessibilityLabel={`${title}: rolled ${roll.expression}, total ${roll.total}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: fire.card, boxShadow: '0 0 0 1px rgba(255,179,71,0.35)', maxWidth: 300 }}
    >
      <DieFace value={roll.total} size={44} />
      <View style={{ flexShrink: 1, gap: 2 }}>
        <Text size={14} weight="bold" numberOfLines={2} style={{ color: crit ? fire.spell : fire.ink }}>
          {title}
        </Text>
        <Text size={12} numberOfLines={2} style={{ color: fire.muted, fontFamily: 'monospace' }}>
          {math}
        </Text>
      </View>
    </View>
  )
}

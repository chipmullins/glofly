import { View } from 'react-native'
import { attachmentSummary, type Message } from '@glofly/shared'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// Photos, files and voice messages in a bubble (simple summary for now; full view next step).
export function Attachments({ message, mine }: { message: Message; mine: boolean; onOpenPhoto: (i: number) => void; onLongPress: () => void }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 6 }}>
      <Icon name="attach" size={18} color={mine ? c.meInk : c.ink2} />
      <Text size={14} style={{ color: mine ? c.meInk : c.ink }}>{attachmentSummary(message.attachments)}</Text>
    </View>
  )
}

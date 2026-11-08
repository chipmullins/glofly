import { View } from 'react-native'
import { Text } from './kit'

/** 0.9.3: the red LIVE label (a friend live on Twitch or Kick). */
export function LivePill({ label = 'LIVE' }: { label?: string }) {
  return (
    <View accessibilityLabel="Live" style={{ flexShrink: 0, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: '#c42b1c' }}>
      <Text size={10} weight="bold" style={{ color: '#ffffff', letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  )
}

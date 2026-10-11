import { View } from 'react-native'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// Placeholder (built in the friends/settings step).
export default function Friends() {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      <Text display size={24}>Friends</Text>
    </View>
  )
}

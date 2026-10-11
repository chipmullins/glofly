import { View } from 'react-native'
import { Image } from 'expo-image'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'

// Placeholder start screen (replaced by sign-in in the next step).
export default function Start() {
  const { c } = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: c.bg }}>
      <Image source={require('../../assets/firefly.png')} style={{ width: 96, height: 71 }} contentFit="contain" />
      <Text display size={28}>
        Glofly
      </Text>
    </View>
  )
}

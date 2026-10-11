import { Pressable, View } from 'react-native'
import { router } from 'expo-router'
import { openDmWith } from '@/lib/chatActions'
import { FriendPicker } from '@/ui/FriendPicker'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { useTheme } from '@/ui/theme'

export default function NewChat() {
  const { c } = useTheme()
  return (
    <Screen title="New chat" scroll={false}>
      <FriendPicker
        multi={false}
        selected={[]}
        onToggle={(f) => {
          router.back()
          void openDmWith(f.id)
        }}
        header={
          <Pressable accessibilityRole="button" onPress={() => router.replace('/new-group')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="groups" size={22} color={c.accentText} />
            </View>
            <Text size={16} weight="bold">
              New group
            </Text>
          </Pressable>
        }
      />
    </Screen>
  )
}

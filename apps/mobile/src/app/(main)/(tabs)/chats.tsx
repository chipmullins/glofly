import { View } from 'react-native'
import { Button, Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { useSession } from '@/state/session'
import { logout } from '@/api/auth'

// Placeholder (the chats list comes next).
export default function Chats() {
  const { c } = useTheme()
  const user = useSession((s) => s.user)
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: c.bg }}>
      <Text display size={24}>Signed in as {user?.displayName}</Text>
      <Button label="Log out" kind="secondary" onPress={() => void logout()} />
    </View>
  )
}

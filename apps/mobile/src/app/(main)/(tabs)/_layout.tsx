import { Tabs } from 'expo-router'
import { TabBar } from '@/ui/TabBar'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, animation: 'shift' }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="groups" options={{ title: 'Groups' }} />
      <Tabs.Screen name="friends" options={{ title: 'Friends' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  )
}

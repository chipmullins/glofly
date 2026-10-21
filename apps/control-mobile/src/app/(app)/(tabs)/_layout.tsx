import { Tabs } from 'expo-router'
import { TabBar } from '@/ui/TabBar'
import { c } from '@/ui/theme'

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, animation: 'none', sceneStyle: { backgroundColor: c.page } }} tabBar={(props) => <TabBar {...props} />}>
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
      <Tabs.Screen name="accounts" options={{ title: 'Accounts' }} />
      <Tabs.Screen name="constellations" options={{ title: 'Constellations' }} />
      <Tabs.Screen name="server" options={{ title: 'Server' }} />
    </Tabs>
  )
}

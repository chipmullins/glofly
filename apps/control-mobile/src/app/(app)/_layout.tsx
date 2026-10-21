import { Stack } from 'expo-router'
import { c } from '@/ui/theme'

// Signed in: the tabs, and pages pushed over them.
export default function AppLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.page }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="message/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  )
}

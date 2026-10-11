import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { startRealtime } from '@/api/realtime'

export default function MainLayout() {
  const { c } = useTheme()
  useEffect(() => {
    startRealtime()
  }, [])
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="profile/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack>
  )
}

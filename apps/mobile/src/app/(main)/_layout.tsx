import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { startRealtime } from '@/api/realtime'
import { startPush } from '@/push'

// Everything after signing in: the live connection and push notifications start here.

export default function MainLayout() {
  const { c } = useTheme()
  useEffect(() => {
    startRealtime()
    startPush()
  }, [])
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[id]" />
      <Stack.Screen name="profile/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
    </Stack>
  )
}

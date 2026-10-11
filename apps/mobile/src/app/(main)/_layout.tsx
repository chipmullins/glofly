import { useEffect } from 'react'
import { Stack } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { startRealtime } from '@/api/realtime'
import { startPush } from '@/push'
import { startCalls } from '@/calls/controller'
import { CallOverlay, WithCallStrip } from '@/calls/CallOverlay'
import { TeamNotice } from '@/ui/TeamNotice'

// Everything after signing in: the live connection, push notifications and calls start here.

export default function MainLayout() {
  const { c } = useTheme()
  useEffect(() => {
    startRealtime()
    startPush()
    startCalls()
  }, [])
  return (
    <>
      <WithCallStrip>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="profile/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
          <Stack.Screen name="call" options={{ animation: 'fade', contentStyle: { backgroundColor: '#120D0B' } }} />
        </Stack>
      </WithCallStrip>
      <CallOverlay />
      <TeamNotice />
    </>
  )
}

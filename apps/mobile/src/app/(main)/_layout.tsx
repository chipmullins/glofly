import { useEffect } from 'react'
import { View } from 'react-native'
import { Stack, usePathname } from 'expo-router'
import { useTheme } from '@/ui/theme'
import { startRealtime } from '@/api/realtime'
import { startPush } from '@/push'
import { startCalls } from '@/calls/controller'
import { startWatch } from '@/calls/watch'
import { startUpdates } from '@/lib/updates'
import { CallOverlay, WithCallStrip } from '@/calls/CallOverlay'
import { CallPip } from '@/calls/CallPip'
import { TeamNotice } from '@/ui/TeamNotice'
import { FriendAlert } from '@/ui/FriendAlert'
import '@/state/social'
import { LeftPane } from '@/ui/TwoPane'
import { useWide } from '@/lib/layout'

// Everything after signing in: the live connection, push notifications and calls start here.

export default function MainLayout() {
  const { c } = useTheme()
  // iPad (0.4.0): two panes on a wide screen (see lib/layout.ts). The Stack keeps the same place
  // in the tree either way, so turning the iPad or resizing it in Split View never loses where
  // you were. A call takes the whole screen.
  const wide = useWide()
  const path = usePathname()
  useEffect(() => {
    startRealtime()
    startPush()
    startCalls()
    startWatch()
    startUpdates()
  }, [])
  return (
    <>
      <WithCallStrip>
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
          {wide ? <LeftPane hidden={path === '/call'} /> : null}
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: wide ? 'fade' : 'slide_from_right' }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[id]" options={wide ? { animation: 'none' } : undefined} />
              <Stack.Screen name="profile/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="call" options={{ animation: 'fade', contentStyle: { backgroundColor: '#120D0B' } }} />
              <Stack.Screen name="live/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: '#120D0B' } }} />
              <Stack.Screen name="year" options={{ animation: 'fade', contentStyle: { backgroundColor: '#1A1030' } }} />
            </Stack>
          </View>
        </View>
      </WithCallStrip>
      <CallOverlay />
      <FriendAlert />
      <TeamNotice />
      {/* Last, so the floating call window covers everything. */}
      <CallPip />
    </>
  )
}

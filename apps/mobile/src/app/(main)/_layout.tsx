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
import Animated from 'react-native-reanimated'
import { startConstellations } from '@/state/constellations'
import { watchReduceMotion } from '@/constellations/motion'
import { NightOverlay, useHomeAwayStyle } from '@/constellations/transition'
import { HomeDock } from '@/constellations/HomeDock'
import { InvitePopup } from '@/constellations/InvitePopup'
import { WelcomeFlowHost } from '@/ui/WelcomeFlow'
import { startQuietHours } from '@/state/quiet'
import { startKeyCommands } from '@/lib/keys'
import { KeyShortcuts } from '@/ui/KeyShortcuts'

// Everything after signing in: the live connection, push notifications and calls start here.

export default function MainLayout() {
  const { c } = useTheme()
  // iPad (0.4.0): two panes on a wide screen (see lib/layout.ts). The Stack keeps the same place
  // in the tree either way, so turning the iPad or resizing it in Split View never loses where
  // you were. A call takes the whole screen.
  const wide = useWide()
  const path = usePathname()
  // Glofly 2.0: the night side (Constellations) takes the whole screen, on iPad too.
  const night = path === '/constellations' || path.startsWith('/constellations/')
  const homeAway = useHomeAwayStyle()
  useEffect(() => {
    watchReduceMotion()
    startConstellations()
    startRealtime()
    startPush()
    startCalls()
    startWatch()
    startUpdates()
    startQuietHours()
    startKeyCommands()
  }, [])
  return (
    <>
      <WithCallStrip>
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: c.bg }}>
          {wide ? (
            <Animated.View style={[{ display: path === '/call' || night ? 'none' : 'flex' }, homeAway]}>
              <LeftPane />
            </Animated.View>
          ) : null}
          <View style={{ flex: 1 }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: wide ? 'fade' : 'slide_from_right' }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="chat/[id]" options={wide ? { animation: 'none' } : undefined} />
              <Stack.Screen name="profile/[id]" options={{ presentation: 'transparentModal', animation: 'slide_from_bottom', contentStyle: { backgroundColor: 'transparent' } }} />
              <Stack.Screen name="call" options={{ animation: 'fade', contentStyle: { backgroundColor: '#120D0B' } }} />
              <Stack.Screen name="live/[id]" options={{ animation: 'fade', contentStyle: { backgroundColor: '#120D0B' } }} />
              <Stack.Screen name="year" options={{ animation: 'fade', contentStyle: { backgroundColor: '#1A1030' } }} />
              {/* 0.8.0: "Send to…" for things shared from other apps */}
              <Stack.Screen name="share" options={{ presentation: wide ? 'formSheet' : 'modal', animation: 'slide_from_bottom' }} />
              {/* Glofly 2.0: over Glofly home (which stays drawn underneath for the trip back). */}
              <Stack.Screen name="constellations" options={{ presentation: 'transparentModal', animation: 'none', gestureEnabled: false, contentStyle: { backgroundColor: 'transparent' } }} />
            </Stack>
          </View>
        </View>
      </WithCallStrip>
      <HomeDock />
      <NightOverlay />
      <CallOverlay />
      <FriendAlert />
      <InvitePopup />
      {/* 0.7.5: a brand-new account's three welcome steps, over everything but calls */}
      <WelcomeFlowHost />
      <TeamNotice />
      {/* 0.8.0: keyboard shortcuts (iPad, tablets) and the shortcut sheet */}
      <KeyShortcuts />
      {/* Last, so the floating call window covers everything. */}
      <CallPip />
    </>
  )
}

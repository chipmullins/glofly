import { useEffect } from 'react'
import { BackHandler, Platform, View } from 'react-native'
import { Stack, useNavigation, usePathname } from 'expo-router'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ThemeOverride } from '@/ui/theme'
import { Text } from '@/ui/kit'
import { useWide } from '@/lib/layout'
import { refreshCards, refreshMentionCount, refreshPins, useCx } from '@/state/constellations'
import { flyHome, nightGone, nightMounted, registerNightExit, useNight, useNightAwayStyle } from '@/constellations/transition'
import { DmDock, startPeeks } from '@/constellations/dock'
import { ContextMenuHost } from '@/constellations/ContextMenu'
import { NebulaSheetHost } from '@/constellations/nebulaActions'
import { MemberSheetHost } from '@/constellations/Members'
import { AskTextHost } from '@/constellations/ask'
import { N } from '@/constellations/ui'

// Glofly 2.0 on phones: the night side. Everything inside is drawn in the night colors (dark in
// every theme). The main stack shows it over Glofly home (transparent), so the trip home can slide
// the night away and bring Chats back underneath (constellations/transition.tsx).

export const unstable_settings = { initialRouteName: 'index' }

export default function NightLayout() {
  const navigation = useNavigation()
  const wide = useWide()
  const path = usePathname()
  const away = useNightAwayStyle()

  useEffect(() => {
    registerNightExit(() => {
      if (navigation.canGoBack()) navigation.goBack()
    })
    useCx.setState({ front: true })
    startPeeks()
    void refreshCards()
    void refreshPins()
    void refreshMentionCount()
    return () => {
      registerNightExit(null)
      useCx.setState({ front: false, viewing: null })
      if (useNight.getState().phase !== 'out') nightGone()
    }
  }, [navigation])

  // Android's back button on the dashboard flies home (deeper pages go back as usual).
  useEffect(() => {
    if (Platform.OS === 'web') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (path === '/constellations') {
        flyHome()
        return true
      }
      return false
    })
    return () => sub.remove()
  }, [path])

  return (
    <ThemeOverride mode="night">
      <Animated.View style={[{ flex: 1, backgroundColor: N.bg }, away]} onLayout={nightMounted}>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: N.bg },
            animation: wide ? 'fade' : 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" options={{ animation: 'none' }} />
          <Stack.Screen name="mentions" options={{ animation: 'none' }} />
          <Stack.Screen name="you" options={{ animation: 'none' }} />
          <Stack.Screen name="voice" options={{ animation: wide ? 'fade' : 'slide_from_bottom' }} />
          <Stack.Screen name="[cid]/index" options={{ animation: wide ? 'fade' : 'slide_from_right' }} />
        </Stack>
        <DmDock />
        <NebulaSheetHost />
        <MemberSheetHost />
        <AskTextHost />
        <ContextMenuHost />
        <NightToast />
      </Animated.View>
    </ThemeOverride>
  )
}

function NightToast() {
  const toast = useCx((s) => s.toast)
  const insets = useSafeAreaInsets()
  if (!toast) return null
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', left: 24, right: 24, bottom: insets.bottom + 110, alignItems: 'center', zIndex: 60 }}>
      <View style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22, backgroundColor: N.raised, borderWidth: 1, borderColor: N.edge, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
        <Text size={14} weight="medium" style={{ color: N.ink, textAlign: 'center' }}>
          {toast}
        </Text>
      </View>
    </Animated.View>
  )
}

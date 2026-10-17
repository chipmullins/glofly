import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans'
import { Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit'
import * as SystemUI from 'expo-system-ui'
import { useTheme, useThemeChoice, type AccentChoice, type ThemeChoice } from '@/ui/theme'
import { DialogHost } from '@/ui/dialogs'
import { PhotoCropperHost } from '@/ui/PhotoCropper'
import { SheetHost } from '@/ui/sheets'
import { UpdateRequired } from '@/ui/UpdateRequired'
import { Paused } from '@/ui/Paused'
import { restoreSession, useSession } from '@/state/session'
import { prefs } from '@/lib/storage'
import { loadPhonePrefs } from '@/state/prefs'
import { setupWebRTC } from '@/calls/media'
import { lockPortrait } from '@/lib/orientation'

// LiveKit needs WebRTC's globals before anything uses it.
setupWebRTC()

void SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  })
  const status = useSession((s) => s.status)
  const { c, dark } = useTheme()

  useEffect(() => {
    lockPortrait() // only the call screen turns sideways
    void prefs.get<ThemeChoice>('theme', 'system').then((t) => useThemeChoice.getState().set(t))
    void prefs.get<AccentChoice>('accent', 'orange').then((a) => useThemeChoice.getState().setAccent(a))
    void loadPhonePrefs()
    void restoreSession()
  }, [])

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(c.bg).catch(() => {})
  }, [c.bg])

  // A font that fails to load falls back to the system font instead of keeping the splash
  // screen up for good.
  const fontsReady = fontsLoaded || !!fontError
  const ready = fontsReady && status !== 'starting'
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null
  const signedIn = status === 'signedIn'
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bg }}>
      <SafeAreaProvider>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(main)" />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
        <SheetHost />
        <DialogHost />
        <PhotoCropperHost />
        <Paused />
        <UpdateRequired />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

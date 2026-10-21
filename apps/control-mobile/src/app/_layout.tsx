import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { useFonts } from 'expo-font'
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans'
import { Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit'
import { startSession, useSession } from '@/state/session'
import { startAlerts } from '@/lib/alerts'
import { startUpdates } from '@/lib/updates'
import { installPreview } from '@/lib/preview'
import { SheetHost } from '@/ui/ConfirmSheet'
import { ToastHost } from '@/ui/toast'
import { c } from '@/ui/theme'

void SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  })
  const phase = useSession((s) => s.phase)

  useEffect(() => {
    if (!installPreview()) void startSession()
    startAlerts()
    startUpdates()
  }, [])

  const ready = (fontsLoaded || !!fontError) && phase !== 'starting'
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => {})
  }, [ready])
  if (!ready) return null

  const inApp = phase === 'app'
  return (
    <SafeAreaProvider>
      <StatusBar style={inApp ? 'auto' : 'light'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.page }, animation: 'slide_from_right' }}>
        <Stack.Protected guard={inApp}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'signin'}>
          <Stack.Screen name="signin" options={{ contentStyle: { backgroundColor: c.violetDeep }, animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={phase === 'approve'}>
          <Stack.Screen name="approve" options={{ contentStyle: { backgroundColor: c.violetDeep }, animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
      <SheetHost />
      <ToastHost />
    </SafeAreaProvider>
  )
}

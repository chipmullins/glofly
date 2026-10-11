import { Stack } from 'expo-router'
import { useTheme } from '@/ui/theme'

export default function MainLayout() {
  const { c } = useTheme()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg }, animation: 'slide_from_right' }} />
}

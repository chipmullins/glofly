import type { ReactNode } from 'react'
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconButton, Text } from './kit'
import { useTheme } from './theme'

/** A pushed screen with the Android top bar: back arrow, title, optional actions on the right. */
export function Screen({
  title,
  right,
  children,
  scroll = true,
  contentStyle,
  onBack,
}: {
  title: string
  right?: ReactNode
  children: ReactNode
  scroll?: boolean
  contentStyle?: StyleProp<ViewStyle>
  onBack?: () => void
}) {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/chats')))
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ paddingTop: insets.top, backgroundColor: c.bg }}>
        <View style={{ height: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, gap: 4 }}>
          <IconButton name="back" label="Back" onPress={back} color={c.ink} size={24} />
          <Text display size={22} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
            {title}
          </Text>
          {right}
        </View>
      </View>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[{ paddingBottom: insets.bottom + 24 }, contentStyle]}>
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1, paddingBottom: insets.bottom }, contentStyle]}>{children}</View>
      )}
    </View>
  )
}

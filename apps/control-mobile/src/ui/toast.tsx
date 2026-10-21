import { useEffect } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { Text } from './kit'
import { c } from './theme'
import { Icon } from './icons'

// One short line at the top after an action ("Report dismissed."). VoiceOver reads it out.

type ToastState = { text: string | null; tone: 'good' | 'bad'; key: number; show: (text: string, tone?: 'good' | 'bad') => void; hide: () => void }

export const useToast = create<ToastState>((set) => ({
  text: null,
  tone: 'good',
  key: 0,
  show: (text, tone = 'good') => set((s) => ({ text, tone, key: s.key + 1 })),
  hide: () => set({ text: null }),
}))

export const toast = (text: string, tone: 'good' | 'bad' = 'good') => useToast.getState().show(text, tone)

export function ToastHost() {
  const { text, tone, key, hide } = useToast()
  const insets = useSafeAreaInsets()
  useEffect(() => {
    if (!text) return
    const t = setTimeout(hide, tone === 'bad' ? 5000 : 3000)
    return () => clearTimeout(t)
  }, [key, text, tone, hide])
  if (!text) return null
  return (
    <View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 16,
        right: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: 14,
        backgroundColor: tone === 'good' ? c.violet : c.dangerText,
        shadowColor: '#150d2e',
        shadowOpacity: 0.25,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
      }}
    >
      <Icon name={tone === 'good' ? 'check' : 'warning'} size={18} color={tone === 'good' ? c.onlineBright : c.white} />
      <Text size={14} weight="semi" color={c.white} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  )
}

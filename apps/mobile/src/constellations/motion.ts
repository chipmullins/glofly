import { AccessibilityInfo, Platform } from 'react-native'
import * as Haptics from 'expo-haptics'
import { create } from 'zustand'

// Reduce Motion (iOS Settings → Accessibility → Motion; Android "Remove animations"): the
// Constellations transitions become instant and the sky stands still, like the approved mockup.

export const useReduceMotion = create<{ on: boolean }>(() => ({ on: false }))

let started = false
export function watchReduceMotion() {
  if (started) return
  started = true
  void AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => useReduceMotion.setState({ on }))
    .catch(() => {})
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => useReduceMotion.setState({ on }))
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    useReduceMotion.setState({ on: mq.matches })
    mq.addEventListener?.('change', (e) => useReduceMotion.setState({ on: e.matches }))
  }
}

export const reduceMotion = () => useReduceMotion.getState().on

/** The haptics the mockups ask for (silently nothing where a phone can't). */
export const haptic = {
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  medium: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  soft: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {}),
  select: () => void Haptics.selectionAsync().catch(() => {}),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
}

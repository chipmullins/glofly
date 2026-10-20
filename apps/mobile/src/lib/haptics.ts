import * as Haptics from 'expo-haptics'

// 0.7.5: small taps that make the app feel physical. A light one when you send, react or hold a
// message; a firmer one when a call connects. They follow the phone's own vibration setting
// (the system skips them when haptics are off), and never throw.

export const tap = {
  light: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  firm: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
}

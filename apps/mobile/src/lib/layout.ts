import { Dimensions, Platform, useWindowDimensions } from 'react-native'
import * as Device from 'expo-device'
import { create } from 'zustand'

// iPad (0.4.0): on a wide screen Glofly shows two panes like the desktop app: the chat list (and
// Friends, Groups, Settings) on the left, the open chat on the right. Narrow windows (a phone,
// or an iPad in Split View / Stage Manager made small) keep the phone layout.

/**
 * From this width (points) up, two panes. 0.8.3: 640 (was 700) so iPhone Duo's inner screen
 * (about 669 points wide upright, 951 sideways) gets two panes both ways; its outer screen and
 * every other iPhone stay one pane, and so does an iPad's half-screen Split View.
 */
export const WIDE_MIN = 640

/** The left pane: a phone-sized column (a little narrower on the smallest two-pane screens). */
export function paneWidth(windowWidth: number): number {
  return Math.round(Math.min(420, Math.max(windowWidth < 720 ? 300 : 320, windowWidth * 0.36)))
}

/** Two panes right now? (Follows the window: rotating, Split View, Stage Manager.) */
export function useWide(): boolean {
  return useWindowDimensions().width >= WIDE_MIN
}

/** The same, outside React (e.g. when a chat is opened from a list). */
export function isWideNow(): boolean {
  return Dimensions.get('window').width >= WIDE_MIN
}

/** An iPad (or Android tablet): may turn sideways everywhere, not just in calls. */
export const isTablet = Platform.OS !== 'web' && Device.deviceType === Device.DeviceType.TABLET

/**
 * 0.8.3: a tablet-sized screen right now: an iPad, or a phone whose current screen is big (iPhone
 * Duo opened, a foldable Android unfolded). Follows folding and unfolding.
 */
export function bigScreenNow(): boolean {
  if (Platform.OS === 'web') return false
  const { width, height } = Dimensions.get('screen')
  return isTablet || Math.min(width, height) >= 600
}

export type PaneTab = 'chats' | 'groups' | 'friends' | 'settings'

/** Which tab the left pane shows (kept when the window narrows into the phone layout and back). */
export const usePaneTab = create<{ tab: PaneTab; set: (tab: PaneTab) => void }>((set) => ({
  tab: 'chats',
  set: (tab) => set({ tab }),
}))

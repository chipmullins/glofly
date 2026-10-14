import { Platform } from 'react-native'
import * as ScreenOrientation from 'expo-screen-orientation'
import { isTablet } from './layout'

// On phones the app stays upright everywhere except the call screen, which can turn sideways for
// a wide video picture (and turning the phone sideways also makes your camera send a wide picture).
// iPads (0.4.0) turn any way, everywhere: two panes side by side suit landscape best.

/** Every screen but calls: upright only (an iPad: any way). */
export function lockPortrait(): void {
  if (Platform.OS === 'web') return
  if (isTablet) {
    void ScreenOrientation.unlockAsync().catch(() => {})
    return
  }
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
}

/** The call screen: follows the phone (upright or sideways; the system default leaves out upside down on phones). */
export function allowRotation(): void {
  if (Platform.OS === 'web') return
  if (isTablet) {
    void ScreenOrientation.unlockAsync().catch(() => {})
    return
  }
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {})
}

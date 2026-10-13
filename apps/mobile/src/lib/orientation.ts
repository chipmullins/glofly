import { Platform } from 'react-native'
import * as ScreenOrientation from 'expo-screen-orientation'

// The app stays upright everywhere except the call screen, which can turn sideways for a wide
// video picture (and turning the phone sideways also makes your camera send a wide picture).

/** Every screen but calls: upright only. */
export function lockPortrait(): void {
  if (Platform.OS === 'web') return
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
}

/** The call screen: follows the phone (upright or sideways; the system default leaves out upside down on phones). */
export function allowRotation(): void {
  if (Platform.OS === 'web') return
  void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT).catch(() => {})
}

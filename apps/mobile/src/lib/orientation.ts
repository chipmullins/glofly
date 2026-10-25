import { Dimensions, Platform } from 'react-native'
import * as ScreenOrientation from 'expo-screen-orientation'
import { bigScreenNow } from './layout'

// On phones the app stays upright everywhere except the call screen, which can turn sideways for
// a wide video picture (and turning the phone sideways also makes your camera send a wide picture).
// iPads (0.4.0) turn any way, everywhere: two panes side by side suit landscape best. 0.8.3: so does
// any big screen, like iPhone Duo opened up; closed, it's a regular iPhone again (followed live).

let mode: 'upright' | 'call' = 'upright'

function apply(): void {
  if (Platform.OS === 'web') return
  if (bigScreenNow()) {
    void ScreenOrientation.unlockAsync().catch(() => {})
    return
  }
  void ScreenOrientation.lockAsync(mode === 'call' ? ScreenOrientation.OrientationLock.DEFAULT : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {})
}

/** Every screen but calls: upright only (a big screen: any way). */
export function lockPortrait(): void {
  mode = 'upright'
  apply()
}

/** The call screen: follows the phone (upright or sideways; the system default leaves out upside down on phones). */
export function allowRotation(): void {
  mode = 'call'
  apply()
}

// Folding or unfolding (iPhone Duo) switches screens: apply the right rule for the new one.
if (Platform.OS !== 'web') {
  let wasBig = bigScreenNow()
  Dimensions.addEventListener('change', () => {
    const big = bigScreenNow()
    if (big !== wasBig) {
      wasBig = big
      apply()
    }
  })
}

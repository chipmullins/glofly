import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import { startErrorReports } from './lib/errorReports'
import OverlayApp from './overlay/OverlayApp'
import { startAppearance } from './lib/appearance'
import { startScrollbars } from './lib/scrollbars'
import { startTitleBarColor } from './lib/titleBar'
import { setSoundSettings } from './lib/sounds'
import { setNotificationSettings } from './lib/notify'

// 0.7.0: the game overlay's window is this same page opened with #overlay (src/main/overlay.ts).
const isOverlay = window.location.hash === '#overlay' && !!window.glofly.overlay
if (isOverlay) document.documentElement.classList.add('overlay')

// On Windows the app draws its own top area (see MainScreen.css and LoginScreen.css).
if (window.glofly.platform === 'win32' && !isOverlay) {
  document.documentElement.classList.add('has-titlebar')
  // …and the window buttons take on whatever color is under them.
  startTitleBarColor()
}
// On a Mac too, with macOS's traffic-light buttons over the top-left corner.
if (window.glofly.platform === 'darwin' && !isOverlay)
  document.documentElement.classList.add('mac-titlebar')

// Light or dark theme and the accent color, set before anything is drawn.
startAppearance()
// Scrollbars only show while scrolling.
startScrollbars()

// Which sounds play (Settings → Notifications & sounds).
void window.glofly.app.getSettings().then((s) => {
  if (!s) return
  setSoundSettings(s.sounds)
  setNotificationSettings(s.notifications)
})

// Files dropped anywhere outside a chat are ignored, never opened by the window.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault())
}

// 0.7.3: anything that breaks is reported (Settings → Privacy → Send error reports).
startErrorReports()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary where={isOverlay ? 'overlay' : 'app'}>
      {isOverlay ? <OverlayApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>
)

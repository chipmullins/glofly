import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { startAppearance } from './lib/appearance'
import { startScrollbars } from './lib/scrollbars'
import { setSoundSettings } from './lib/sounds'
import { setNotificationSettings } from './lib/notify'

// On Windows the app draws its own top area (see MainScreen.css and LoginScreen.css).
if (window.glofly.platform === 'win32') document.documentElement.classList.add('has-titlebar')
// On a Mac too, with macOS's traffic-light buttons over the top-left corner.
if (window.glofly.platform === 'darwin') document.documentElement.classList.add('mac-titlebar')

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

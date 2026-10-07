import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// On Windows the app draws its own top area (see MainScreen.css and LoginScreen.css).
if (window.glofly.platform === 'win32') document.documentElement.classList.add('has-titlebar')

// Files dropped anywhere outside a chat are ignored, never opened by the window.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

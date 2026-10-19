import './assets/control.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// On Windows the app draws its own top strip (the window buttons sit over it).
if (window.control.platform === 'win32') document.documentElement.classList.add('has-titlebar')

// Files dropped on the window are ignored, never opened.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => e.preventDefault())
}

// 0.7.3: Control's own unexpected errors go to the server's error reports (Errors), like the apps'.
window.addEventListener('error', (e) => {
  window.control.reportError({
    message: String(e.message || e.error?.message || 'Error'),
    stack: e.error?.stack,
    where: 'window'
  })
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as { message?: string; stack?: string } | undefined
  window.control.reportError({
    message: String(r?.message ?? r ?? 'Unhandled rejection'),
    stack: r?.stack,
    where: 'promise'
  })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

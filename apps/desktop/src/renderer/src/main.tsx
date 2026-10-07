import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// On Windows the app draws its own top area (see MainScreen.css and LoginScreen.css).
if (window.glofly.platform === 'win32') document.documentElement.classList.add('has-titlebar')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

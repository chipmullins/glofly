import { setIdle } from './realtime'

// Away after 10 minutes of not using Glofly (no mouse, keys or touches in this tab). A browser
// can't see the rest of the computer the way the desktop app does.

const IDLE_AFTER_MS = 10 * 60 * 1000
let lastActive = Date.now()

export function startIdleWatch(): void {
  const active = (): void => {
    lastActive = Date.now()
    setIdle(false)
  }
  for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const) {
    window.addEventListener(type, active, { passive: true, capture: true })
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) active()
  })
  setInterval(() => setIdle(Date.now() - lastActive >= IDLE_AFTER_MS), 30_000)
}

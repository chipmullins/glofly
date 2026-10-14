// Touch screens (iPad): pressing and holding opens Glofly's own menus (the chat list's, a group's,
// a call tile's), which the desktop app opens with a right-click. Safari on iPad never sends a
// right-click for a long press, so one is made here. Text boxes are left alone (holding there
// selects text, as usual).

const HOLD_MS = 500
const MOVE_PX = 10

export function startLongPress(): void {
  if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return
  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number } | null = null
  let fired = false
  let making = false

  const cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  window.addEventListener(
    'touchstart',
    (e) => {
      cancel()
      fired = false
      if (e.touches.length !== 1) return
      const target = e.target as Element | null
      if (!target || target.closest('input, textarea, select, [contenteditable="true"]')) return
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY }
      timer = setTimeout(() => {
        timer = null
        fired = true
        making = true
        target.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: start!.x,
            clientY: start!.y,
            button: 2
          })
        )
        making = false
      }, HOLD_MS)
    },
    { passive: true, capture: true }
  )
  window.addEventListener(
    'touchmove',
    (e) => {
      const t = e.touches[0]
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_PX) cancel()
    },
    { passive: true, capture: true }
  )
  const end = (e: TouchEvent): void => {
    cancel()
    // The menu opened: the finger lifting isn't also a tap on what's under it.
    if (fired && e.cancelable) e.preventDefault()
  }
  window.addEventListener('touchend', end, { capture: true })
  window.addEventListener('touchcancel', () => cancel(), { capture: true })
  window.addEventListener(
    'click',
    (e) => {
      if (!fired) return
      fired = false
      e.preventDefault()
      e.stopPropagation()
    },
    { capture: true }
  )
  // Tapping a message shows its actions (react, reply, more), which the desktop shows on hover.
  let touched: Element | null = null
  window.addEventListener('click', (e) => {
    const target = e.target as Element | null
    if (!target || target.closest('button, a, input, textarea, [role="menu"], [role="toolbar"]'))
      return
    const message = target.closest('.message')
    if (touched && touched !== message) touched.classList.remove('message--touched')
    touched = message && message !== touched ? message : null
    touched?.classList.add('message--touched')
  })

  // A browser that sends its own right-click for a long press (Chrome on Android tablets): use that.
  window.addEventListener(
    'contextmenu',
    () => {
      if (!making) cancel()
    },
    { capture: true }
  )
}

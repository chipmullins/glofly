import { emit } from './events'

// Push to talk in a browser: only while the Glofly tab is focused (browsers never let a page see
// keys pressed in other apps). Holding the chosen key or mouse button sends { type: 'ptt', down }
// like the desktop app's keyboard hook; leaving the tab counts as letting go.

let binding: { kind: 'key'; code: string } | { kind: 'mouse'; button: number } | null = null
let held = false
let cleanup: (() => void) | null = null

// Settings store "mouse:3" (wheel), "mouse:4" (back), "mouse:5" (forward); the DOM numbers them 1, 3, 4.
const DOM_BUTTON: Record<string, number> = { '3': 1, '4': 3, '5': 4 }

function send(down: boolean): void {
  if (down === held) return
  held = down
  emit({ type: 'ptt', down })
}

export function startPtt(choice: string): 'ok' | 'unavailable' {
  stopPtt()
  const m = /^(key:([A-Za-z0-9]{1,24})|mouse:([345]))$/.exec(choice)
  if (!m) return 'unavailable'
  binding = m[2] ? { kind: 'key', code: m[2] } : { kind: 'mouse', button: DOM_BUTTON[m[3]] }
  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (binding?.kind === 'key' && e.code === binding.code) send(down)
  }
  const onMouse = (down: boolean) => (e: MouseEvent) => {
    if (binding?.kind !== 'mouse' || e.button !== binding.button) return
    // The back / forward buttons would otherwise leave the page.
    e.preventDefault()
    send(down)
  }
  const keyDown = onKey(true)
  const keyUp = onKey(false)
  const mouseDown = onMouse(true)
  const mouseUp = onMouse(false)
  const letGo = (): void => send(false)
  const hidden = (): void => {
    if (document.hidden) send(false)
  }
  window.addEventListener('keydown', keyDown, true)
  window.addEventListener('keyup', keyUp, true)
  window.addEventListener('mousedown', mouseDown, true)
  window.addEventListener('mouseup', mouseUp, true)
  window.addEventListener('blur', letGo)
  document.addEventListener('visibilitychange', hidden)
  cleanup = () => {
    window.removeEventListener('keydown', keyDown, true)
    window.removeEventListener('keyup', keyUp, true)
    window.removeEventListener('mousedown', mouseDown, true)
    window.removeEventListener('mouseup', mouseUp, true)
    window.removeEventListener('blur', letGo)
    document.removeEventListener('visibilitychange', hidden)
  }
  return 'ok'
}

export function stopPtt(): void {
  cleanup?.()
  cleanup = null
  binding = null
  if (held) send(false)
}

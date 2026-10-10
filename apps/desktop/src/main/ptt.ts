// Push to talk (Settings → Voice & video). Holding the chosen key or mouse button unmutes the
// microphone during a call, even while a game or another app is in front.
//
// Electron's globalShortcut only reports presses, never releases, so "hold to talk" uses a
// small native keyboard/mouse hook (uiohook-napi, prebuilt for Windows and Mac). It's loaded
// only when needed and runs only while you're in a call with Push to talk on. Every key goes
// past it, so it keeps nothing and passes on only "the chosen key went down / came up".

import { systemPreferences, type BrowserWindow } from 'electron'

export type PttStatus =
  /** Listening for the key */
  | 'ok'
  /** Mac: Glofly needs to be allowed under Privacy & Security → Accessibility */
  | 'permission'
  /** The hook couldn't start on this computer */
  | 'unavailable'

type Binding = { kind: 'key'; keycode: number } | { kind: 'mouse'; button: number }

// What the window sends: "key:<KeyboardEvent.code>" or "mouse:<4|5|3>".
const BINDING = /^(key:[A-Za-z0-9]{1,24}|mouse:[345])$/
export const isPttBinding = (v: unknown): v is string => typeof v === 'string' && BINDING.test(v)

type Hook = typeof import('uiohook-napi')
let hook: Hook | null = null
let loadFailed = false
let started = false
let binding: Binding | null = null
let held = false
let target: BrowserWindow | null = null

function load(): Hook | null {
  if (hook || loadFailed) return hook
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hook = require('uiohook-napi') as Hook
    hook.uIOhook.on('keydown', (e) => {
      if (binding?.kind === 'key' && e.keycode === binding.keycode) send(true)
    })
    hook.uIOhook.on('keyup', (e) => {
      if (binding?.kind === 'key' && e.keycode === binding.keycode) send(false)
    })
    hook.uIOhook.on('mousedown', (e) => {
      if (binding?.kind === 'mouse' && e.button === binding.button) send(true)
    })
    hook.uIOhook.on('mouseup', (e) => {
      if (binding?.kind === 'mouse' && e.button === binding.button) send(false)
    })
  } catch (err) {
    loadFailed = true
    console.error("Push to talk: the keyboard hook couldn't load:", err)
  }
  return hook
}

/** Only changes are sent (holding a key repeats keydown; that's ignored). */
function send(down: boolean): void {
  if (down === held) return
  held = down
  if (target && !target.isDestroyed())
    target.webContents.send('glofly:event', { type: 'ptt', down })
}

/** KeyboardEvent.code (what the settings page records) → the hook's key number. */
function keycodeFor(code: string, keys: Hook['UiohookKey']): number | null {
  const k = keys as Record<string, number>
  const named: Record<string, string> = {
    ControlLeft: 'Ctrl',
    ControlRight: 'CtrlRight',
    ShiftLeft: 'Shift',
    ShiftRight: 'ShiftRight',
    AltLeft: 'Alt',
    AltRight: 'AltRight',
    MetaLeft: 'Meta',
    MetaRight: 'MetaRight',
    OSLeft: 'Meta',
    OSRight: 'MetaRight'
  }
  let name = named[code] ?? code
  if (/^Key[A-Z]$/.test(code)) name = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) name = code.slice(5)
  return typeof k[name] === 'number' ? k[name] : null
}

/**
 * Starts listening for the chosen key (called when a call starts, or the setting changes).
 * Returns whether it's working.
 */
export function startPtt(window: BrowserWindow, choice: string): PttStatus {
  target = window
  const h = load()
  if (!h) return 'unavailable'
  if (choice.startsWith('mouse:')) {
    binding = { kind: 'mouse', button: Number(choice.slice(6)) }
  } else {
    const keycode = keycodeFor(choice.slice(4), h.UiohookKey)
    if (keycode === null) return 'unavailable'
    binding = { kind: 'key', keycode }
  }
  // macOS only lets apps see keys pressed in other apps once allowed under Accessibility.
  // Asking shows macOS's own prompt the first time.
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(true)) {
    return 'permission'
  }
  if (!started) {
    try {
      h.uIOhook.start()
      started = true
    } catch (err) {
      console.error("Push to talk: the keyboard hook couldn't start:", err)
      return 'unavailable'
    }
  }
  return 'ok'
}

/** Stops listening (the call ended, or Push to talk was turned off). */
export function stopPtt(): void {
  binding = null
  if (held) send(false)
  held = false
  if (started && hook) {
    try {
      hook.uIOhook.stop()
    } catch {
      // Already stopped.
    }
  }
  started = false
}

import { isMac } from './platform'

// Settings → Voice & video: which microphone, speakers and camera calls use, and how the
// microphone is cleaned up. Saved on this computer (device ids only mean something here).

export type CallPrefs = {
  /** '' = the computer's default */
  micId: string
  speakerId: string
  cameraId: string
  /** Filters out background noise (fans, keyboards) */
  noiseSuppression: boolean
  /** Stops the other person hearing themselves through your speakers */
  echoCancellation: boolean
  /** Evens out how loud you sound */
  autoGainControl: boolean
  /** Show your own camera like a mirror (the other person always sees it the right way round) */
  mirrorCamera: boolean
  /** Open mic (always on unless you mute) or push to talk (on only while holding a key) */
  inputMode: 'open' | 'ptt'
  /** Push to talk: "key:<KeyboardEvent.code>" or "mouse:<3|4|5>" */
  pttKey: string
  /** How that key is shown ("`", "F", "Mouse 4") */
  pttLabel: string
}

const KEY = 'glofly.voiceVideo'

const DEFAULTS: CallPrefs = {
  micId: '',
  speakerId: '',
  cameraId: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  mirrorCamera: true,
  inputMode: 'open',
  pttKey: 'key:Backquote',
  pttLabel: '`'
}

let prefs: CallPrefs = load()
const listeners = new Set<(p: CallPrefs) => void>()

function load(): CallPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CallPrefs>
    const result = { ...DEFAULTS }
    for (const k of Object.keys(DEFAULTS) as (keyof CallPrefs)[]) {
      if (typeof saved[k] === typeof DEFAULTS[k]) (result[k] as unknown) = saved[k]
    }
    if (result.inputMode !== 'ptt') result.inputMode = 'open'
    if (!isPttKey(result.pttKey)) {
      result.pttKey = DEFAULTS.pttKey
      result.pttLabel = DEFAULTS.pttLabel
    }
    return result
  } catch {
    return { ...DEFAULTS }
  }
}

export function getCallPrefs(): CallPrefs {
  return prefs
}

export function setCallPrefs(changes: Partial<CallPrefs>): CallPrefs {
  prefs = { ...prefs, ...changes }
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage is unavailable: the choice still applies until Glofly closes.
  }
  for (const listener of listeners) listener(prefs)
  return prefs
}

/** Runs whenever the settings change. Returns a function that stops listening. */
export function onCallPrefsChange(listener: (p: CallPrefs) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Microphone settings for the browser's audio capture. */
export function audioCapture(p: CallPrefs = prefs): MediaTrackConstraints & { deviceId?: string } {
  return {
    ...(p.micId ? { deviceId: p.micId } : {}),
    echoCancellation: p.echoCancellation,
    noiseSuppression: p.noiseSuppression,
    autoGainControl: p.autoGainControl
  }
}

// ---------------------------------------------------------------------------------------
// Push to talk keys

export const isPttKey = (v: string): boolean => /^(key:[A-Za-z0-9]{1,24}|mouse:[345])$/.test(v)

/** Keys that would get in the way as a push-to-talk key. */
const REFUSED = new Set(['Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'NumpadEnter'])

const LABELS: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  CapsLock: 'Caps Lock',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  MetaLeft: isMac ? 'Left ⌘' : 'Left Windows',
  MetaRight: isMac ? 'Right ⌘' : 'Right Windows',
  ...(isMac ? { AltLeft: 'Left Option', AltRight: 'Right Option' } : {}),
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  ScrollLock: 'Scroll Lock',
  PrintScreen: 'Print Screen',
  NumLock: 'Num Lock'
}

/** A key pressed on the settings page → what to save, or null if it can't be used. */
export function pttFromKey(code: string): { pttKey: string; pttLabel: string } | null {
  if (!code || REFUSED.has(code) || !/^[A-Za-z0-9]{1,24}$/.test(code)) return null
  let label = LABELS[code]
  if (!label && /^Key[A-Z]$/.test(code)) label = code.slice(3)
  if (!label && /^Digit[0-9]$/.test(code)) label = code.slice(5)
  if (!label && /^Numpad/.test(code)) label = `Numpad ${code.slice(6)}`
  if (!label && /^F[0-9]{1,2}$/.test(code)) label = code
  if (!label && /^(Home|End|Insert)$/.test(code)) label = code
  if (!label) return null // a key the hook doesn't know
  return { pttKey: `key:${code}`, pttLabel: label }
}

/** A mouse button pressed on the settings page (side buttons and the wheel click only). */
export function pttFromMouse(button: number): { pttKey: string; pttLabel: string } | null {
  // MouseEvent.button: 1 = wheel click, 3 = back, 4 = forward. The hook counts 3, 4, 5.
  const map: Record<number, [string, string]> = {
    1: ['mouse:3', 'Mouse wheel click'],
    3: ['mouse:4', 'Mouse 4 (back)'],
    4: ['mouse:5', 'Mouse 5 (forward)']
  }
  const m = map[button]
  return m ? { pttKey: m[0], pttLabel: m[1] } : null
}

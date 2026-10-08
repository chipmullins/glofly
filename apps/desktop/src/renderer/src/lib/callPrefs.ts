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
}

const KEY = 'glofly.voiceVideo'

const DEFAULTS: CallPrefs = {
  micId: '',
  speakerId: '',
  cameraId: '',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  mirrorCamera: true
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

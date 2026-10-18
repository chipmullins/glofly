import { create } from 'zustand'
import { DEFAULT_PHONE_CONSTELLATION_SOUND, DEFAULT_PHONE_MESSAGE_SOUND, DEFAULT_PHONE_RINGTONE } from '@glofly/shared'
import { prefs } from '@/lib/storage'

// This phone's settings (Settings → Notifications & sounds), kept on the phone like the desktop
// app's "this PC" settings. "Show message preview" is also told to the server with the push token.

export type PhonePrefs = {
  notifications: boolean
  preview: boolean
  sounds: boolean
  vibrate: boolean
  /** Picked message sound and ringtone (@glofly/shared PHONE_MESSAGE_SOUNDS / PHONE_RINGTONES ids). */
  messageSound: string
  ringtone: string
  /** 0.7.0: messages in constellations (a message sound id; Lantern by default). */
  constellationSound: string
}

const defaults: PhonePrefs = { notifications: true, preview: true, sounds: true, vibrate: true, messageSound: DEFAULT_PHONE_MESSAGE_SOUND, ringtone: DEFAULT_PHONE_RINGTONE, constellationSound: DEFAULT_PHONE_CONSTELLATION_SOUND }

export const usePhonePrefs = create<PhonePrefs & { loaded: boolean }>(() => ({ ...defaults, loaded: false }))

export async function loadPhonePrefs(): Promise<void> {
  const saved = await prefs.get<Partial<PhonePrefs> & { soundDefaults?: number }>('phone', {})
  // 0.7.0: Low comet became the default message sound; the old default (Firefly chime) moves over once.
  if ((saved.soundDefaults ?? 1) < 3 && saved.messageSound === 'chime') saved.messageSound = DEFAULT_PHONE_MESSAGE_SOUND
  const { soundDefaults: _v, ...rest } = saved
  usePhonePrefs.setState({ ...defaults, ...rest, loaded: true })
}

const listeners = new Set<(p: PhonePrefs) => void>()
export function onPhonePrefsChange(fn: (p: PhonePrefs) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function setPhonePref<K extends keyof PhonePrefs>(key: K, value: PhonePrefs[K]): Promise<void> {
  usePhonePrefs.setState({ [key]: value } as Partial<PhonePrefs>)
  const { loaded: _l, ...rest } = usePhonePrefs.getState()
  await prefs.set('phone', { ...rest, soundDefaults: 4 })
  for (const fn of listeners) fn(rest)
}

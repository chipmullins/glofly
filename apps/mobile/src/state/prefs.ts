import { create } from 'zustand'
import { prefs } from '@/lib/storage'

// This phone's settings (Settings → Notifications & sounds), kept on the phone like the desktop
// app's "this PC" settings. "Show message preview" is also told to the server with the push token.

export type PhonePrefs = {
  notifications: boolean
  preview: boolean
  sounds: boolean
  vibrate: boolean
}

const defaults: PhonePrefs = { notifications: true, preview: true, sounds: true, vibrate: true }

export const usePhonePrefs = create<PhonePrefs & { loaded: boolean }>(() => ({ ...defaults, loaded: false }))

export async function loadPhonePrefs(): Promise<void> {
  const saved = await prefs.get<Partial<PhonePrefs>>('phone', {})
  usePhonePrefs.setState({ ...defaults, ...saved, loaded: true })
}

const listeners = new Set<(p: PhonePrefs) => void>()
export function onPhonePrefsChange(fn: (p: PhonePrefs) => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function setPhonePref<K extends keyof PhonePrefs>(key: K, value: PhonePrefs[K]): Promise<void> {
  usePhonePrefs.setState({ [key]: value } as Partial<PhonePrefs>)
  const { loaded: _l, ...rest } = usePhonePrefs.getState()
  await prefs.set('phone', rest)
  for (const fn of listeners) fn(rest)
}

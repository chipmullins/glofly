// Sounds you can pick on phones (Oct 13): the message sound and the ringtone. The phone plays its
// own copy of each, and notifications name them too, so the server (iPhone notifications) and the
// apps agree on this list. The labels and files match the desktop app's sound pickers.
//
// Each choice has a native name: the file in the phone app (Android res/raw/<name>.ogg, iPhone
// <name>.caf). The defaults keep the names phones shipped with, so older builds still find them.

export type PhoneSound = {
  id: string
  label: string
  /** The desktop app's file (apps/desktop/src/renderer/src/assets/sounds/<file>.ogg). */
  file: string
  /** The phone app's copy: Android res/raw/<native>.ogg, iPhone <native>.caf. */
  native: string
}

export const PHONE_MESSAGE_SOUNDS: readonly PhoneSound[] = [
  { id: 'chime', label: 'Firefly chime', file: 'message', native: 'glofly_message' },
  { id: 'dewdrop', label: 'Dewdrop', file: 'dewdrop', native: 'glofly_msg_dewdrop' },
  { id: 'pebble', label: 'Pebble', file: 'pebble', native: 'glofly_msg_pebble' },
  { id: 'pluck', label: 'Pluck', file: 'pluck', native: 'glofly_msg_pluck' },
  { id: 'sparkTrail', label: 'Spark trail', file: 'spark-trail', native: 'glofly_msg_spark_trail' },
  { id: 'starfall', label: 'Starfall', file: 'starfall', native: 'glofly_msg_starfall' },
  { id: 'fade', label: 'Fade', file: 'fade', native: 'glofly_msg_fade' },
  { id: 'glowOn', label: 'Glow on', file: 'glow-on', native: 'glofly_msg_glow_on' },
  { id: 'blinkIn', label: 'Blink in', file: 'blink-in', native: 'glofly_msg_blink_in' },
  { id: 'hello', label: 'Glofly hello', file: 'login', native: 'glofly_msg_hello' },
]

export const PHONE_RINGTONES: readonly PhoneSound[] = [
  { id: 'fireflyDance', label: 'Firefly dance', file: 'ring-in-firefly', native: 'glofly_ringtone' },
  { id: 'glowBells', label: 'Glow bells', file: 'ring-in-glowbells', native: 'glofly_ring_glow_bells' },
  { id: 'marimbaRing', label: 'Marimba', file: 'ring-in-marimba', native: 'glofly_ring_marimba' },
  { id: 'kalimbaRing', label: 'Kalimba', file: 'ring-in-kalimba', native: 'glofly_ring_kalimba' },
  { id: 'glassChimes', label: 'Glass chimes', file: 'ring-in-glass', native: 'glofly_ring_glass' },
  { id: 'classic', label: 'Classic', file: 'ring-in-classic', native: 'glofly_ring_classic' },
  { id: 'electro', label: 'Electro', file: 'ring-in-electro', native: 'glofly_ring_electro' },
  { id: 'chiptune', label: 'Chiptune', file: 'ring-in-chiptune', native: 'glofly_ring_chiptune' },
  { id: 'groove', label: 'Groove', file: 'ring-in-groove', native: 'glofly_ring_groove' },
  { id: 'steelDrums', label: 'Steel drums', file: 'ring-in-steel', native: 'glofly_ring_steel' },
  { id: 'vibesRing', label: 'Vibes', file: 'ring-in-vibes', native: 'glofly_ring_vibes' },
  { id: 'digitalBells', label: 'Digital bells', file: 'ring-in-fmbells', native: 'glofly_ring_digital_bells' },
  { id: 'ring', label: 'Glow ring', file: 'ringtone', native: 'glofly_ring_glow' },
]

export const DEFAULT_PHONE_MESSAGE_SOUND = 'chime'
export const DEFAULT_PHONE_RINGTONE = 'fireflyDance'

/** The message sound with this id (the default for unknown or missing ids). */
export function phoneMessageSound(id: string | null | undefined): PhoneSound {
  return PHONE_MESSAGE_SOUNDS.find((s) => s.id === id) ?? PHONE_MESSAGE_SOUNDS[0]
}

/** The ringtone with this id (the default for unknown or missing ids). */
export function phoneRingtone(id: string | null | undefined): PhoneSound {
  return PHONE_RINGTONES.find((s) => s.id === id) ?? PHONE_RINGTONES[0]
}

export const isPhoneMessageSound = (id: unknown): id is string => typeof id === 'string' && PHONE_MESSAGE_SOUNDS.some((s) => s.id === id)
export const isPhoneRingtone = (id: unknown): id is string => typeof id === 'string' && PHONE_RINGTONES.some((s) => s.id === id)

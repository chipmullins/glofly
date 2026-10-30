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
  // 0.7.0: the default. Its lock-screen copy comes with the next phone build (older builds play Firefly chime).
  { id: 'lowComet', label: 'Low comet', file: 'low-comet', native: 'glofly_msg_low_comet' },
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
  // 0.7.0. Its lock-screen copy comes with the next phone build (older builds play the default).
  { id: 'comet', label: 'Comet', file: 'comet', native: 'glofly_msg_comet' },
  // 0.7.0: the night-sky set (also the constellation message sound; Lantern is its default).
  { id: 'twinStars', label: 'Twin stars', file: 'twin-stars', native: 'glofly_msg_twin_stars' },
  { id: 'constellation', label: 'Constellation', file: 'constellation', native: 'glofly_msg_constellation' },
  { id: 'nebula', label: 'Nebula', file: 'nebula', native: 'glofly_msg_nebula' },
  { id: 'starlightPing', label: 'Starlight ping', file: 'starlight-ping', native: 'glofly_msg_starlight_ping' },
  { id: 'moonrise', label: 'Moonrise', file: 'moonrise', native: 'glofly_msg_moonrise' },
  { id: 'hollowWood', label: 'Hollow wood', file: 'hollow-wood', native: 'glofly_msg_hollow_wood' },
  { id: 'nightBreeze', label: 'Night breeze', file: 'night-breeze', native: 'glofly_msg_night_breeze' },
  { id: 'ember', label: 'Ember', file: 'ember', native: 'glofly_msg_ember' },
  { id: 'orbit', label: 'Orbit', file: 'orbit', native: 'glofly_msg_orbit' },
  { id: 'stardust', label: 'Stardust', file: 'stardust', native: 'glofly_msg_stardust' },
  { id: 'aurora', label: 'Aurora', file: 'aurora', native: 'glofly_msg_aurora' },
  { id: 'skyLantern', label: 'Lantern', file: 'sky-lantern', native: 'glofly_msg_sky_lantern' },
  { id: 'deepSpace', label: 'Deep space', file: 'deep-space', native: 'glofly_msg_deep_space' },
]

// Oct 29, 2026: Doo-wop (Chip's pick) is the only ringtone. It plays from the native name every
// build already has (glofly_ringtone), so older phones play their old copy until their next build
// and lock-screen pushes always find a file. Anyone who had picked another one gets Doo-wop
// (phoneRingtone falls back to the first). The retired list is below, to add back later.
export const PHONE_RINGTONES: readonly PhoneSound[] = [
  { id: 'doowop', label: 'Doo-wop', file: 'ring-in-doowop', native: 'glofly_ringtone' },
]

/** Not offered since Oct 29, 2026. Their files are still in the apps (re-add an entry above to bring one back). */
export const RETIRED_PHONE_RINGTONES: readonly PhoneSound[] = [
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

export const DEFAULT_PHONE_MESSAGE_SOUND = 'lowComet'
export const DEFAULT_PHONE_RINGTONE = 'doowop'
/** 0.7.0: messages in constellations have their own sound, picked from the message sounds. */
export const DEFAULT_PHONE_CONSTELLATION_SOUND = 'skyLantern'

/** The message sound with this id (the default for unknown or missing ids). */
export function phoneMessageSound(id: string | null | undefined): PhoneSound {
  // A phone that never said (an older app) keeps Firefly chime, which every build has.
  return PHONE_MESSAGE_SOUNDS.find((s) => s.id === id) ?? PHONE_MESSAGE_SOUNDS.find((s) => s.id === 'chime')!
}

/** The ringtone with this id (the default for unknown or missing ids). */
export function phoneRingtone(id: string | null | undefined): PhoneSound {
  return PHONE_RINGTONES.find((s) => s.id === id) ?? PHONE_RINGTONES[0]
}

export const isPhoneMessageSound = (id: unknown): id is string => typeof id === 'string' && PHONE_MESSAGE_SOUNDS.some((s) => s.id === id)
export const isPhoneRingtone = (id: unknown): id is string => typeof id === 'string' && PHONE_RINGTONES.some((s) => s.id === id)

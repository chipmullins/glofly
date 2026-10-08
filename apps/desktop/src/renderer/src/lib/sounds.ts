// Glofly's sounds (Chip's sound files, in assets/sounds/).
//
// Which sound plays for what is set in Settings → Notifications & sounds and saved on this
// computer. Everywhere in the app that should make a sound calls playSound().

import type { AlertSound, CallSound, SoundSettings } from '../../../preload/api-types'
import messageFile from '../assets/sounds/message.ogg'
import loginFile from '../assets/sounds/login.ogg'
import ringtoneFile from '../assets/sounds/ringtone.ogg'
import outgoingFile from '../assets/sounds/outgoing.ogg'
import glowOnFile from '../assets/sounds/glow-on.ogg'
import glowOffFile from '../assets/sounds/glow-off.ogg'
import blinkInFile from '../assets/sounds/blink-in.ogg'
import blinkOutFile from '../assets/sounds/blink-out.ogg'
import goodnightFile from '../assets/sounds/goodnight.ogg'
import sparkTrailFile from '../assets/sounds/spark-trail.ogg'
import dewdropFile from '../assets/sounds/dewdrop.ogg'
import starfallFile from '../assets/sounds/starfall.ogg'
import pebbleFile from '../assets/sounds/pebble.ogg'

export type SoundName =
  | 'message' // a message arrives
  | 'friendRequest' // someone sends you a friend request
  | 'login' // the firefly takeoff finishes
  | 'logout' // you log out
  | 'callConnected' // you're in a call with someone
  | 'callEnded' // you leave a call, or it ends
  | 'memberJoined' // someone joins the group call you're in
  | 'memberLeft' // someone leaves the group call you're in
  | 'ringtone' // someone is calling you
  | 'outgoing' // waiting for someone to answer your call

export type SoundFile = Exclude<AlertSound | CallSound, 'none'>

/** The sound library, with the names shown in Settings. */
export const SOUND_FILES: Record<SoundFile, { label: string; url: string }> = {
  chime: { label: 'Firefly chime', url: messageFile },
  hello: { label: 'Glofly hello', url: loginFile },
  ring: { label: 'Glow ring', url: ringtoneFile },
  jingle: { label: 'Glofly jingle', url: outgoingFile },
  // Made Oct 8 from the same notes (C, E, G, B) and tone as the sounds above.
  glowOn: { label: 'Glow on', url: glowOnFile },
  glowOff: { label: 'Glow off', url: glowOffFile },
  blinkIn: { label: 'Blink in', url: blinkInFile },
  blinkOut: { label: 'Blink out', url: blinkOutFile },
  goodnight: { label: 'Glofly goodnight', url: goodnightFile },
  sparkTrail: { label: 'Spark trail', url: sparkTrailFile },
  dewdrop: { label: 'Dewdrop', url: dewdropFile },
  starfall: { label: 'Starfall', url: starfallFile },
  pebble: { label: 'Pebble', url: pebbleFile }
}

let settings: SoundSettings = {
  enabled: true,
  dndSilence: true,
  message: 'chime',
  friendRequest: 'chime',
  login: 'hello',
  logout: 'goodnight',
  callConnected: 'glowOn',
  callEnded: 'glowOff',
  memberJoined: 'blinkIn',
  memberLeft: 'blinkOut',
  ringtone: 'ring',
  outgoing: 'jingle'
}

/** Called at startup and whenever Settings changes them. */
export function setSoundSettings(next: SoundSettings): void {
  settings = next
}

// While you're set to Do not disturb, Glofly stays silent (if that setting is on).
let quiet = false
export function setQuiet(value: boolean): void {
  quiet = value
}

/** True while Do not disturb is silencing Glofly (sounds and notifications). */
export const isSilenced = (): boolean => quiet && settings.dndSilence

const lastPlayed = new Map<SoundName, number>()

/** Plays the sound picked for this moment, unless sounds are off or you're in Do not disturb. */
export function playSound(name: SoundName): void {
  if (!settings.enabled || (quiet && settings.dndSilence)) return
  const choice = settings[name]
  if (!choice || choice === 'none' || !(choice in SOUND_FILES)) return
  // A burst of messages makes one sound, not a pile-up.
  const now = Date.now()
  if (now - (lastPlayed.get(name) ?? 0) < 800) return
  lastPlayed.set(name, now)
  const audio = new Audio(SOUND_FILES[choice].url)
  void audio.play().catch(() => {
    // The computer has no sound device, or it's busy: nothing to do.
  })
}

/**
 * Plays a call sound over and over (the ringtone, or the jingle while you wait for someone to
 * answer) until the returned function is called. Silent if sounds are off or you're in
 * Do not disturb.
 */
export function startLoop(name: 'ringtone' | 'outgoing'): () => void {
  if (!settings.enabled || (quiet && settings.dndSilence)) return () => {}
  const choice = settings[name]
  if (!choice || choice === 'none' || !(choice in SOUND_FILES)) return () => {}
  const audio = new Audio(SOUND_FILES[choice].url)
  audio.loop = true
  let stopped = false
  void audio.play().catch(() => {
    // No sound device: nothing to do.
  })
  return () => {
    if (stopped) return
    stopped = true
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}

// ---------------------------------------------------------------------------------------
// Previews in Settings: press Play to hear a sound (even if sounds are muted), press again
// to stop. Only one preview plays at a time.

let preview: HTMLAudioElement | null = null
let previewDone: (() => void) | null = null

export function stopPreview(): void {
  preview?.pause()
  preview = null
  previewDone?.()
  previewDone = null
}

/** Plays a sound from the library; onEnd runs when it finishes or is stopped. */
export function previewSound(file: SoundFile, onEnd: () => void): void {
  stopPreview()
  const audio = new Audio(SOUND_FILES[file].url)
  preview = audio
  previewDone = onEnd
  audio.addEventListener('ended', () => {
    if (preview === audio) stopPreview()
  })
  void audio.play().catch(() => stopPreview())
}

import { inQuiet } from './quiet'
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
import cometFile from '../assets/sounds/comet.ogg'
import lowCometFile from '../assets/sounds/low-comet.ogg'
import twinStarsFile from '../assets/sounds/twin-stars.ogg'
import constellationFile from '../assets/sounds/constellation.ogg'
import nebulaFile from '../assets/sounds/nebula.ogg'
import starlightPingFile from '../assets/sounds/starlight-ping.ogg'
import moonriseFile from '../assets/sounds/moonrise.ogg'
import hollowWoodFile from '../assets/sounds/hollow-wood.ogg'
import nightBreezeFile from '../assets/sounds/night-breeze.ogg'
import emberFile from '../assets/sounds/ember.ogg'
import orbitFile from '../assets/sounds/orbit.ogg'
import stardustFile from '../assets/sounds/stardust.ogg'
import auroraFile from '../assets/sounds/aurora.ogg'
import skyLanternFile from '../assets/sounds/sky-lantern.ogg'
import deepSpaceFile from '../assets/sounds/deep-space.ogg'
import ringOutSynthArpFile from '../assets/sounds/ring-out-synth-arp.ogg'
import ringOutLanternFile from '../assets/sounds/ring-out-lantern.ogg'
import ringOutFireflyFile from '../assets/sounds/ring-out-firefly.ogg'
import ringOutMarimbaFile from '../assets/sounds/ring-out-marimba.ogg'
import ringOutGlassFile from '../assets/sounds/ring-out-glass.ogg'
import ringOutBreatheFile from '../assets/sounds/ring-out-breathe.ogg'
import ringOutKalimbaFile from '../assets/sounds/ring-out-kalimba.ogg'
import ringOutEveningFile from '../assets/sounds/ring-out-evening.ogg'
import ringOutPixelFile from '../assets/sounds/ring-out-pixel.ogg'
import ringOutVibesFile from '../assets/sounds/ring-out-vibes.ogg'
import ringOutMusicboxFile from '../assets/sounds/ring-out-musicbox.ogg'
import ringOutNightdriveFile from '../assets/sounds/ring-out-nightdrive.ogg'
import ringOutSteelFile from '../assets/sounds/ring-out-steel.ogg'
import ringOutDigitalFile from '../assets/sounds/ring-out-digital.ogg'
import ringInFireflyFile from '../assets/sounds/ring-in-firefly.ogg'
import ringInGlowbellsFile from '../assets/sounds/ring-in-glowbells.ogg'
import ringInMarimbaFile from '../assets/sounds/ring-in-marimba.ogg'
import ringInKalimbaFile from '../assets/sounds/ring-in-kalimba.ogg'
import ringInGlassFile from '../assets/sounds/ring-in-glass.ogg'
import ringInClassicFile from '../assets/sounds/ring-in-classic.ogg'
import ringInElectroFile from '../assets/sounds/ring-in-electro.ogg'
import ringInChiptuneFile from '../assets/sounds/ring-in-chiptune.ogg'
import ringInGrooveFile from '../assets/sounds/ring-in-groove.ogg'
import ringInSteelFile from '../assets/sounds/ring-in-steel.ogg'
import ringInVibesFile from '../assets/sounds/ring-in-vibes.ogg'
import ringInFmbellsFile from '../assets/sounds/ring-in-fmbells.ogg'
import pluckFile from '../assets/sounds/pluck.ogg'
import fadeFile from '../assets/sounds/fade.ogg'
import noAnswerFile from '../assets/sounds/no-answer.ogg'
import pttFireflyDownFile from '../assets/sounds/ptt-firefly-down.ogg'
import pttFireflyUpFile from '../assets/sounds/ptt-firefly-up.ogg'
import pttBlinkDownFile from '../assets/sounds/ptt-blink-down.ogg'
import pttBlinkUpFile from '../assets/sounds/ptt-blink-up.ogg'
import pttPluckDownFile from '../assets/sounds/ptt-pluck-down.ogg'
import pttPluckUpFile from '../assets/sounds/ptt-pluck-up.ogg'
import pttBellDownFile from '../assets/sounds/ptt-bell-down.ogg'
import pttBellUpFile from '../assets/sounds/ptt-bell-up.ogg'
import pttGlassDownFile from '../assets/sounds/ptt-glass-down.ogg'
import pttGlassUpFile from '../assets/sounds/ptt-glass-up.ogg'
import pttRadioDownFile from '../assets/sounds/ptt-radio-down.ogg'
import pttRadioUpFile from '../assets/sounds/ptt-radio-up.ogg'
import pttTapDownFile from '../assets/sounds/ptt-tap-down.ogg'
import pttTapUpFile from '../assets/sounds/ptt-tap-up.ogg'
import pttSparkDownFile from '../assets/sounds/ptt-spark-down.ogg'
import pttSparkUpFile from '../assets/sounds/ptt-spark-up.ogg'

export type SoundName =
  | 'message' // a message arrives
  | 'constellationMessage' // a message in a constellation's nebula (0.7.0)
  | 'friendRequest' // someone sends you a friend request
  | 'friendOnline' // a friend you asked about comes online
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
export const SOUND_FILES: Record<
  SoundFile,
  {
    label: string
    url: string
    /** Ringing sounds: which list they're offered in (outgoing / incoming) */
    ring?: 'out' | 'in'
    /** Ringing sounds made as one seamless loop cycle: its length in seconds */
    loop?: number
  }
> = {
  chime: { label: 'Firefly chime', url: messageFile },
  hello: { label: 'Glofly hello', url: loginFile },
  ring: { label: 'Glow ring', url: ringtoneFile, ring: 'in' },
  jingle: { label: 'Glofly jingle', url: outgoingFile, ring: 'out' },
  // Made Oct 8 from the same notes (C, E, G, B) and tone as the sounds above.
  glowOn: { label: 'Glow on', url: glowOnFile },
  glowOff: { label: 'Glow off', url: glowOffFile },
  blinkIn: { label: 'Blink in', url: blinkInFile },
  blinkOut: { label: 'Blink out', url: blinkOutFile },
  goodnight: { label: 'Glofly goodnight', url: goodnightFile },
  sparkTrail: { label: 'Spark trail', url: sparkTrailFile },
  dewdrop: { label: 'Dewdrop', url: dewdropFile },
  starfall: { label: 'Starfall', url: starfallFile },
  pebble: { label: 'Pebble', url: pebbleFile },
  // 0.2.2, from the "no answer" round: offered for any short sound.
  pluck: { label: 'Pluck', url: pluckFile },
  fade: { label: 'Fade', url: fadeFile },
  // Oct 17 (0.7.0): a quick upward whoosh into a chime.
  comet: { label: 'Comet', url: cometFile },
  // 0.7.0: the new default message sound (a gentle low whoosh into a mellow bell).
  lowComet: { label: 'Low comet', url: lowCometFile },
  // Oct 17 (0.7.0): the night-sky set. Hollow wood and Night breeze are the friend online and
  // friend request defaults, Lantern the constellation message default.
  twinStars: { label: 'Twin stars', url: twinStarsFile },
  constellation: { label: 'Constellation', url: constellationFile },
  nebula: { label: 'Nebula', url: nebulaFile },
  starlightPing: { label: 'Starlight ping', url: starlightPingFile },
  moonrise: { label: 'Moonrise', url: moonriseFile },
  hollowWood: { label: 'Hollow wood', url: hollowWoodFile },
  nightBreeze: { label: 'Night breeze', url: nightBreezeFile },
  ember: { label: 'Ember', url: emberFile },
  orbit: { label: 'Orbit', url: orbitFile },
  stardust: { label: 'Stardust', url: stardustFile },
  aurora: { label: 'Aurora', url: auroraFile },
  skyLantern: { label: 'Lantern', url: skyLanternFile },
  deepSpace: { label: 'Deep space', url: deepSpaceFile },
  // 0.2.2 ringing sounds (tools/sounds/ring.py, ring2.py). Each file is ONE loop cycle `loop`
  // seconds long (its echo is folded onto the start), so it repeats with no gap.
  synthArp: { label: 'Synth arp', url: ringOutSynthArpFile, ring: 'out', loop: 4.0 },
  lantern: { label: 'Lantern', url: ringOutLanternFile, ring: 'out', loop: 3.0 },
  fireflyOut: { label: 'Firefly', url: ringOutFireflyFile, ring: 'out', loop: 2.8 },
  marimbaOut: { label: 'Marimba', url: ringOutMarimbaFile, ring: 'out', loop: 3.0 },
  glassOut: { label: 'Glass', url: ringOutGlassFile, ring: 'out', loop: 3.2 },
  breathe: { label: 'Breathe', url: ringOutBreatheFile, ring: 'out', loop: 3.4 },
  kalimbaOut: { label: 'Kalimba', url: ringOutKalimbaFile, ring: 'out', loop: 3.0 },
  evening: { label: 'Evening', url: ringOutEveningFile, ring: 'out', loop: 6.0 },
  pixel: { label: 'Pixel', url: ringOutPixelFile, ring: 'out', loop: 2.24 },
  vibesOut: { label: 'Vibes', url: ringOutVibesFile, ring: 'out', loop: 5.0 },
  musicBox: { label: 'Music box', url: ringOutMusicboxFile, ring: 'out', loop: 3.2 },
  nightDrive: { label: 'Night drive', url: ringOutNightdriveFile, ring: 'out', loop: 4.0 },
  steelOut: { label: 'Steel drum', url: ringOutSteelFile, ring: 'out', loop: 3.04 },
  digital: { label: 'Digital', url: ringOutDigitalFile, ring: 'out', loop: 3.0 },
  fireflyDance: { label: 'Firefly dance', url: ringInFireflyFile, ring: 'in', loop: 2.8 },
  glowBells: { label: 'Glow bells', url: ringInGlowbellsFile, ring: 'in', loop: 3.2 },
  marimbaRing: { label: 'Marimba', url: ringInMarimbaFile, ring: 'in', loop: 2.8 },
  kalimbaRing: { label: 'Kalimba', url: ringInKalimbaFile, ring: 'in', loop: 3.0 },
  glassChimes: { label: 'Glass chimes', url: ringInGlassFile, ring: 'in', loop: 3.0 },
  classic: { label: 'Classic', url: ringInClassicFile, ring: 'in', loop: 3.0 },
  electro: { label: 'Electro', url: ringInElectroFile, ring: 'in', loop: 2.6 },
  chiptune: { label: 'Chiptune', url: ringInChiptuneFile, ring: 'in', loop: 2.6 },
  groove: { label: 'Groove', url: ringInGrooveFile, ring: 'in', loop: 2.6 },
  steelDrums: { label: 'Steel drums', url: ringInSteelFile, ring: 'in', loop: 2.8 },
  vibesRing: { label: 'Vibes', url: ringInVibesFile, ring: 'in', loop: 2.8 },
  digitalBells: { label: 'Digital bells', url: ringInFmbellsFile, ring: 'in', loop: 2.8 }
}

let settings: SoundSettings = {
  enabled: true,
  dndSilence: true,
  volume: 100,
  callVolume: 100,
  message: 'lowComet',
  constellationMessage: 'skyLantern',
  friendRequest: 'nightBreeze',
  friendOnline: 'hollowWood',
  login: 'hello',
  logout: 'goodnight',
  callConnected: 'glowOn',
  callEnded: 'glowOff',
  memberJoined: 'blinkIn',
  memberLeft: 'blinkOut',
  ringtone: 'fireflyDance',
  outgoing: 'synthArp'
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
const QUIET_SOUNDS = new Set<SoundName>([
  'message',
  'constellationMessage',
  'friendRequest',
  'friendOnline'
])

/** 0–100 from Settings → 0–1 for an audio element (older saved settings have no volume yet). */
const level = (percent: number | undefined): number =>
  Math.min(1, Math.max(0, (percent ?? 100) / 100))

/** How loud a sound plays: the overall Volume, and for ringing sounds the ringing volume too. */
export function volumeFor(name: SoundName): number {
  const overall = level(settings.volume)
  return name === 'ringtone' || name === 'outgoing' ? overall * level(settings.callVolume) : overall
}

/** Plays the sound picked for this moment, unless sounds are off or you're in Do not disturb. */
export function playSound(name: SoundName): void {
  if (!settings.enabled || (quiet && settings.dndSilence)) return
  // 0.7.3 quiet hours: nothing that arrives makes a sound (your own actions still do).
  if (QUIET_SOUNDS.has(name) && inQuiet()) return
  // Settings saved before 0.7.0 have no constellation sound yet: Lantern.
  const choice = settings[name] ?? (name === 'constellationMessage' ? 'skyLantern' : undefined)
  if (!choice || choice === 'none' || !(choice in SOUND_FILES)) return
  // A burst of messages makes one sound, not a pile-up.
  const now = Date.now()
  if (now - (lastPlayed.get(name) ?? 0) < 800) return
  lastPlayed.set(name, now)
  const volume = volumeFor(name)
  if (volume === 0) return
  const audio = new Audio(SOUND_FILES[choice].url)
  audio.volume = volume
  void audio.play().catch(() => {
    // The computer has no sound device, or it's busy: nothing to do.
  })
}

/**
 * Plays a call sound over and over (the ringtone, or the outgoing sound while you wait for
 * someone to answer) until the returned function is called. Silent if sounds are off or you're
 * in Do not disturb.
 */
export function startLoop(name: 'ringtone' | 'outgoing'): () => void {
  if (!settings.enabled || (quiet && settings.dndSilence)) return () => {}
  if (name === 'ringtone' && inQuiet(true)) return () => {}
  const choice = settings[name]
  if (!choice || choice === 'none' || !(choice in SOUND_FILES)) return () => {}
  return loopSound(choice as SoundFile, volumeFor(name))
}

let audioContext: AudioContext | null = null
const decoded = new Map<string, Promise<AudioBuffer>>()

// Browsers keep a page's sound off until it has been tapped, clicked or typed in once. The
// ringtone used to wait for that tap, so a call to a chat.glofly.app tab nobody had touched yet
// rang silently. Now the first touch for any reason (signing in, opening a chat) switches sound
// on for good, so later rings play. Electron never blocks, so this changes nothing there.
const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown'] as const
function unlockSound(): void {
  try {
    audioContext ??= new AudioContext()
    void audioContext.resume().then(
      () => {
        if (audioContext?.state !== 'running') return
        for (const e of UNLOCK_EVENTS) document.removeEventListener(e, unlockSound, true)
      },
      () => {}
    )
  } catch {
    // No sound device: nothing to unlock.
  }
}
if (typeof document !== 'undefined') {
  for (const e of UNLOCK_EVENTS) document.addEventListener(e, unlockSound, { capture: true, passive: true })
}

/**
 * Can a ringtone be heard right now? False only in a browser tab that hasn't been touched yet
 * (then the incoming call also shows a system notification, which makes the device's own sound).
 */
export function soundCanPlay(): boolean {
  if (audioContext?.state === 'running') return true
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation
  return activation ? activation.hasBeenActive : true
}

/** Web Audio, decoded once per file (used for loops, which need to be gapless). */
function bufferOf(url: string): Promise<AudioBuffer> {
  audioContext ??= new AudioContext()
  const ctx = audioContext
  let p = decoded.get(url)
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
    p.catch(() => decoded.delete(url))
    decoded.set(url, p)
  }
  return p
}

/**
 * Loops one sound until the returned function is called. Sounds made as a loop cycle repeat
 * exactly at their cycle length (no gap from the file's own padding); Chip's original long
 * recordings simply start over at the end.
 */
function loopSound(file: SoundFile, volume: number): () => void {
  const info = SOUND_FILES[file]
  let stopped = false
  let source: AudioBufferSourceNode | null = null
  void bufferOf(info.url)
    .then(async (buffer) => {
      if (stopped || !audioContext) return
      if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {})
      const gain = audioContext.createGain()
      gain.gain.value = volume
      gain.connect(audioContext.destination)
      source = audioContext.createBufferSource()
      source.buffer = buffer
      source.loop = true
      if (info.loop && info.loop < buffer.duration) {
        source.loopStart = 0
        source.loopEnd = info.loop
      }
      source.connect(gain)
      source.start()
    })
    .catch(() => {
      // No sound device, or the file couldn't be read: nothing to do.
    })
  return () => {
    if (stopped) return
    stopped = true
    try {
      source?.stop()
    } catch {
      // Not started yet.
    }
  }
}

/**
 * "No answer": plays once when your call rings out with nobody picking up. It's always the
 * same sound (Dim; not a setting), and it follows mute, Do not disturb and the volume.
 */
export function playNoAnswer(): void {
  if (!settings.enabled || (quiet && settings.dndSilence)) return
  const volume = level(settings.volume)
  if (volume === 0) return
  const audio = new Audio(noAnswerFile)
  audio.volume = volume
  void audio.play().catch(() => {})
}

// ---------------------------------------------------------------------------------------
// Previews in Settings: press Play to hear a sound (even if sounds are muted), press again
// to stop. Only one preview plays at a time.

let preview: HTMLAudioElement | null = null
let previewStop: (() => void) | null = null
let previewDone: (() => void) | null = null

export function stopPreview(): void {
  preview?.pause()
  preview = null
  previewStop?.()
  previewStop = null
  previewDone?.()
  previewDone = null
}

/**
 * Plays a sound from the library at the given volume (0–1, from the Volume sliders);
 * onEnd runs when it finishes or is stopped.
 */
export function previewSound(file: SoundFile, onEnd: () => void, volume = 1): void {
  stopPreview()
  // A ringing sound made as a loop cycle is only a few seconds: let it ring three times.
  const info = SOUND_FILES[file]
  if (info.loop) {
    const stop = loopSound(file, Math.min(1, Math.max(0, volume)))
    const timer = setTimeout(() => stopPreview(), info.loop * 3 * 1000)
    previewStop = () => {
      clearTimeout(timer)
      stop()
    }
    previewDone = onEnd
    return
  }
  const audio = new Audio(SOUND_FILES[file].url)
  audio.volume = Math.min(1, Math.max(0, volume))
  preview = audio
  previewDone = onEnd
  audio.addEventListener('ended', () => {
    if (preview === audio) stopPreview()
  })
  void audio.play().catch(() => stopPreview())
}

// ---------------------------------------------------------------------------------------
// Push to talk (Settings → Voice & video): a short sound when the key goes down and a softer
// one when you let go (tools/sounds/ptt.py). Only you hear them. They follow mute, Do not
// disturb and the volume; decoded ahead of time so they play the instant the key moves.

export type PttSound = 'firefly' | 'blink' | 'pluck' | 'bell' | 'glass' | 'radio' | 'tap' | 'spark'

export const PTT_SOUNDS: Record<PttSound, { label: string; down: string; up: string }> = {
  firefly: { label: 'Firefly', down: pttFireflyDownFile, up: pttFireflyUpFile },
  blink: { label: 'Blink', down: pttBlinkDownFile, up: pttBlinkUpFile },
  pluck: { label: 'Pluck', down: pttPluckDownFile, up: pttPluckUpFile },
  bell: { label: 'Bell', down: pttBellDownFile, up: pttBellUpFile },
  glass: { label: 'Glass', down: pttGlassDownFile, up: pttGlassUpFile },
  radio: { label: 'Radio', down: pttRadioDownFile, up: pttRadioUpFile },
  tap: { label: 'Tap', down: pttTapDownFile, up: pttTapUpFile },
  spark: { label: 'Spark', down: pttSparkDownFile, up: pttSparkUpFile }
}

export const isPttSound = (v: unknown): v is PttSound => typeof v === 'string' && v in PTT_SOUNDS

/** Decodes a push-to-talk pair ahead of time (when push to talk starts). */
export function preloadPtt(name: PttSound | 'none'): void {
  if (name === 'none') return
  void bufferOf(PTT_SOUNDS[name].down).catch(() => {})
  void bufferOf(PTT_SOUNDS[name].up).catch(() => {})
}

/** The push-to-talk key went down ('down') or came up ('up'). `preview` ignores mute. */
export function playPtt(name: PttSound | 'none', which: 'down' | 'up', preview = false): void {
  if (name === 'none') return
  if (!preview && (!settings.enabled || (quiet && settings.dndSilence))) return
  const volume = level(settings.volume)
  if (volume === 0) return
  void bufferOf(PTT_SOUNDS[name][which])
    .then(async (buffer) => {
      if (!audioContext) return
      if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {})
      const gain = audioContext.createGain()
      gain.gain.value = volume
      gain.connect(audioContext.destination)
      const source = audioContext.createBufferSource()
      source.buffer = buffer
      source.connect(gain)
      source.start()
    })
    .catch(() => {})
}

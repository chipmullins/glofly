import { Platform } from 'react-native'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import * as Native from 'glofly-native'
import { phoneMessageSound, phoneRingtone } from '@glofly/shared'
import { usePhonePrefs } from '@/state/prefs'

// Glofly's sounds inside the app (the same files as the desktop app): the message chime, the
// call sounds, and the looping ringtone / outgoing jingle.

// The message sounds and ringtones you can pick (@glofly/shared PHONE_MESSAGE_SOUNDS / PHONE_RINGTONES).
// Metro needs each file named here; scripts/phone-sounds.mjs copies them from the desktop app.
const MESSAGE_FILES: Record<string, number> = {
  chime: require('../../assets/sounds/message.ogg'),
  dewdrop: require('../../assets/sounds/dewdrop.ogg'),
  pebble: require('../../assets/sounds/pebble.ogg'),
  pluck: require('../../assets/sounds/pluck.ogg'),
  sparkTrail: require('../../assets/sounds/spark-trail.ogg'),
  starfall: require('../../assets/sounds/starfall.ogg'),
  fade: require('../../assets/sounds/fade.ogg'),
  glowOn: require('../../assets/sounds/glow-on.ogg'),
  blinkIn: require('../../assets/sounds/blink-in.ogg'),
  hello: require('../../assets/sounds/login.ogg'),
}
const RINGTONE_FILES: Record<string, number> = {
  fireflyDance: require('../../assets/sounds/ring-in-firefly.ogg'),
  glowBells: require('../../assets/sounds/ring-in-glowbells.ogg'),
  marimbaRing: require('../../assets/sounds/ring-in-marimba.ogg'),
  kalimbaRing: require('../../assets/sounds/ring-in-kalimba.ogg'),
  glassChimes: require('../../assets/sounds/ring-in-glass.ogg'),
  classic: require('../../assets/sounds/ring-in-classic.ogg'),
  electro: require('../../assets/sounds/ring-in-electro.ogg'),
  chiptune: require('../../assets/sounds/ring-in-chiptune.ogg'),
  groove: require('../../assets/sounds/ring-in-groove.ogg'),
  steelDrums: require('../../assets/sounds/ring-in-steel.ogg'),
  vibesRing: require('../../assets/sounds/ring-in-vibes.ogg'),
  digitalBells: require('../../assets/sounds/ring-in-fmbells.ogg'),
  ring: require('../../assets/sounds/ringtone.ogg'),
}

const FILES = {
  message: MESSAGE_FILES.chime,
  ringtone: RINGTONE_FILES.fireflyDance,
  outgoing: require('../../assets/sounds/ring-out-synth-arp.ogg'),
  connected: require('../../assets/sounds/glow-on.ogg'),
  ended: require('../../assets/sounds/glow-off.ogg'),
  noAnswer: require('../../assets/sounds/no-answer.ogg'),
  joined: require('../../assets/sounds/blink-in.ogg'),
  left: require('../../assets/sounds/blink-out.ogg'),
} as const

export type SoundName = keyof typeof FILES

const players = new Map<string, AudioPlayer>()
let modeSet = false

// iPhone: call sounds play natively (glofly-native's CallTones), never through expo-audio. iPhone
// has one audio session for the whole app; expo-audio switching it while a call starts took the
// microphone and speaker away from the call (no audio when an iPhone called out). The message
// chime too, since a message can arrive mid-call.
const NATIVE_ON_IPHONE: ReadonlySet<SoundName> = new Set(['message', 'ringtone', 'outgoing', 'connected', 'ended', 'noAnswer', 'joined', 'left'])
const iphoneTone = (name: SoundName) => Platform.OS === 'ios' && NATIVE_ON_IPHONE.has(name)

/** The file for a sound: the message sound and ringtone are the ones picked in Settings. */
function fileFor(name: SoundName): { key: string; file: number } {
  const p = usePhonePrefs.getState()
  if (name === 'message') {
    const id = phoneMessageSound(p.messageSound).id
    return { key: `message:${id}`, file: MESSAGE_FILES[id] ?? FILES.message }
  }
  if (name === 'ringtone') {
    const id = phoneRingtone(p.ringtone).id
    return { key: `ringtone:${id}`, file: RINGTONE_FILES[id] ?? FILES.ringtone }
  }
  return { key: name, file: FILES[name] }
}

function playerFor(key: string, file: number): AudioPlayer | null {
  try {
    if (!modeSet) {
      modeSet = true
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {})
    }
    let p = players.get(key)
    if (!p) {
      p = createAudioPlayer(file)
      players.set(key, p)
    }
    return p
  } catch {
    return null
  }
}

function player(name: SoundName): AudioPlayer | null {
  const { key, file } = fileFor(name)
  return playerFor(key, file)
}

/**
 * Settings: plays a message sound or ringtone so you can hear it before picking it. iPhone plays it
 * natively (after setSounds), like every other Glofly sound there.
 */
export function previewSound(kind: 'message' | 'ringtone', id: string): void {
  if (Platform.OS === 'ios' && Native.playCallTone(kind, false, 1)) return
  const file = kind === 'message' ? MESSAGE_FILES[id] : RINGTONE_FILES[id]
  if (!file) return
  stopPreview()
  const p = playerFor(`${kind}:${id}`, file)
  if (!p) return
  try {
    p.loop = false
    p.volume = 1
    void p.seekTo(0).then(() => p.play())
    previewing = p
  } catch {
    /* sound unavailable: fine */
  }
}

let previewing: AudioPlayer | null = null
export function stopPreview(): void {
  if (Platform.OS === 'ios') Native.stopCallTone()
  try {
    previewing?.pause()
  } catch {
    /* gone */
  }
  previewing = null
}

export function playSound(name: SoundName, volume = 1): void {
  if (iphoneTone(name) && Native.playCallTone(name, false, volume)) return
  const p = player(name)
  if (!p) return
  try {
    p.loop = false
    p.volume = volume
    void p.seekTo(0).then(() => p.play())
  } catch {
    /* sound unavailable: fine */
  }
}

/** Plays a sound on repeat until the returned stop function is called. */
export function startLoop(name: SoundName): () => void {
  if (iphoneTone(name) && Native.playCallTone(name, true, 1)) return () => Native.stopCallTone()
  const p = player(name)
  if (!p) return () => {}
  try {
    p.loop = true
    p.volume = 1
    void p.seekTo(0).then(() => p.play())
  } catch {
    return () => {}
  }
  return () => {
    try {
      p.pause()
      p.loop = false
    } catch {
      /* already gone */
    }
  }
}

export function vibrate(): void {
  if (Platform.OS === 'web') return
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

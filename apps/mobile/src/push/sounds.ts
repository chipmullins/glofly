import { Platform } from 'react-native'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import * as Native from 'glofly-native'
import { phoneConstellationSound, phoneMessageSound, phoneRingtone } from '@glofly/shared'
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
  comet: require('../../assets/sounds/comet.ogg'),
  lowComet: require('../../assets/sounds/low-comet.ogg'),
  twinStars: require('../../assets/sounds/twin-stars.ogg'),
  constellation: require('../../assets/sounds/constellation.ogg'),
  nebula: require('../../assets/sounds/nebula.ogg'),
  starlightPing: require('../../assets/sounds/starlight-ping.ogg'),
  moonrise: require('../../assets/sounds/moonrise.ogg'),
  hollowWood: require('../../assets/sounds/hollow-wood.ogg'),
  nightBreeze: require('../../assets/sounds/night-breeze.ogg'),
  ember: require('../../assets/sounds/ember.ogg'),
  orbit: require('../../assets/sounds/orbit.ogg'),
  stardust: require('../../assets/sounds/stardust.ogg'),
  aurora: require('../../assets/sounds/aurora.ogg'),
  skyLantern: require('../../assets/sounds/sky-lantern.ogg'),
  deepSpace: require('../../assets/sounds/deep-space.ogg'),
  // Oct 30, 2026: the message sounds (Mm-hm is the default; the ones above stay for constellations).
  mmHm: require('../../assets/sounds/msg-mmhm.ogg'),
  nudge: require('../../assets/sounds/msg-nudge.ogg'),
  tapShoulder: require('../../assets/sounds/msg-tap-shoulder.ogg'),
  heyHum: require('../../assets/sounds/msg-hey-hum.ogg'),
  brightGlow: require('../../assets/sounds/msg-bright-glow.ogg'),
  doubleNudge: require('../../assets/sounds/msg-double-nudge.ogg'),
  callOut: require('../../assets/sounds/msg-call-out.ogg'),
  lanternUp: require('../../assets/sounds/msg-lantern-up.ogg'),
  mmHmQ: require('../../assets/sounds/msg-mmhm-q.ogg'),
  starNudge: require('../../assets/sounds/msg-star-nudge.ogg'),
  ripple: require('../../assets/sounds/msg-ripple.ogg'),
}
// Oct 29, 2026: the call sounds are Chip's picks (tools/sounds/defaults2026.py). The older ringtones
// stay in assets/sounds (and natively), just not offered (@glofly/shared RETIRED_PHONE_RINGTONES).
const RINGTONE_FILES: Record<string, number> = {
  doowop: require('../../assets/sounds/ring-in-doowop.ogg'),
}

const FILES = {
  message: MESSAGE_FILES.mmHm,
  constellation: MESSAGE_FILES.skyLantern,
  ringtone: RINGTONE_FILES.doowop,
  outgoing: require('../../assets/sounds/ring-out-hum.ogg'),
  connected: require('../../assets/sounds/whistle-up.ogg'),
  ended: require('../../assets/sounds/whistle-down.ogg'),
  noAnswer: require('../../assets/sounds/no-answer.ogg'),
  joined: require('../../assets/sounds/bubble-in.ogg'),
  left: require('../../assets/sounds/bubble-out.ogg'),
} as const

export type SoundName = keyof typeof FILES

/** The constellation message sound picked in Settings (Lantern unless changed). */
function constellationSound() {
  return phoneConstellationSound(usePhonePrefs.getState().constellationSound)
}

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
  if (name === 'constellation') {
    const id = constellationSound().id
    return { key: `message:${id}`, file: MESSAGE_FILES[id] ?? FILES.constellation }
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
export function previewSound(kind: 'message' | 'ringtone' | 'constellation', id: string): void {
  if (Platform.OS === 'ios') {
    stopPreview()
    // The constellation sound by its file name (0.7.0 builds); the others are the picked ones (after setSounds).
    const name = kind === 'constellation' ? phoneConstellationSound(id).native : kind
    if (Native.playCallTone(name, false, 1)) return
  }
  const file = kind === 'ringtone' ? RINGTONE_FILES[id] : MESSAGE_FILES[id]
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
  if (name === 'constellation' && Platform.OS === 'ios') {
    // iPhone plays it natively by its file name (0.7.0 builds); older builds play the message sound.
    if (Native.playCallTone(constellationSound().native, false, volume)) return
    if (Native.playCallTone('message', false, volume)) return
  }
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

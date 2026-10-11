import { Platform } from 'react-native'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'

// Glofly's sounds inside the app (the same files as the desktop app): the message chime, the
// call sounds, and the looping ringtone / outgoing jingle.

const FILES = {
  message: require('../../assets/sounds/message.ogg'),
  ringtone: require('../../assets/sounds/ring-in-firefly.ogg'),
  outgoing: require('../../assets/sounds/ring-out-synth-arp.ogg'),
  connected: require('../../assets/sounds/glow-on.ogg'),
  ended: require('../../assets/sounds/glow-off.ogg'),
  noAnswer: require('../../assets/sounds/no-answer.ogg'),
  joined: require('../../assets/sounds/blink-in.ogg'),
  left: require('../../assets/sounds/blink-out.ogg'),
} as const

export type SoundName = keyof typeof FILES

const players = new Map<SoundName, AudioPlayer>()
let modeSet = false

function player(name: SoundName): AudioPlayer | null {
  try {
    if (!modeSet) {
      modeSet = true
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {})
    }
    let p = players.get(name)
    if (!p) {
      p = createAudioPlayer(FILES[name])
      players.set(name, p)
    }
    return p
  } catch {
    return null
  }
}

export function playSound(name: SoundName, volume = 1): void {
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

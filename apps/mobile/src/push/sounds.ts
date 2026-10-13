import { Platform } from 'react-native'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import * as Native from 'glofly-native'

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

// iPhone: call sounds play natively (glofly-native's CallTones), never through expo-audio. iPhone
// has one audio session for the whole app; expo-audio switching it while a call starts took the
// microphone and speaker away from the call (no audio when an iPhone called out). The message
// chime too, since a message can arrive mid-call.
const NATIVE_ON_IPHONE: ReadonlySet<SoundName> = new Set(['message', 'ringtone', 'outgoing', 'connected', 'ended', 'noAnswer', 'joined', 'left'])
const iphoneTone = (name: SoundName) => Platform.OS === 'ios' && NATIVE_ON_IPHONE.has(name)

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

import { useMemo } from 'react'
import { AppState, Platform, type ViewStyle } from 'react-native'
import {
  AndroidAudioTypePresets,
  AudioDeviceModule,
  AudioSession,
  VideoTrack as LKVideoTrack,
  type VideoTrackProps,
  registerGlobals,
  setupIOSAudioManagement,
  type AppleAudioCategoryOption,
  type AppleAudioConfiguration,
} from '@livekit/react-native'
import { AudioEngineAvailability, RTCAudioSession } from '@livekit/react-native-webrtc'
import type { VideoTrack } from 'livekit-client'
import * as Native from 'glofly-native'
import { reportError } from '@/lib/errorReports'

// LiveKit on phones: WebRTC comes from @livekit/react-native-webrtc, audio routing from
// LiveKit's AudioSession. (media.web.tsx is the browser preview's version.)

let registered = false
export function setupWebRTC() {
  if (registered) return
  registered = true
  registerGlobals()
}

/**
 * Starts the call audio session. Every call starts on the speaker (Bluetooth or headphones first
 * when connected); the Audio button switches to the earpiece. iPhone voice calls used to start on
 * the earpiece; since Oct 13 they start on the speaker too (CallSpeaker.swift keeps the output off
 * the earpiece without touching the policy below, so the Audio button can still pick "Phone").
 *
 * iPhone: LiveKit v3 runs iOS's audio session by itself, following the call's audio engine
 * (registerGlobals sets that up). Glofly used to also switch the session on by hand
 * (startAudioSession before the engine existed, stopAudioSession while it was still running),
 * so two owners fought over it. And LiveKit's default policy changes the session's whole
 * category (playback ↔ play + record) whenever the engine goes between "only listening" and
 * "listening + talking" — which happens right as a call connects (the other person's voice
 * arrives before your mic is on) and when you mute. Now Glofly hands LiveKit one fixed policy:
 * play + record the whole call, so the category never flips mid-call, and the mic input is kept
 * ready so the engine starts in its final shape instead of restarting a second in.
 */
export async function startCallAudio(video: boolean): Promise<void> {
  if (Platform.OS === 'ios') {
    if (prepTimer) clearTimeout(prepTimer)
    prepTimer = null
    // Oct 29: no longer "mixWithOthers". A call is the main audio (like FaceTime: other apps'
    // sound pauses), and a mixable session is one iOS can decline to switch on for a CallKit call
    // while another app holds the audio (TikTok): silent both ways.
    const base: AppleAudioCategoryOption[] = ['allowBluetooth', 'allowBluetoothA2DP', 'allowAirPlay']
    const options: AppleAudioCategoryOption[] = video ? [...base, 'defaultToSpeaker'] : base
    const duplex: AppleAudioConfiguration = { audioCategory: 'playAndRecord', audioCategoryOptions: options, audioMode: video ? 'videoChat' : 'voiceChat' }
    inCallAudio = true
    setupIOSAudioManagement(video, {
      recording: duplex,
      recordingWithoutVoiceProcessing: { ...duplex, audioMode: 'default' },
      playout: duplex,
      deactivateOnStop: true,
    })
    await AudioDeviceModule.setRecordingAlwaysPreparedMode(true).catch(() => {})
    // Builds before Oct 13 don't have CallSpeaker: video still starts on the speaker (the policy's
    // defaultToSpeaker) and voice on the earpiece, as before.
    Native.keepCallOnSpeaker(true)
    return
  }
  await AudioSession.configureAudio({
    android: {
      preferredOutputList: ['bluetooth', 'headset', 'speaker'],
      audioTypeOptions: AndroidAudioTypePresets.communication,
    },
    ios: { defaultOutput: video ? 'speaker' : 'earpiece' },
  })
  await AudioSession.startAudioSession()
}

// ---- iPhone lock-screen calls (CallKit) ----
// Oct 29 (silent call answered from the banner over TikTok; Control → Errors: "iOS never switched
// the audio on"): iOS switches a CallKit call's audio on with the category the app has at the moment
// of Answer, and that was whatever was left over (a previous call's mixable session, playback after
// a voice message or a broadcast). Builds from Oct 29 set a call's category natively on Answer
// (CallKit.swift prepareCallAudioSession); for every build, the app also leaves a call-shaped
// category in place between calls (not switched on, so other apps are unaffected).

const IDLE_CALL_SHAPE: AppleAudioConfiguration = { audioCategory: 'playAndRecord', audioCategoryOptions: ['allowBluetooth', 'allowBluetoothA2DP', 'allowAirPlay'], audioMode: 'voiceChat' }
let prepTimer: ReturnType<typeof setTimeout> | null = null
let inCallAudio = false
/** Watching a broadcast (playback session): never reshaped from under it. */
let watchingAudio = false

/** Leave a call-shaped (inactive) audio category in place, ready for the next lock-screen answer. */
export function prepareForCallKit(delayMs = 0): void {
  if (Platform.OS !== 'ios') return
  if (prepTimer) clearTimeout(prepTimer)
  prepTimer = setTimeout(() => {
    prepTimer = null
    if (inCallAudio || watchingAudio) return
    void AudioSession.setAppleAudioConfiguration(IDLE_CALL_SHAPE).catch(() => {})
  }, delayMs)
}

let watchingAppState = false
/** At start: prepare now, and again whenever Glofly goes to the background outside a call. */
export function watchIdleAudioShape(): void {
  if (Platform.OS !== 'ios' || watchingAppState) return
  watchingAppState = true
  prepareForCallKit()
  AppState.addEventListener('change', (state) => {
    if (state === 'background') prepareForCallKit()
  })
}
// A call answered on iOS's own call screen belongs to CallKit, and iOS switches the audio session
// on for it by itself, a moment after Answer (CallKit.swift didActivate → "callAudio"). If the
// call connected before that, LiveKit's audio engine started on a session iOS then took over, and
// nobody heard anything until the call was redialed (hit or miss: it depended on which came
// first). So while a CallKit call connects, the engine is held off (no input, no output) and let
// go once iOS says the audio is on. This is LiveKit's documented CallKit pattern.

/** Never hold longer than this: if iOS doesn't say, the call goes ahead rather than stay silent. */
const CALLKIT_AUDIO_WAIT_MS = 4000
let heldForCallKit = false
let holdTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Before connecting a call answered through CallKit. Does nothing when iOS has already switched
 * the audio on, on Android, and on iPhone builds without the native part (callKitAudioActive null).
 * Returns what happened, for the call diagnostics.
 */
export async function holdAudioForCallKit(): Promise<string> {
  if (Platform.OS !== 'ios') return 'not iPhone'
  const active = Native.callKitAudioActive()
  if (active === null) return 'not in this build'
  if (active) {
    // iOS switched it on before the app got here: tell LiveKit, or it tries to switch the session
    // on again itself (from the background, which iOS can refuse).
    try {
      RTCAudioSession.audioSessionDidActivate()
    } catch {
      // older build
    }
    return 'already on'
  }
  heldForCallKit = true
  await AudioDeviceModule.setEngineAvailability(AudioEngineAvailability.none).catch(() => {})
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = setTimeout(() => {
    // iOS never said the audio was on: go ahead anyway, and tell Control (a likely silent call).
    // Opening Glofly then gets the sound going (kickStuckAudio, from the foreground).
    stuckSinceCallKit = true
    reportError({ message: `Call: iPhone lock-screen answer, iOS never switched the audio on (went ahead after 4 s; app ${AppState.currentState})` }, 'call')
    void releaseAudioForCallKit()
  }, CALLKIT_AUDIO_WAIT_MS)
  return 'held until iOS switches audio on'
}

/** Lets the engine run again (iOS switched the audio on, the wait ran out, or the call ended). */
export async function releaseAudioForCallKit(): Promise<boolean> {
  if (holdTimer) clearTimeout(holdTimer)
  holdTimer = null
  if (!heldForCallKit) return false
  heldForCallKit = false
  await AudioDeviceModule.setEngineAvailability(AudioEngineAvailability.default).catch(() => {})
  return true
}

/** CallKit switched the call's audio on or off (the "callAudio" native event). */
export async function onCallKitAudio(active: boolean): Promise<void> {
  if (Platform.OS !== 'ios') return
  try {
    if (active) RTCAudioSession.audioSessionDidActivate()
    else RTCAudioSession.audioSessionDidDeactivate()
  } catch {
    // an older build: nothing to tell
  }
  if (active) await releaseAudioForCallKit()
}

/**
 * The CallKit wait ran out (iOS never switched the audio on), so the engine may have failed to
 * start from the background. When Glofly comes to the front during that call and nothing is
 * playing, restart the engine: in the foreground the app can switch the audio on itself.
 * Returns whether it restarted.
 */
let stuckSinceCallKit = false
export async function kickStuckAudio(): Promise<boolean> {
  if (Platform.OS !== 'ios' || !stuckSinceCallKit) return false
  if (audioEnginePlaying() === true) {
    stuckSinceCallKit = false
    return false
  }
  stuckSinceCallKit = false
  await AudioDeviceModule.setEngineAvailability(AudioEngineAvailability.none).catch(() => {})
  await AudioDeviceModule.setEngineAvailability(AudioEngineAvailability.default).catch(() => {})
  return true
}

/** Call diagnostics: whether the engine is waiting on CallKit. */
export function callKitAudioInfo(): Record<string, string> {
  if (Platform.OS !== 'ios') return {}
  const active = Native.callKitAudioActive()
  return { 'callkit audio': active === null ? 'n/a (older build)' : active ? 'on' : 'off', 'engine held for callkit': String(heldForCallKit) }
}

export async function stopCallAudio(): Promise<void> {
  if (Platform.OS === 'ios') {
    inCallAudio = false
    stuckSinceCallKit = false
    // Never leave the engine held after a call (the next call would be silent).
    await releaseAudioForCallKit()
    // Once LiveKit has let the session go: back to a call shape for the next lock-screen answer.
    prepareForCallKit(2000)
    // LiveKit lets the session go once the engine stops (deactivateOnStop).
    Native.stopCallSpeaker()
    await AudioDeviceModule.setRecordingAlwaysPreparedMode(false).catch(() => {})
    return
  }
  await AudioSession.stopAudioSession().catch(() => {})
}

/**
 * 0.5.0 watching a friend's broadcast: listening only, like a video (the speaker, Bluetooth or
 * headphones; never the earpiece, and the microphone is never touched).
 */
export async function startWatchAudio(): Promise<void> {
  if (Platform.OS === 'ios') {
    watchingAudio = true
    const listen: AppleAudioConfiguration = { audioCategory: 'playback', audioCategoryOptions: ['mixWithOthers', 'allowAirPlay'], audioMode: 'moviePlayback' }
    setupIOSAudioManagement(false, { recording: listen, recordingWithoutVoiceProcessing: listen, playout: listen, deactivateOnStop: true })
    return
  }
  await AudioSession.configureAudio({
    android: { preferredOutputList: ['bluetooth', 'headset', 'speaker'], audioTypeOptions: AndroidAudioTypePresets.media },
  })
  await AudioSession.startAudioSession()
}

export async function stopWatchAudio(): Promise<void> {
  if (Platform.OS === 'ios') {
    // LiveKit lets the session go when the engine stops; then back to a call shape.
    watchingAudio = false
    prepareForCallKit(2000)
    return
  }
  await AudioSession.stopAudioSession().catch(() => {})
}

/** iPhone: whether the call's audio engine is playing sound. Null elsewhere (or if it can't say). */
export function audioEnginePlaying(): boolean | null {
  if (Platform.OS !== 'ios') return null
  try {
    return AudioDeviceModule.isPlaying()
  } catch {
    return null
  }
}

/** Call diagnostics: what LiveKit's audio engine is doing (iPhone only; empty elsewhere). */
export function audioEngineInfo(): Record<string, string> {
  if (Platform.OS !== 'ios') return {}
  const read = (f: () => unknown) => {
    try {
      return String(f())
    } catch (e) {
      return `error: ${(e as Error)?.message ?? e}`
    }
  }
  return {
    'engine running': read(() => AudioDeviceModule.isEngineRunning()),
    playing: read(() => AudioDeviceModule.isPlaying()),
    recording: read(() => AudioDeviceModule.isRecording()),
    'voice processing': read(() => AudioDeviceModule.isVoiceProcessingEnabled()),
    'mic muted (engine)': read(() => AudioDeviceModule.isMicrophoneMuted()),
    'mute mode': read(() => AudioDeviceModule.getMuteMode()),
    'mic kept ready': read(() => AudioDeviceModule.isRecordingAlwaysPreparedMode()),
  }
}

export type AudioRoute = 'speaker' | 'earpiece' | 'headset' | 'bluetooth'

export async function audioRoutes(): Promise<AudioRoute[]> {
  // iPhone: LiveKit only offers "default" / "force_speaker"; Bluetooth and headphones are picked in
  // iOS's own route picker.
  if (Platform.OS === 'ios') return ['earpiece', 'speaker', 'bluetooth']
  try {
    return (await AudioSession.getAudioOutputs()) as AudioRoute[]
  } catch {
    return []
  }
}

export async function selectAudioRoute(route: AudioRoute): Promise<void> {
  if (Platform.OS === 'ios') {
    if (route === 'bluetooth' || route === 'headset') {
      // iOS's own picker; if they pick the iPhone itself there, iOS decides speaker vs earpiece.
      Native.keepCallOnSpeaker(false)
      await AudioSession.showAudioRoutePicker().catch(() => {})
    } else if (!Native.keepCallOnSpeaker(route === 'speaker')) {
      await AudioSession.selectAudioOutput(route === 'speaker' ? 'force_speaker' : 'default').catch(() => {})
    }
    return
  }
  await AudioSession.selectAudioOutput(route).catch(() => {})
}

/** Where the call is playing right now (iPhone builds from Oct 13; null when unknown). */
export function currentAudioRoute(): AudioRoute | null {
  if (Platform.OS !== 'ios') return null
  const r = Native.callAudioRoute()
  if (r === 'speaker' || r === 'earpiece' || r === 'headset' || r === 'bluetooth') return r
  if (r === 'car' || r === 'airplay') return 'bluetooth'
  return null
}

/**
 * `pip` (iPhone): this video goes into iOS's floating window when you leave Glofly mid-call
 * (`shape` is its rough width:height). Only one view on screen should have it. Android's floating
 * window is the whole app (CallPip.tsx), so `pip` does nothing there.
 */
export function CallVideo({ track, style, mirror, contain, zOrder, pip, shape }: { track: VideoTrack; style?: ViewStyle; mirror?: boolean; contain?: boolean; zOrder?: number; pip?: boolean; shape?: [number, number] }) {
  // LiveKit's newer VideoTrack view is the one with picture-in-picture. It reads only the
  // publication's track and id from the reference, so a small stand-in is enough.
  const trackRef = useMemo(() => ({ publication: { track, trackSid: track.sid } }) as unknown as VideoTrackProps['trackRef'], [track])
  const w = shape?.[0] ?? 9
  const h = shape?.[1] ?? 16
  // 0.8.3: every video uses the same view, and on iPhone always the picture-in-picture kind, with
  // PiP just switched on or off. Before, a tile switched between two different views when it
  // gained or lost PiP (which follows whoever is talking), so the video went black for a moment
  // each time the speaker changed in a group call: the flicker.
  return (
    <LKVideoTrack
      // A different track (camera turned off and on again) gets a fresh view; the same one never does.
      key={track.sid ?? 'local'}
      trackRef={trackRef}
      style={style}
      mirror={mirror}
      objectFit={contain ? 'contain' : 'cover'}
      zOrder={zOrder}
      iosPIP={Platform.OS === 'ios' ? { enabled: !!pip, startAutomatically: !!pip, preferredSize: { width: w, height: h } } : undefined}
    />
  )
}

/**
 * Watch Together during a call (iPhone). The call runs iOS's voice processing (the echo
 * canceller), which turns every other sound way down while it's on ("ducking") — including the
 * YouTube video in the web view, which plays outside the call's audio engine. That's why the
 * video seemed to have no sound on iPhone. While a video is on, duck it as little as iOS allows,
 * and only while someone is talking; back to normal when the video stops. Uses calls that are
 * already in the app's LiveKit WebRTC build (no new native code). Android has no ducking here.
 */
let duckingBefore: { level: number; advanced: boolean } | null = null
export function setWatchDucking(watching: boolean): void {
  if (Platform.OS !== 'ios') return
  try {
    if (watching && !duckingBefore) {
      duckingBefore = { level: AudioDeviceModule.getDuckingLevel(), advanced: AudioDeviceModule.isAdvancedDuckingEnabled() }
      AudioDeviceModule.setAdvancedDuckingEnabled(true)
      AudioDeviceModule.setDuckingLevel(10) // AVAudioVoiceProcessingOtherAudioDuckingLevel.min
    } else if (!watching && duckingBefore) {
      AudioDeviceModule.setDuckingLevel(duckingBefore.level)
      AudioDeviceModule.setAdvancedDuckingEnabled(duckingBefore.advanced)
      duckingBefore = null
    }
  } catch {
    // an older build without these calls: nothing to change
  }
}

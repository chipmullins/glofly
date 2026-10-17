import { useMemo } from 'react'
import { Platform, type ViewStyle } from 'react-native'
import {
  AndroidAudioTypePresets,
  AudioDeviceModule,
  AudioSession,
  VideoTrack as LKVideoTrack,
  VideoView,
  type VideoTrackProps,
  registerGlobals,
  setupIOSAudioManagement,
  type AppleAudioCategoryOption,
  type AppleAudioConfiguration,
} from '@livekit/react-native'
import type { VideoTrack } from 'livekit-client'
import * as Native from 'glofly-native'

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
    const base: AppleAudioCategoryOption[] = ['mixWithOthers', 'allowBluetooth', 'allowBluetoothA2DP', 'allowAirPlay']
    const options: AppleAudioCategoryOption[] = video ? [...base, 'defaultToSpeaker'] : base
    const duplex: AppleAudioConfiguration = { audioCategory: 'playAndRecord', audioCategoryOptions: options, audioMode: video ? 'videoChat' : 'voiceChat' }
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

export async function stopCallAudio(): Promise<void> {
  if (Platform.OS === 'ios') {
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
  if (Platform.OS === 'ios') return // LiveKit lets the session go when the engine stops
  await AudioSession.stopAudioSession().catch(() => {})
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
  const usePip = !!pip && Platform.OS === 'ios'
  // LiveKit's newer VideoTrack view is the one with picture-in-picture. It reads only the
  // publication's track and id from the reference, so a small stand-in is enough.
  const trackRef = useMemo(() => ({ publication: { track, trackSid: track.sid } }) as unknown as VideoTrackProps['trackRef'], [track])
  if (usePip) {
    const w = shape?.[0] ?? 9
    const h = shape?.[1] ?? 16
    return (
      <LKVideoTrack
        trackRef={trackRef}
        style={style}
        mirror={mirror}
        objectFit={contain ? 'contain' : 'cover'}
        zOrder={zOrder}
        iosPIP={{ enabled: true, startAutomatically: true, preferredSize: { width: w, height: h } }}
      />
    )
  }
  return <VideoView videoTrack={track} style={style} mirror={mirror} objectFit={contain ? 'contain' : 'cover'} zOrder={zOrder} />
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

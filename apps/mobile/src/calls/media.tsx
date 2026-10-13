import { Platform, type ViewStyle } from 'react-native'
import {
  AndroidAudioTypePresets,
  AudioDeviceModule,
  AudioSession,
  VideoView,
  registerGlobals,
  setupIOSAudioManagement,
  type AppleAudioCategoryOption,
  type AppleAudioConfiguration,
} from '@livekit/react-native'
import type { VideoTrack } from 'livekit-client'

// LiveKit on phones: WebRTC comes from @livekit/react-native-webrtc, audio routing from
// LiveKit's AudioSession. (media.web.tsx is the browser preview's version.)

let registered = false
export function setupWebRTC() {
  if (registered) return
  registered = true
  registerGlobals()
}

/**
 * Starts the call audio session. Android: every call starts on the speaker (Bluetooth or
 * headphones first when connected); the Audio button switches to the earpiece. iPhone: voice calls
 * start on the earpiece, video calls on the speaker.
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
    await AudioDeviceModule.setRecordingAlwaysPreparedMode(false).catch(() => {})
    return
  }
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
    if (route === 'bluetooth' || route === 'headset') await AudioSession.showAudioRoutePicker().catch(() => {})
    else await AudioSession.selectAudioOutput(route === 'speaker' ? 'force_speaker' : 'default').catch(() => {})
    return
  }
  await AudioSession.selectAudioOutput(route).catch(() => {})
}

export function CallVideo({ track, style, mirror, contain, zOrder }: { track: VideoTrack; style?: ViewStyle; mirror?: boolean; contain?: boolean; zOrder?: number }) {
  return <VideoView videoTrack={track} style={style} mirror={mirror} objectFit={contain ? 'contain' : 'cover'} zOrder={zOrder} />
}

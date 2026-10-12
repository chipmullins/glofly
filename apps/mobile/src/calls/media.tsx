import { Platform, type ViewStyle } from 'react-native'
import { AndroidAudioTypePresets, AudioSession, VideoView, registerGlobals } from '@livekit/react-native'
import type { VideoTrack } from 'livekit-client'

// LiveKit on phones: WebRTC comes from @livekit/react-native-webrtc, audio routing from
// LiveKit's AudioSession. (media.web.tsx is the browser preview's version.)

let registered = false
export function setupWebRTC() {
  if (registered) return
  registered = true
  registerGlobals()
}

/** Starts the call audio session (voice calls start on the earpiece, video calls on the speaker). */
export async function startCallAudio(video: boolean): Promise<void> {
  await AudioSession.configureAudio({
    android: {
      preferredOutputList: video ? ['bluetooth', 'headset', 'speaker'] : ['bluetooth', 'headset', 'earpiece'],
      audioTypeOptions: AndroidAudioTypePresets.communication,
    },
    ios: { defaultOutput: video ? 'speaker' : 'earpiece' },
  })
  await AudioSession.startAudioSession()
}

export async function stopCallAudio(): Promise<void> {
  await AudioSession.stopAudioSession().catch(() => {})
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

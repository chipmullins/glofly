import { useEffect, useRef } from 'react'
import type { ViewStyle } from 'react-native'
import type { VideoTrack } from 'livekit-client'

// The browser preview: WebRTC is built in, audio plays through the browser.

export function setupWebRTC() {}
export async function startCallAudio(_video: boolean): Promise<void> {}
export async function stopCallAudio(): Promise<void> {}
export type AudioRoute = 'speaker' | 'earpiece' | 'headset' | 'bluetooth'
export async function audioRoutes(): Promise<AudioRoute[]> {
  return ['speaker']
}
export async function selectAudioRoute(_route: AudioRoute): Promise<void> {}

export function CallVideo({ track, style, mirror, contain }: { track: VideoTrack; style?: ViewStyle; mirror?: boolean; contain?: boolean; zOrder?: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      style={{ ...(style as object), objectFit: contain ? 'contain' : 'cover', transform: mirror ? 'scaleX(-1)' : undefined, display: 'block' } as React.CSSProperties}
    />
  )
}

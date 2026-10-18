import { useEffect, useRef } from 'react'
import { View, type ViewStyle } from 'react-native'
import type { PlayerCommand, WatchState } from '@glofly/shared'
import { SERVER_URL } from '@/lib/config'
import { usePlayerSync, type PlayerState } from './watchSync'

// The browser preview of the phone app: the server's player page in an iframe (like the desktop app).

const PLAYER = `${SERVER_URL}/watch/player`
const ORIGIN = new URL(SERVER_URL).origin

export function WatchView({ watch, style, unmute, onState }: { watch: WatchState; style?: ViewStyle; unmute: number; onState: (s: PlayerState) => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const send = (c: PlayerCommand) => frame.current?.contentWindow?.postMessage({ glofly: 'watch', ...c }, ORIGIN)
  const { state, onMessage } = usePlayerSync(watch, send, unmute)
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin === ORIGIN && e.source === frame.current?.contentWindow) onMessage(e.data as Record<string, unknown>)
    }
    window.addEventListener('message', on)
    return () => window.removeEventListener('message', on)
  })
  useEffect(() => onState(state), [state, onState])
  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, style]}>
      <iframe ref={frame} src={PLAYER} title={`Shared video: ${watch.title}`} allow="autoplay; encrypted-media" referrerPolicy="strict-origin" style={{ border: 0, width: '100%', height: '100%' }} />
      {state.status !== 'blocked' && watch.site !== 'dailymotion' ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
    </View>
  )
}

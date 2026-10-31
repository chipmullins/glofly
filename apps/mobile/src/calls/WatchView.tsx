import { useEffect, useRef } from 'react'
import { Linking, View, type ViewStyle } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { PlayerCommand, WatchState } from '@glofly/shared'
import { SERVER_URL } from '@/lib/config'
import { usePlayerSync, type PlayerState } from './watchSync'
import { diag } from './controller'
import { kickAudioAfterVideo } from './media'

// The shared video on a phone: the Glofly server's player page (/watch/player) in a web view.
// The page can only show the YouTube video: it may not open anything else (links go to the
// browser), and taps on the video go to Glofly's own buttons (so everyone stays together).

const PLAYER = `${SERVER_URL}/watch/player`
const ALLOWED = [new URL(SERVER_URL).origin, 'https://www.youtube-nocookie.com']

export function WatchView({ watch, style, unmute, onState }: { watch: WatchState; style?: ViewStyle; unmute: number; onState: (s: PlayerState) => void }) {
  const web = useRef<WebView>(null)
  const send = (c: PlayerCommand) => {
    const json = JSON.stringify({ glofly: 'watch', ...c })
    web.current?.injectJavaScript(`window.gloflyWatch && window.gloflyWatch(${json}); true;`)
  }
  const { state, onMessage } = usePlayerSync(watch, send, unmute)
  useEffect(() => onState(state), [state, onState])
  // iPhone safety net (Oct 31): a moment after the video starts, pauses or catches up, check the
  // call's sound is still going (iOS can stop it when the web view's video takes the audio).
  useEffect(() => {
    const t = setTimeout(() => {
      void kickAudioAfterVideo().then((kicked) => {
        if (kicked) diag(`watch together: call audio had stopped (video ${state.status}); engine restarted`)
      })
    }, 1500)
    return () => clearTimeout(t)
  }, [state.status])
  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, style]}>
      <WebView
        ref={web}
        source={{ uri: PLAYER }}
        style={{ flex: 1, backgroundColor: '#000' }}
        originWhitelist={ALLOWED.map((o) => `${o}*`)}
        javaScriptEnabled
        domStorageEnabled
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsFullscreenVideo={false}
        allowsPictureInPictureMediaPlayback={false}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        // Only the player page and YouTube's player load as the page; a link tapped on the page
        // opens in the browser. Frames inside YouTube's player (iPhone asks about those too) are
        // left alone: the page's own rules (CSP) already decide what may load there.
        onShouldStartLoadWithRequest={(req) => {
          if (ALLOWED.some((o) => req.url.startsWith(`${o}/`))) return true
          if (req.isTopFrame === false) return true
          if (req.url.startsWith('https://') && (req.navigationType ?? 'click') === 'click') void Linking.openURL(req.url)
          return false
        }}
        onMessage={(e: WebViewMessageEvent) => {
          try {
            onMessage(JSON.parse(e.nativeEvent.data) as Record<string, unknown>)
          } catch {
            // not a message from the player
          }
        }}
      />
      {state.status !== 'blocked' && watch.site !== 'dailymotion' ? <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
    </View>
  )
}

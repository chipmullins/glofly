import { useEffect, useState } from 'react'
import { AppState, Platform, View, useWindowDimensions } from 'react-native'
import { chatTitle, type PublicUser } from '@glofly/shared'
import * as Native from 'glofly-native'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { timer } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { Avatar } from '@/ui/Avatar'
import { Text } from '@/ui/kit'
import { useCall, type Tile } from './controller'
import { CallVideo } from './media'

// Picture-in-picture during calls (Oct 13).
//
// Android: while a call is going, leaving Glofly (Home, Recents, swiping away) shrinks the whole
// app into a small floating window (modules/glofly-native/android/.../Pip.kt). This draws what
// that window shows — the other person's video (or shared screen), else their photo and the call
// timer — over everything, whatever screen you were on. Tap the window to come back full size.
//
// iPhone: iOS only allows a video in the floating window, and it has to come from the video view
// itself, so the call screen marks its main video for picture-in-picture (call.tsx, `pip`). Voice
// calls show iOS's green call pill instead.

/** The video (or person) the floating window should show. */
export function featured(tiles: Tile[]): { tile: Tile | null; video: 'screen' | 'camera' | null } {
  const others = tiles.filter((t) => !t.local)
  const screen = tiles.find((t) => t.screen && !t.local)
  if (screen) return { tile: screen, video: 'screen' }
  const cam = others.find((t) => t.camera && t.speaking) ?? others.find((t) => t.camera)
  if (cam) return { tile: cam, video: 'camera' }
  return { tile: others.find((t) => t.speaking) ?? others[0] ?? null, video: null }
}

export function CallPip() {
  const call = useCall((s) => s.call)
  const tiles = useCall((s) => s.tiles)
  const [inPip, setInPip] = useState(false)
  const { width, height } = useWindowDimensions()
  const pick = featured(tiles)
  const shape = pick.video === 'screen' ? [16, 9] : pick.video === 'camera' ? [9, 16] : [1, 1]

  // On while a call is going (and the window's shape follows what it would show).
  useEffect(() => {
    if (Platform.OS !== 'android') return
    Native.setPipCall(!!call, shape[0], shape[1])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!call, shape[0], shape[1]])

  useEffect(() => {
    if (Platform.OS !== 'android') return
    const off = Native.onNativeEvent('pipChanged', (b) => setInPip(String(b.inPip) === 'true'))
    // Belt and braces: the window size changes on the way in and out.
    const sub = AppState.addEventListener('change', () => setInPip(Native.isInPip()))
    return () => {
      off()
      sub.remove()
    }
  }, [])

  useEffect(() => {
    if (Platform.OS === 'android') setInPip(Native.isInPip())
  }, [width, height])

  useEffect(() => {
    if (!call && Platform.OS === 'android') Native.setPipCall(false)
  }, [call])

  if (!inPip || !call) return null
  return <PipView tile={pick.tile} video={pick.video} />
}

function PipView({ tile, video }: { tile: Tile | null; video: 'screen' | 'camera' | null }) {
  const call = useCall((s) => s.call)
  const people = useStore((s) => s.people)
  const chat = useStore((s) => (call ? s.conversations[call.conversationId] : undefined))
  const meId = useSession((s) => s.user?.id ?? '')
  const now = useNow(1000)
  const { width, height } = useWindowDimensions()
  const person: PublicUser | null = tile ? (people[tile.userId] ?? null) : chat?.kind === 'dm' ? chat.partner : null
  const answeredAt = call?.answeredAt
  const track = video === 'screen' ? tile?.screen : video === 'camera' ? tile?.camera : null
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, width, height, backgroundColor: '#120D0B', alignItems: 'center', justifyContent: 'center' }}>
      {track ? (
        <CallVideo track={track} contain={video === 'screen'} style={{ position: 'absolute', top: 0, left: 0, width, height }} />
      ) : (
        <>
          {person ? <Avatar user={person} size={Math.min(width, height) * 0.5} /> : null}
          <Text size={12} weight="bold" numberOfLines={1} style={{ color: '#FFF', marginTop: 6, maxWidth: width - 12 }}>
            {person?.displayName ?? (chat ? chatTitle(chat) : 'Call')}
          </Text>
          <Text size={11} style={{ color: 'rgba(255,255,255,0.7)' }}>
            {answeredAt ? timer(answeredAt, now) : call?.members.some((m) => m.userId !== meId && m.state === 'joined') ? '' : 'Ringing…'}
          </Text>
        </>
      )}
    </View>
  )
}

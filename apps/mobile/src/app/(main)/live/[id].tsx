import { useEffect, useState } from 'react'
import { Platform, Pressable, View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type VideoTrack } from 'livekit-client'
import * as api from '@/api/glofly'
import { CallVideo, setupWebRTC, startWatchAudio, stopWatchAudio } from '@/calls/media'
import { useNow } from '@/lib/hooks'
import { useSocial } from '@/state/social'
import { useStore } from '@/state/store'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { Button, Spinner, Text } from '@/ui/kit'
import { call as callColors } from '@/ui/theme'

// 0.5.0 Broadcast now, on a phone: watch a friend's screen (and hear its sound). Phones only
// watch; going live is on the computer. Turn the phone sideways for a bigger picture.

type State = 'joining' | 'waiting' | 'watching' | 'ended' | 'problem'

export default function WatchLive() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const insets = useSafeAreaInsets()
  const now = useNow(20_000)
  const person = useStore((s) => s.friends.friends.find((f) => f.id === id) ?? s.people[id])
  const live = useSocial((s) => s.broadcasts.find((b) => b.userId === id))
  const [state, setState] = useState<State>('joining')
  const [problem, setProblem] = useState('')
  const [video, setVideo] = useState<VideoTrack | null>(null)
  const [muted, setMuted] = useState(false)
  const [room, setRoom] = useState<Room | null>(null)

  useEffect(() => {
    let r: Room | null = null
    let cancelled = false
    const webAudio: HTMLMediaElement[] = []
    setupWebRTC()
    void (async () => {
      const pass = await api.watchBroadcast(id)
      if (cancelled) return
      if (!pass.ok) {
        setState(pass.error === 'not_found' ? 'ended' : 'problem')
        setProblem(pass.message)
        return
      }
      await startWatchAudio().catch(() => {})
      r = new Room({ adaptiveStream: true, dynacast: true })
      r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Video && pub.source === Track.Source.ScreenShare) {
          setVideo(track as unknown as VideoTrack)
          setState('watching')
        }
        // Phones play remote sound by themselves; the browser preview needs an element.
        if (track.kind === Track.Kind.Audio && Platform.OS === 'web') {
          const el = track.attach()
          webAudio.push(el)
          document.body.appendChild(el)
        }
      })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video) {
            setVideo(null)
            setState('waiting')
          }
        })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          if (p.identity === id) setState('ended')
        })
        .on(RoomEvent.Disconnected, () => setState((s) => (s === 'watching' || s === 'waiting' ? 'ended' : s)))
      try {
        await r.connect(pass.data.url, pass.data.token)
        if (cancelled) return void r.disconnect()
        setRoom(r)
        setState((s) => (s === 'joining' ? 'waiting' : s))
      } catch {
        if (!cancelled) {
          setState('problem')
          setProblem("Couldn't connect to the broadcast. Check your connection and try again.")
        }
      }
    })()
    return () => {
      cancelled = true
      void r?.disconnect()
      for (const el of webAudio) el.remove()
      void stopWatchAudio()
    }
  }, [id])

  // Mute: stop receiving their sound (remote audio has no per-app volume on phones).
  useEffect(() => {
    if (!room) return
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) pub.setEnabled(!muted)
    }
  }, [muted, room, video])

  const shown: State = !live && state !== 'joining' && state !== 'problem' ? 'ended' : state
  const since = live ? Math.max(0, Math.floor((now - new Date(live.startedAt).getTime()) / 60_000)) : 0
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/chats'))

  return (
    <View style={{ flex: 1, backgroundColor: callColors.bg }}>
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {person ? <Avatar user={person} size={40} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text display size={17} numberOfLines={1} style={{ color: '#FFFFFF', flexShrink: 1 }}>
              {person?.displayName ?? 'Broadcast'}
            </Text>
            {shown === 'watching' || shown === 'waiting' ? (
              <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: '#D33A2C' }}>
                <Text size={10} weight="bold" style={{ color: '#FFFFFF', letterSpacing: 0.6 }}>
                  LIVE
                </Text>
              </View>
            ) : null}
          </View>
          <Text size={13} numberOfLines={1} style={{ color: callColors.muted }}>
            {live?.title ?? 'Sharing their screen'}
            {live ? ` · ${since < 1 ? 'just started' : `${since} min`} · ${live.viewers} watching` : ''}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Unmute' : 'Mute'} onPress={() => setMuted((m) => !m)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: callColors.button, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={muted ? 'speakerOff' : 'speaker'} size={22} color="#FFFFFF" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Leave" onPress={leave} style={{ height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: callColors.button, justifyContent: 'center' }}>
          <Text size={15} weight="bold" style={{ color: '#FFFFFF' }}>
            Leave
          </Text>
        </Pressable>
      </View>
      <View style={{ flex: 1, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center', marginBottom: insets.bottom }}>
        {video && shown === 'watching' ? (
          <CallVideo track={video} contain style={{ width: '100%', height: '100%' }} />
        ) : shown === 'ended' ? (
          <View style={{ alignItems: 'center', gap: 16, padding: 24 }}>
            <Text display size={20} style={{ color: '#FFFFFF' }}>
              The broadcast ended
            </Text>
            <Button label="Back to chats" kind="secondary" compact onPress={leave} />
          </View>
        ) : shown === 'problem' ? (
          <Text size={16} style={{ color: '#FFFFFF', textAlign: 'center', padding: 24 }}>
            {problem}
          </Text>
        ) : (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Spinner color={callColors.glow} />
            <Text size={14} style={{ color: callColors.muted }}>
              {shown === 'joining' ? 'Joining…' : 'Waiting for the screen…'}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}

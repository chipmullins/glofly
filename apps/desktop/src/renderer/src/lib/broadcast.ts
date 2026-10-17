// 0.5.0 Broadcast now: your own broadcast (one at a time), kept outside React so any screen can
// show "Live". Joining the room and sharing the screen happen here; the dialogs are in
// components/Broadcast.tsx.
import { useSyncExternalStore } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import type { Broadcast } from '../../../preload/api-types'
import { isMac, isWeb } from './platform'
import { refreshSocial } from './social'

type Host =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'live'; room: Room; broadcast: Broadcast; startedAt: number }

let host: Host = { status: 'idle' }
const listeners = new Set<() => void>()
const setHost = (next: Host): void => {
  host = next
  for (const l of listeners) l()
}

export function useMyBroadcast(): Host {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => host,
    () => host
  )
}

/** Goes live: joins the room, then shares the screen (desktop: the one picked; browser: it asks). */
export async function goLive(
  title: string | null,
  sourceId: string | null,
  sound: boolean
): Promise<string | null> {
  if (host.status !== 'idle') return null
  setHost({ status: 'starting' })
  const r = await window.glofly.broadcasts.start(title)
  if (!r.ok) {
    setHost({ status: 'idle' })
    return r.message
  }
  const room = new Room({ adaptiveStream: false, dynacast: true })
  try {
    await room.connect(r.data.url, r.data.token, { autoSubscribe: false })
    if (isWeb) {
      await room.localParticipant.setScreenShareEnabled(true, {
        audio: sound,
        systemAudio: sound ? 'include' : 'exclude',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        resolution: { width: 1920, height: 1080, frameRate: 30 }
      })
    } else if (sourceId) {
      await window.glofly.calls.chooseScreen(sourceId, sound)
      await room.localParticipant.setScreenShareEnabled(true, {
        audio: sound,
        resolution: { width: 1920, height: 1080, frameRate: 30 }
      })
    }
    if (!room.localParticipant.isScreenShareEnabled)
      throw Object.assign(new Error('not shared'), { name: 'NotAllowedError' })
  } catch (err) {
    await room.disconnect()
    await window.glofly.broadcasts.stop()
    setHost({ status: 'idle' })
    void refreshSocial()
    const e = err as { name?: string }
    if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return null // cancelled
    return isMac
      ? "Couldn't share your screen. Check System Settings → Privacy & Security → Screen & System Audio Recording."
      : "Couldn't share your screen. Try again, or pick something else."
  }
  // Sharing stopped from outside (the browser's "Stop sharing" bar, a closed window): stop.
  room.on(RoomEvent.LocalTrackUnpublished, (pub) => {
    if (pub.source === Track.Source.ScreenShare) void stopLive()
  })
  room.on(RoomEvent.Disconnected, () => {
    if (host.status === 'live' && host.room === room) void stopLive()
  })
  setHost({ status: 'live', room, broadcast: r.data.broadcast, startedAt: Date.now() })
  void refreshSocial()
  return null
}

export async function stopLive(): Promise<void> {
  if (host.status !== 'live') return
  const { room } = host
  setHost({ status: 'idle' })
  await room.disconnect().catch(() => undefined)
  await window.glofly.broadcasts.stop()
  void refreshSocial()
}

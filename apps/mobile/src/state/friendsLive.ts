import { create } from 'zustand'
import type { FriendStream, ServerEvent } from '@glofly/shared'
import { request } from '@/api/http'
import { onLive } from '@/api/realtime'

// 0.9.3: friends live on Twitch or Kick right now (the LIVE labels), and whose live alerts I
// muted. Kept up to date from friend:live; read again whenever the connection comes back.

type FriendsLive = { live: Record<string, FriendStream>; muted: string[] }
export const useFriendsLive = create<FriendsLive>(() => ({ live: {}, muted: [] }))

export async function refreshFriendsLive(): Promise<void> {
  const r = await request<{ streams: FriendStream[]; mutedLive?: string[] }>('GET', '/connections/friends-live')
  if (!r.ok) return
  const live: Record<string, FriendStream> = {}
  for (const s of r.data.streams) if (!live[s.userId] || s.source === 'twitch') live[s.userId] = s
  useFriendsLive.setState({ live, muted: r.data.mutedLive ?? [] })
}

export async function setLiveAlertsMuted(userId: string, muted: boolean): Promise<string | null> {
  const r = await request<{ muted: boolean }>('PUT', `/connections/muted-live/${userId}`, { muted })
  if (!r.ok) return r.message
  const now = useFriendsLive.getState().muted.filter((id) => id !== userId)
  useFriendsLive.setState({ muted: muted ? [...now, userId] : now })
  return null
}

let started = false
/** Once, when the app signs in. */
export function startFriendsLive(): void {
  if (started) return
  started = true
  onLive((event, payload) => {
    if (event === 'connected') void refreshFriendsLive()
    if (event !== 'cx') return
    const e = payload as ServerEvent
    if (e.type !== 'friend:live') return
    const live = { ...useFriendsLive.getState().live }
    if (e.live && e.showLive !== false) live[e.userId] = e.live
    else if (live[e.userId]?.source === e.source) delete live[e.userId]
    else return
    useFriendsLive.setState({ live })
  })
}

export function clearFriendsLive(): void {
  useFriendsLive.setState({ live: {}, muted: [] })
}

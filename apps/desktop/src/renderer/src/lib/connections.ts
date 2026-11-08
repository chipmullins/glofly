// 0.9.3 Connections (Steam, Twitch, Kick): Settings → Connections talks to the server through
// window.glofly.tools.request (it lets only /connections… through), and friends live on Twitch or
// Kick are kept here, outside React, so the friends list, profiles and toasts all agree.
import { useSyncExternalStore } from 'react'
import type {
  ApiResult,
  ConnectionProvider,
  ConnectionSettings,
  ConnectionsView,
  FriendStream,
  LinkedAccount,
  ServerEvent
} from '@glofly/shared'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const connectionsCall = <T>(
  method: Method,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.tools.request<T>(method, path, body)

export const getConnections = (): Promise<ApiResult<ConnectionsView>> =>
  connectionsCall('GET', '/connections')
export const startLink = (p: ConnectionProvider): Promise<ApiResult<{ url: string }>> =>
  connectionsCall('POST', `/connections/${p}/start`)
export const changeConnection = (
  p: ConnectionProvider,
  settings: Partial<ConnectionSettings>
): Promise<ApiResult<{ account: LinkedAccount }>> =>
  connectionsCall('PATCH', `/connections/${p}`, { settings })
export const unlink = (p: ConnectionProvider): Promise<ApiResult<unknown>> =>
  connectionsCall('DELETE', `/connections/${p}`)
export const syncSteam = (): Promise<ApiResult<{ count: number; publicGames: boolean }>> =>
  connectionsCall('POST', '/connections/steam/sync')
export const muteLiveAlerts = (
  userId: string,
  muted: boolean
): Promise<ApiResult<{ muted: boolean }>> =>
  connectionsCall('PUT', `/connections/muted-live/${userId}`, { muted })

/** Only the site's own channel pages are ever opened from Glofly. */
export function isStreamPage(url: string): boolean {
  return (
    /^https:\/\/www\.twitch\.tv\/[a-z0-9_]{2,25}$/.test(url) ||
    /^https:\/\/kick\.com\/[a-z0-9_-]{2,40}$/.test(url)
  )
}

// ───────────── Friends live right now ─────────────

let live = new Map<string, FriendStream>()
const listeners = new Set<() => void>()
const changed = (next: Map<string, FriendStream>): void => {
  live = next
  for (const l of listeners) l()
}

/** Every friend live right now, by their id (one stream each; Twitch wins over Kick if both). */
export function useFriendsLive(): Map<string, FriendStream> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => live,
    () => live
  )
}
export const friendLive = (userId: string): FriendStream | null => live.get(userId) ?? null

// Friends whose live alerts I muted ("Mute Chip's live alerts").
let muted = new Set<string>()
export const liveAlertsMuted = (userId: string): boolean => muted.has(userId)
export async function setLiveAlertsMuted(userId: string, on: boolean): Promise<string | null> {
  const r = await muteLiveAlerts(userId, on)
  if (!r.ok) return r.message
  muted = new Set(muted)
  if (on) muted.add(userId)
  else muted.delete(userId)
  changed(new Map(live))
  return null
}

export async function refreshFriendsLive(): Promise<void> {
  const r = await connectionsCall<{ streams: FriendStream[]; mutedLive?: string[] }>(
    'GET',
    '/connections/friends-live'
  )
  if (!r.ok) return
  muted = new Set(r.data.mutedLive ?? [])
  const next = new Map<string, FriendStream>()
  for (const s of r.data.streams)
    if (!next.has(s.userId) || s.source === 'twitch') next.set(s.userId, s)
  changed(next)
}

/** A friend:live event (the forwarder already checked it). */
export function noteFriendLive(e: Extract<ServerEvent, { type: 'friend:live' }>): void {
  const next = new Map(live)
  const had = next.get(e.userId)
  if (e.live && e.showLive !== false) next.set(e.userId, e.live)
  else if (had?.source === e.source) next.delete(e.userId)
  else return
  changed(next)
}

/** Signed out: nothing kept. */
export function clearFriendsLive(): void {
  changed(new Map())
}

export const SITE_LOOK: Record<
  ConnectionProvider,
  { name: string; color: string; ink: string; badge: string }
> = {
  twitch: { name: 'Twitch', color: '#6f3fd1', ink: '#ffffff', badge: 'TWITCH' },
  kick: { name: 'Kick', color: '#1f7a3a', ink: '#ffffff', badge: 'KICK' },
  steam: { name: 'Steam', color: '#1b2838', ink: '#ffffff', badge: 'STEAM' }
}

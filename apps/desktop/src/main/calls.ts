import { desktopCapturer, type DesktopCapturerSource } from 'electron'
import type {
  ActiveCall,
  ApiResult,
  CallAddResult,
  CallJoin,
  ScreenSource,
  WatchAction,
  WatchControl,
  WatchPreview,
  WatchReaction,
  WatchUpdate
} from '../preload/api-types'
import { request } from './api'
import { API_URL } from './auth'
import { screenSoundSupport } from './screenSound'

// Calls. The server decides who may join which call and hands back a short-lived pass for the
// call's LiveKit room; the window then connects to LiveKit itself for the audio and video.
// (That pass only works for that one call. The Glofly session token never leaves this process.)

/** The call address must be LiveKit's, never anything else the window might be sent to. */
export function checkedJoin<T extends { url: string; token: string }>(
  result: ApiResult<T>
): ApiResult<T> {
  if (!result.ok) return result
  const { url, token } = result.data
  const fine =
    typeof token === 'string' &&
    token.length < 4000 &&
    typeof url === 'string' &&
    (/^wss:\/\/[a-z0-9.-]+\.livekit\.cloud\/?$/i.test(url) ||
      /^ws:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  return fine
    ? result
    : { ok: false, error: 'server_error', message: "Calls aren't set up correctly on the server." }
}

/** `ring` (groups, 0.5.2): only these people are rung; the rest of the group can join. */
export async function startCall(
  conversationId: string,
  video: boolean,
  ring?: string[]
): Promise<ApiResult<CallJoin>> {
  return checkedJoin(
    await request<CallJoin>('POST', '/calls', { conversationId, video, ...(ring ? { ring } : {}) })
  )
}

export async function activeCalls(): Promise<ApiResult<ActiveCall[]>> {
  const result = await request<{ calls: ActiveCall[] }>('GET', '/calls/active')
  return result.ok ? { ok: true, data: result.data.calls } : result
}

export async function answerCall(callId: string): Promise<ApiResult<CallJoin>> {
  return checkedJoin(await request<CallJoin>('POST', `/calls/${callId}/answer`))
}

export async function joinCall(callId: string): Promise<ApiResult<CallJoin>> {
  return checkedJoin(await request<CallJoin>('POST', `/calls/${callId}/join`))
}

export function ringPeople(callId: string, userIds: string[]): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/ring`, { userIds })
}

/** 0.5.2 Add people: a 1-on-1 call moves to a new group; a group call rings them. */
export function addToCall(callId: string, userIds: string[]): Promise<ApiResult<CallAddResult>> {
  return request<CallAddResult>('POST', `/calls/${callId}/add`, { userIds })
}

/** 0.5.2 Group calls: on your own, keep the call going another 7 minutes. */
export function stayInCall(callId: string): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/stay`)
}

export function declineCall(callId: string): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/decline`)
}

export function leaveCall(callId: string): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/leave`)
}

// ---------------------------------------------------------------------------------------
// Watch Together (0.5.0): a YouTube video everyone in the call watches together. The window
// shows it through the server's player page (/watch/player) and asks the server for every
// play, pause and skip, so everyone stays in step.

/** The server's video player page (the window shows it in a frame). */
export const watchPlayerUrl = (): string => `${API_URL}/watch/player`

export function watchGet(callId: string): Promise<ApiResult<WatchUpdate>> {
  return request<WatchUpdate>('GET', `/calls/${callId}/watch`)
}

export function watchPreview(link: string): Promise<ApiResult<WatchPreview>> {
  return request<WatchPreview>('GET', `/calls/watch/preview?link=${encodeURIComponent(link)}`)
}

export function watchStart(
  callId: string,
  link: string,
  control?: WatchControl
): Promise<ApiResult<WatchUpdate>> {
  return request<WatchUpdate>('POST', `/calls/${callId}/watch`, { link, control })
}

export function watchControl(
  callId: string,
  action: Extract<WatchAction, 'play' | 'pause' | 'seek' | 'back' | 'forward'>,
  to?: number
): Promise<ApiResult<WatchUpdate>> {
  return request<WatchUpdate>('POST', `/calls/${callId}/watch/control`, { action, to })
}

export function watchSettings(
  callId: string,
  control: WatchControl
): Promise<ApiResult<WatchUpdate>> {
  return request<WatchUpdate>('POST', `/calls/${callId}/watch/settings`, { control })
}

export function watchReport(
  callId: string,
  videoId: string,
  durationSec: number,
  title?: string
): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/watch/report`, { videoId, durationSec, title })
}

export function watchReact(callId: string, reaction: WatchReaction): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/watch/react`, { reaction })
}

export function watchStop(callId: string): Promise<ApiResult<WatchUpdate>> {
  return request<WatchUpdate>('DELETE', `/calls/${callId}/watch`)
}

// ---------------------------------------------------------------------------------------
// Screen sharing. The window lists what can be shared (with small pictures), the person picks
// one, and only then does the window ask to start sharing. The share request is answered with
// exactly the picked screen or window, and only within a few seconds of picking it.

let chosen: { id: string; at: number; sound: boolean } | null = null
const CHOICE_GOOD_FOR_MS = 15_000
// What the picker last showed, by id. The share is answered with that exact source rather than
// a fresh listing: on a Mac a second listing (with no pictures) could come back without the
// picked screen or window, and then the share failed with no message at all.
let listed = new Map<string, DesktopCapturerSource>()

async function sources(withPictures: boolean): Promise<DesktopCapturerSource[]> {
  return desktopCapturer.getSources({
    types: ['screen', 'window'],
    // Never 0×0: a Mac doesn't always list everything without at least a small picture.
    thumbnailSize: withPictures ? { width: 320, height: 180 } : { width: 16, height: 16 },
    fetchWindowIcons: withPictures
  })
}

export async function screenSources(): Promise<ScreenSource[]> {
  try {
    const list = await sources(true)
    listed = new Map(list.map((s) => [s.id, s]))
    return list
      .filter((s) => s.name !== 'Glofly' || s.id.startsWith('screen:')) // not Glofly itself
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? ('screen' as const) : ('window' as const),
        thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
      }))
  } catch {
    return []
  }
}

/**
 * `sound`: also send what the computer is playing through Electron's own loopback. Only used
 * where Glofly's own screen-sound capture can't run (screenSound: 'system', older Windows); it
 * hears everything, Glofly's calls included. Everywhere else the sound comes from screenSound.
 */
export function chooseScreen(sourceId: string, sound = false): boolean {
  chosen = { id: sourceId, at: Date.now(), sound }
  return true
}

const canShareSound = (): boolean => screenSoundSupport() === 'system'

/** Answers the window's request to share its screen with the picked screen or window, if any. */
export async function pickedScreen(): Promise<{
  source: DesktopCapturerSource
  sound: boolean
} | null> {
  const choice = chosen
  chosen = null
  if (!choice || Date.now() - choice.at > CHOICE_GOOD_FOR_MS) return null
  const sound = choice.sound && canShareSound()
  const shown = listed.get(choice.id)
  if (shown) return { source: shown, sound }
  try {
    const found = (await sources(false)).find((s) => s.id === choice.id)
    return found ? { source: found, sound } : null
  } catch (err) {
    console.warn('[screen share] listing failed', err)
    return null
  }
}

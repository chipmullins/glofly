import { desktopCapturer, type DesktopCapturerSource } from 'electron'
import type { ActiveCall, ApiResult, CallJoin, ScreenSource } from '../preload/api-types'
import { request } from './api'

// Calls. The server decides who may join which call and hands back a short-lived pass for the
// call's LiveKit room; the window then connects to LiveKit itself for the audio and video.
// (That pass only works for that one call. The Glofly session token never leaves this process.)

/** The call address must be LiveKit's, never anything else the window might be sent to. */
function checkedJoin(result: ApiResult<CallJoin>): ApiResult<CallJoin> {
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

export async function startCall(
  conversationId: string,
  video: boolean
): Promise<ApiResult<CallJoin>> {
  return checkedJoin(await request<CallJoin>('POST', '/calls', { conversationId, video }))
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

export function declineCall(callId: string): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/decline`)
}

export function leaveCall(callId: string): Promise<ApiResult<null>> {
  return request<null>('POST', `/calls/${callId}/leave`)
}

// ---------------------------------------------------------------------------------------
// Screen sharing. The window lists what can be shared (with small pictures), the person picks
// one, and only then does the window ask to start sharing. The share request is answered with
// exactly the picked screen or window, and only within a few seconds of picking it.

let chosen: { id: string; at: number } | null = null
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

export function chooseScreen(sourceId: string): boolean {
  chosen = { id: sourceId, at: Date.now() }
  return true
}

/** Answers the window's request to share its screen with the picked screen or window, if any. */
export async function pickedScreen(): Promise<DesktopCapturerSource | null> {
  const choice = chosen
  chosen = null
  if (!choice || Date.now() - choice.at > CHOICE_GOOD_FOR_MS) return null
  const shown = listed.get(choice.id)
  if (shown) return shown
  try {
    return (await sources(false)).find((s) => s.id === choice.id) ?? null
  } catch (err) {
    console.warn('[screen share] listing failed', err)
    return null
  }
}

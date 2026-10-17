import type {
  ApiResult,
  Broadcast,
  BroadcastJoin,
  Message,
  PublicUser,
  SocialToday,
  Sticker,
  YearInGlow
} from '../preload/api-types'
import { isUserId, request } from './api'
import { canShareSound } from './calls'

// 0.5.0 social extras (glows, hangs, birthdays, Year in Glow), custom stickers and Broadcast now.
// Every value from the window is checked here before it goes to the server.

const invalid = {
  ok: false as const,
  error: 'invalid' as const,
  message: 'Something about that request was off.'
}
const bad = (): Promise<ApiResult<never>> => Promise.resolve(invalid)
const STICKER_PHOTO_MAX = 15 * 1024 * 1024

export const getSocial = (): Promise<ApiResult<SocialToday>> => request('GET', '/social')

export function hang(
  userIds: unknown
): Promise<ApiResult<{ until: string; with: string[] | null; told: number }>> {
  if (userIds === null) return request('POST', '/social/hang', {})
  if (
    !Array.isArray(userIds) ||
    userIds.length === 0 ||
    userIds.length > 500 ||
    !userIds.every(isUserId)
  )
    return bad()
  return request('POST', '/social/hang', { userIds })
}

export const stopHang = (): Promise<ApiResult<null>> => request('DELETE', '/social/hang')

export function shareBirthday(share: unknown): Promise<ApiResult<{ share: boolean }>> {
  if (typeof share !== 'boolean') return bad()
  return request('PUT', '/social/birthday', { share })
}

export const year = (): Promise<ApiResult<YearInGlow>> => request('GET', '/social/year')

export async function listStickers(): Promise<ApiResult<Sticker[]>> {
  const r = await request<{ stickers: Sticker[] }>('GET', '/stickers')
  return r.ok ? { ok: true, data: r.data.stickers } : r
}

export async function makeSticker(data: unknown): Promise<ApiResult<Sticker>> {
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return bad()
  if (data.byteLength > STICKER_PHOTO_MAX) {
    return { ok: false, error: 'invalid', message: 'Pick a photo under 15 MB.' }
  }
  const r = await request<{ sticker: Sticker }>('POST', '/stickers', undefined, {
    data: new Uint8Array(data),
    type: 'application/octet-stream'
  })
  return r.ok ? { ok: true, data: r.data.sticker } : r
}

export function removeSticker(id: unknown): Promise<ApiResult<null>> {
  if (!isUserId(id)) return bad()
  return request('DELETE', `/stickers/${id}`)
}

export async function sendSticker(
  id: unknown,
  conversationId: unknown,
  replyTo: unknown
): Promise<ApiResult<Message>> {
  if (!isUserId(id) || !isUserId(conversationId) || (replyTo != null && !isUserId(replyTo)))
    return bad()
  const r = await request<{ message: Message }>('POST', `/stickers/${id}/send`, {
    conversationId,
    ...(replyTo ? { replyToId: replyTo } : {})
  })
  return r.ok ? { ok: true, data: r.data.message } : r
}

export function startBroadcast(title: unknown): Promise<ApiResult<BroadcastJoin>> {
  if (title !== null && (typeof title !== 'string' || title.length > 60)) return bad()
  return request('POST', '/broadcasts', title ? { title } : {})
}

export const stopBroadcast = (): Promise<ApiResult<null>> => request('DELETE', '/broadcasts')

export const myBroadcast = (): Promise<
  ApiResult<{ broadcast: Broadcast | null; viewers: PublicUser[] }>
> => request('GET', '/broadcasts/mine')

export function watchBroadcast(userId: unknown): Promise<ApiResult<BroadcastJoin>> {
  if (!isUserId(userId)) return bad()
  return request('POST', `/broadcasts/${userId}/watch`)
}

export { canShareSound }

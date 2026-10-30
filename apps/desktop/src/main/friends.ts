import type {
  ApiResult,
  FriendLinkAccepted,
  FriendLinkPreview,
  FriendLists,
  MyFriendLink,
  OnlineAlertsMode,
  SearchResult
} from '../preload/api-types'
import { request } from './api'

export const listFriends = (): Promise<ApiResult<FriendLists>> => request('GET', '/friends')

export async function searchUsers(query: string): Promise<ApiResult<SearchResult[]>> {
  const result = await request<{ results: SearchResult[] }>(
    'GET',
    `/users/search?q=${encodeURIComponent(query)}`
  )
  return result.ok ? { ok: true, data: result.data.results } : result
}

export async function sendRequest(
  username: string
): Promise<ApiResult<{ status: 'pending' | 'accepted' }>> {
  const result = await request<{ status: 'pending' | 'accepted' }>('POST', '/friends/requests', {
    username
  })
  return result.ok ? { ok: true, data: { status: result.data.status } } : result
}

const empty = async (r: Promise<ApiResult<unknown>>): Promise<ApiResult<null>> => {
  const result = await r
  return result.ok ? { ok: true, data: null } : result
}

export const acceptRequest = (id: string): Promise<ApiResult<null>> =>
  empty(request('POST', `/friends/requests/${id}/accept`))
export const removeRequest = (id: string): Promise<ApiResult<null>> =>
  empty(request('DELETE', `/friends/requests/${id}`))
export const removeFriend = (id: string): Promise<ApiResult<null>> =>
  empty(request('DELETE', `/friends/${id}`))
export const blockUser = (id: string): Promise<ApiResult<null>> =>
  empty(request('POST', `/blocks/${id}`))
export const unblockUser = (id: string): Promise<ApiResult<null>> =>
  empty(request('DELETE', `/blocks/${id}`))

/** "Notify me when they come online" (0.3.0 servers). */
export async function setOnlineAlert(
  id: string,
  on: boolean
): Promise<ApiResult<{ on: boolean; mode?: OnlineAlertsMode }>> {
  return request<{ on: boolean; mode?: OnlineAlertsMode }>('PUT', `/friends/${id}/online-alert`, {
    on
  })
}

/** "Invite your friends": emails them a link to join Glofly (0.3.0 servers). */
export const inviteByEmail = (email: string): Promise<ApiResult<null>> =>
  empty(request('POST', '/friends/invite', { email }))

// ---- 0.8.0: shareable friend invite links ----

/** Your invite link (made the first time) and how many joined from it. */
export const myFriendLink = (): Promise<ApiResult<MyFriendLink>> => request('GET', '/friends/link')
/** A new invite link: the old one stops working right away. */
export const resetFriendLink = (): Promise<ApiResult<MyFriendLink>> =>
  request('POST', '/friends/link/reset', {})
/** Whose invite link this is and what they are to you. */
export const previewFriendLink = (code: string): Promise<ApiResult<FriendLinkPreview>> =>
  request('GET', `/friends/link/${encodeURIComponent(code)}`)
/** Become friends with the link's owner. */
export const acceptFriendLink = (code: string): Promise<ApiResult<FriendLinkAccepted>> =>
  request('POST', `/friends/link/${encodeURIComponent(code)}/accept`, {})

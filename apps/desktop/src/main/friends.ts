import type { ApiResult, FriendLists, SearchResult } from '../preload/api-types'
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

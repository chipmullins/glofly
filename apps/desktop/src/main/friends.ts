import type { ApiError, ApiResult, FriendLists, SearchResult } from '../preload/api-types'
import { API_URL, endSessionLocally, getSessionToken } from './auth'

/** Calls the server as the signed-in user and turns the answer into an ApiResult. */
async function request<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> {
  const token = getSessionToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Please log in again.' }

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    return {
      ok: false,
      error: 'unreachable',
      message: "Can't reach Glofly right now. Check your connection and try again."
    }
  }

  if (response.status === 204) return { ok: true, data: null as T }
  const json = (await response.json().catch(() => null)) as
    (T & { message?: string; error?: string }) | null

  if (response.ok && json) return { ok: true, data: json }

  if (response.status === 401) {
    await endSessionLocally()
    return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  }
  const errorFor: Record<number, ApiError> = {
    400: 'invalid',
    404: 'not_found',
    409: 'conflict',
    429: 'too_many_requests'
  }
  return {
    ok: false,
    error: errorFor[response.status] ?? 'server_error',
    message: json?.message ?? 'Something went wrong on our end. Try again in a moment.'
  }
}

/** Only real ids get sent to the server, so nothing odd can end up in a URL. */
export const isUserId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

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

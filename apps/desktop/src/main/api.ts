import type { ApiError, ApiResult } from '../preload/api-types'
import { API_URL, endSessionLocally, getSessionToken, VERSION_HEADER } from './auth'
import { disconnectRealtime } from './realtime'
import { notePaused, noteUpdateRequired } from './app-status'

/** Calls the server as the signed-in user and turns the answer into an ApiResult. */
export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  /** Sends a file as-is instead of JSON (profile photos). */
  file?: { data: Uint8Array; type: string }
): Promise<ApiResult<T>> {
  const token = getSessionToken()
  if (!token) return { ok: false, error: 'unauthorized', message: 'Please log in again.' }

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...VERSION_HEADER,
        ...(file ? { 'Content-Type': file.type } : {}),
        ...(body !== undefined && !file ? { 'Content-Type': 'application/json' } : {})
      },
      body: file ? (file.data as BodyInit) : body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(file ? 180_000 : 10_000) // a 64 MB video on a slow connection
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
    (T & { message?: string; error?: string; fields?: Record<string, string> }) | null

  if (response.ok && json) return { ok: true, data: upgradeEvents(json) }

  if (response.status === 426 && json?.error === 'update_required') {
    const required = noteUpdateRequired(json)
    return { ok: false, error: 'update_required', message: required.message }
  }
  // Glofly Control → Pause Glofly: the window shows "Glofly is paused".
  if (response.status === 503 && notePaused(json)) {
    disconnectRealtime()
    return { ok: false, error: 'paused', message: json?.message ?? 'Glofly is paused.' }
  }
  if (response.status === 401) {
    disconnectRealtime()
    await endSessionLocally()
    return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  }
  const errorFor: Record<number, ApiError> = {
    400: 'invalid',
    403: 'forbidden',
    404: 'not_found',
    409: 'conflict',
    413: 'invalid',
    429: 'too_many_requests'
  }
  const fields =
    json?.fields && typeof json.fields === 'object'
      ? Object.fromEntries(Object.entries(json.fields).filter(([, v]) => typeof v === 'string'))
      : undefined
  return {
    ok: false,
    error: errorFor[response.status] ?? 'server_error',
    message:
      json?.message ??
      (fields && Object.values(fields)[0]) ??
      'Something went wrong on our end. Try again in a moment.',
    ...(fields ? { fields } : {})
  }
}

/** Only real ids (users, conversations, messages) get sent to the server, so nothing odd can end up in a URL. */
export const isUserId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

// Event lines newer than 0.2.0 arrive as `eventLine`; this turns them back into lines.
// Shared with the mobile app: packages/shared/src/events.ts
import { upgradeEvents } from '@glofly/shared/events'
export { upgradeEvents }

/**
 * 2.0: a request the window may pass to /constellations/… or /games/… (Constellations, My games):
 * a known method, one of those paths in plain characters (ids, codes, simple query strings) and a
 * small JSON body.
 */
/** Communities round: Settings → Connected apps and Developer (Sign in with Glofly) only. */
export function isAppsRequest(method: unknown, path: unknown, body: unknown): boolean {
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method as string)) return false
  if (typeof path !== 'string' || path.length > 200) return false
  if (!/^\/(account\/connected-apps|developer\/apps)(\/[A-Za-z0-9_-]+)*$/.test(path)) return false
  if (body === undefined || body === null) return true
  try {
    return typeof body === 'object' && JSON.stringify(body).length <= 10_000
  } catch {
    return false
  }
}

export function isConstellationRequest(
  method: unknown,
  path: unknown,
  body: unknown
): method is 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  if (
    method !== 'GET' &&
    method !== 'POST' &&
    method !== 'PUT' &&
    method !== 'PATCH' &&
    method !== 'DELETE'
  )
    return false
  if (typeof path !== 'string' || path.length > 300) return false
  if (!/^\/(constellations|games)(\/[A-Za-z0-9_-]+)*\/?(\?[A-Za-z0-9=&%._+-]*)?$/.test(path))
    return false
  if (body === undefined || body === null) return true
  try {
    return typeof body === 'object' && JSON.stringify(body).length <= 20_000
  } catch {
    return false
  }
}

/** 0.7.3: the routes the "tools" gateway passes on (two-step settings, quiet hours, pins, mark
 *  unread, send later): those exact shapes only, plain ids, small JSON bodies. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const TOOL_PATHS = [
  /^\/account\/two-step(\/(start|confirm|off|remove-phone|backup-codes))?$/,
  /^\/account\/quiet-hours$/,
  /^\/conversations\/scheduled$/,
  new RegExp(`^/conversations/${UUID}/(pins|unread|scheduled)$`, 'i'),
  new RegExp(`^/conversations/${UUID}/scheduled/${UUID}(/send)?$`, 'i'),
  new RegExp(`^/conversations/${UUID}/messages/${UUID}/pin$`, 'i')
]
export function isToolsRequest(
  method: unknown,
  path: unknown,
  body: unknown
): method is 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method as string)) return false
  if (typeof path !== 'string' || path.length > 200 || !TOOL_PATHS.some((r) => r.test(path)))
    return false
  if (body === undefined || body === null) return true
  try {
    return typeof body === 'object' && JSON.stringify(body).length <= 20_000
  } catch {
    return false
  }
}

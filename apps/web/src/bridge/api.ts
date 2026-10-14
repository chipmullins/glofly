import type { ApiError, ApiResult } from '../../../desktop/src/preload/api-types'
import { upgradeEvents } from '@glofly/shared/events'
import { API_URL, APP_HEADERS, UNREACHABLE } from './config'
import { notePaused, noteUpdateRequired } from './appStatus'

// Calls the Glofly server as the signed-in person (the desktop app's src/main/api.ts, for a
// browser). The session is an httpOnly cookie this page can't read; the browser sends it
// (credentials: 'include'). Anything that changes something also carries the CSRF value the
// server handed over at sign-in, which only this page knows.

let csrf: string | null = null
let signedIn = false
const sessionEndedListeners = new Set<() => void>()

/** Signed in: remember the CSRF value (from /auth/login, /auth/register or /auth/me). */
export function startSession(csrfValue: string): void {
  csrf = csrfValue
  signedIn = true
}

/** Signed out (or the server ended the session): forget it here. */
export function endSession(): void {
  const was = signedIn
  csrf = null
  signedIn = false
  if (was) for (const listener of [...sessionEndedListeners]) listener()
}

export const isSignedIn = (): boolean => signedIn

/** Runs when the session ends (closes the live connection, takes notifications away). */
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener)
  return () => sessionEndedListeners.delete(listener)
}

export function csrfHeader(): Record<string, string> {
  return csrf ? { 'X-Glofly-CSRF': csrf } : {}
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** A fetch to the server with the cookie, this app's headers and (for changes) the CSRF value. */
export async function serverFetch(
  method: Method,
  path: string,
  init: { body?: BodyInit; type?: string; timeoutMs?: number } = {}
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: {
      ...APP_HEADERS,
      ...(method !== 'GET' ? csrfHeader() : {}),
      ...(init.type ? { 'Content-Type': init.type } : {})
    },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 10_000)
  })
}

/** The CSRF value went stale (signed in again in another tab): ask for the current one. */
async function refreshCsrf(): Promise<boolean> {
  try {
    const response = await serverFetch('GET', '/auth/me')
    const body = (await response.json().catch(() => null)) as { csrf?: unknown } | null
    if (response.ok && typeof body?.csrf === 'string') {
      csrf = body.csrf
      return true
    }
  } catch {
    // Offline: the request below reports it.
  }
  return false
}

/** Calls the server as the signed-in user and turns the answer into an ApiResult. */
export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  /** Sends a file as-is instead of JSON (photos, attachments). */
  file?: { data: BodyInit; type: string },
  retried = false
): Promise<ApiResult<T>> {
  if (!signedIn) return { ok: false, error: 'unauthorized', message: 'Please log in again.' }

  let response: Response
  try {
    response = await serverFetch(method, path, {
      body: file ? file.data : body !== undefined ? JSON.stringify(body) : undefined,
      type: file ? file.type : body !== undefined ? 'application/json' : undefined,
      timeoutMs: file ? 120_000 : 10_000
    })
  } catch {
    return { ok: false, error: 'unreachable', message: UNREACHABLE }
  }

  if (response.status === 204) return { ok: true, data: null as T }
  const json = (await response.json().catch(() => null)) as
    (T & { message?: string; error?: string; fields?: Record<string, string> }) | null

  if (response.ok && json) return { ok: true, data: upgradeEvents(json) }

  if (response.status === 426 && json?.error === 'update_required') {
    const required = noteUpdateRequired(json)
    return { ok: false, error: 'update_required', message: required.message }
  }
  if (response.status === 503 && notePaused(json)) {
    endSessionQuietly()
    return { ok: false, error: 'paused', message: json?.message ?? 'Glofly is paused.' }
  }
  if (response.status === 403 && json?.error === 'csrf' && !retried && (await refreshCsrf())) {
    return request<T>(method, path, body, file, true)
  }
  if (response.status === 401) {
    endSession()
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

/** Paused: the live connection closes (the app reloads once it's back) but the session stays. */
let onPause: (() => void) | null = null
export function setPauseHandler(handler: () => void): void {
  onPause = handler
}
function endSessionQuietly(): void {
  onPause?.()
}

/** Shapes the many { thing: … } answers into what the window expects. */
export async function unwrap<T, K extends string>(
  result: Promise<ApiResult<Record<K, T>>>,
  key: K
): Promise<ApiResult<T>> {
  const r = await result
  return r.ok ? { ok: true, data: r.data[key] } : r
}

export async function nothing(result: Promise<ApiResult<unknown>>): Promise<ApiResult<null>> {
  const r = await result
  return r.ok ? { ok: true, data: null } : r
}

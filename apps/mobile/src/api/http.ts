import { Platform } from 'react-native'
import { File } from 'expo-file-system'
import { pausedFrom, upgradeEvents, type ApiError, type ApiResult, type UpdateRequired } from '@glofly/shared'
import { SERVER_URL, VERSION_HEADERS } from '@/lib/config'
import { endSessionLocally, useSession } from '@/state/session'

// Every call to the Glofly server goes through here: the session token, the version headers,
// and the same error handling as the desktop app (401 → signed out, 426 → "Please update").

const UNREACHABLE = "Can't reach Glofly right now. Check your connection and try again."
const SERVER_ERROR = 'Something went wrong on our end. Try again in a moment.'

const errorFor: Record<number, ApiError> = {
  400: 'invalid',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'invalid',
  429: 'too_many_requests',
}

type Json = Record<string, unknown> & { message?: string; error?: string; fields?: Record<string, string> }

export function noteUpdateRequired(json: Partial<UpdateRequired> | null): UpdateRequired {
  const required: UpdateRequired = {
    message: typeof json?.message === 'string' ? json.message : 'This version of Glofly is too old. Please update it.',
    minVersion: typeof json?.minVersion === 'string' ? json.minVersion : null,
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.glofly.app',
  }
  useSession.getState().setUpdateRequired(required)
  return required
}

/** Glofly Control → Pause Glofly: the server answers 503 "paused". True if this was one. */
export function notePaused(status: number, json: unknown): boolean {
  if (status !== 503) return false
  const paused = pausedFrom(json)
  if (!paused) return false
  const now = useSession.getState().paused
  if (!now || now.message !== paused.message) useSession.getState().setPaused(paused)
  return true
}

/** Turns a server answer into an ApiResult (shared by JSON requests and uploads). */
export async function toResult<T>(status: number, json: Json | null, signedIn: boolean): Promise<ApiResult<T>> {
  if (status === 204) return { ok: true, data: null as T }
  if (status >= 200 && status < 300 && json) return { ok: true, data: upgradeEvents(json) as T }
  if (status === 426 && json?.error === 'update_required') {
    const required = noteUpdateRequired(json as Partial<UpdateRequired>)
    return { ok: false, error: 'update_required', message: required.message }
  }
  if (notePaused(status, json)) {
    return { ok: false, error: 'paused', message: typeof json?.message === 'string' ? json.message : 'Glofly is paused.' }
  }
  if (status === 401 && signedIn) {
    await endSessionLocally('You were signed out. Please log in again.')
    return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  }
  const fields =
    json?.fields && typeof json.fields === 'object'
      ? Object.fromEntries(Object.entries(json.fields).filter(([, v]) => typeof v === 'string'))
      : undefined
  return {
    ok: false,
    error: status === 401 ? 'unauthorized' : (errorFor[status] ?? 'server_error'),
    message: json?.message ?? (fields && Object.values(fields)[0]) ?? SERVER_ERROR,
    ...(fields ? { fields } : {}),
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** A request as the signed-in user (or without a token for sign-in, sign-up and the like). */
export async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  opts: { auth?: boolean; timeoutMs?: number } = {},
): Promise<ApiResult<T>> {
  const auth = opts.auth ?? true
  const token = useSession.getState().token
  if (auth && !token) return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  let response: Response
  try {
    response = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: {
        ...VERSION_HEADERS,
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    })
  } catch {
    return { ok: false, error: 'unreachable', message: UNREACHABLE }
  }
  const json = response.status === 204 ? null : ((await response.json().catch(() => null)) as Json | null)
  return toResult<T>(response.status, json, auth)
}

/** The raw JSON of a failed request (some answers carry extra fields, like `deleteAfter`). */
export async function requestRaw(
  method: Method,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json | null } | null> {
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: { ...VERSION_HEADERS, 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await response.json().catch(() => null)) as Json | null
    if (response.status === 426 && json?.error === 'update_required') noteUpdateRequired(json as Partial<UpdateRequired>)
    notePaused(response.status, json)
    return { status: response.status, json }
  } catch {
    return null
  }
}

export type Upload = { uri: string; type: string }

/**
 * Sends a file as the request body (photos, files, voice messages), with progress.
 * Phones stream it from disk; the web preview reads it into memory first.
 */
export async function upload<T>(
  method: 'POST' | 'PUT',
  path: string,
  file: Upload,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  const token = useSession.getState().token
  if (!token) return { ok: false, error: 'unauthorized', message: 'Please log in again.' }
  const headers = { ...VERSION_HEADERS, Authorization: `Bearer ${token}`, 'Content-Type': file.type }
  const url = `${SERVER_URL}${path}`
  try {
    if (Platform.OS === 'web') {
      const blob = await (await fetch(file.uri)).blob()
      const response = await fetch(url, { method, headers, body: blob, signal })
      onProgress?.(1)
      const json = (await response.json().catch(() => null)) as Json | null
      return toResult<T>(response.status, json, true)
    }
    const task = new File(file.uri).createUploadTask(url, {
      httpMethod: method,
      headers,
      mimeType: file.type,
      onProgress: ({ bytesSent, totalBytes }) => {
        if (totalBytes > 0) onProgress?.(Math.min(1, bytesSent / totalBytes))
      },
    })
    const abort = () => task.cancel()
    signal?.addEventListener('abort', abort)
    try {
      const result = await task.uploadAsync()
      let json: Json | null = null
      try {
        json = result.body ? (JSON.parse(result.body) as Json) : null
      } catch {
        json = null
      }
      return toResult<T>(result.status, json, true)
    } finally {
      signal?.removeEventListener('abort', abort)
      task.release()
    }
  } catch {
    if (signal?.aborted) return { ok: false, error: 'invalid', message: 'Cancelled.' }
    return { ok: false, error: 'unreachable', message: UNREACHABLE }
  }
}

/** Headers for loading pictures and files that need the session (photos, avatars, voice). */
export function authHeaders(): Record<string, string> {
  const token = useSession.getState().token
  return token ? { ...VERSION_HEADERS, Authorization: `Bearer ${token}` } : { ...VERSION_HEADERS }
}

export const url = (path: string) => `${SERVER_URL}${path}`

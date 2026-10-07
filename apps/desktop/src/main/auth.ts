import type { LoginRequest, LoginResult, SignedInUser } from '../preload/api-types'

// Where the Glofly server lives. Local for now; becomes the AWS address at release.
const API_URL = 'http://localhost:4000'

const DEVICE_NAME = `Glofly Desktop on ${
  process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'
}`

// The session token is kept here in the main process, never handed to the UI.
// That way, nothing running inside the window can read or steal it.
let sessionToken: string | null = null

export function getSessionToken(): string | null {
  return sessionToken
}

const UNREACHABLE = "Can't reach Glofly right now. Check your connection and try again."

export async function login(request: LoginRequest): Promise<LoginResult> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, deviceName: DEVICE_NAME }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    return { ok: false, reason: 'unreachable', message: UNREACHABLE }
  }

  const body = (await response.json().catch(() => null)) as {
    token?: string
    user?: SignedInUser
    error?: string
    message?: string
  } | null

  if (response.ok && body?.token && body.user) {
    sessionToken = body.token
    return { ok: true, user: body.user }
  }

  switch (response.status) {
    case 400:
      return { ok: false, reason: 'invalid', message: body?.message ?? 'Check your details.' }
    case 401:
      return {
        ok: false,
        reason: 'wrong_details',
        message: body?.message ?? "That username or password isn't right."
      }
    case 429:
      return {
        ok: false,
        reason: 'too_many_requests',
        message: body?.message ?? 'Too many login attempts. Wait a few minutes and try again.'
      }
    default:
      return {
        ok: false,
        reason: 'server_error',
        message: 'Something went wrong on our end. Try again in a moment.'
      }
  }
}

export async function logout(): Promise<void> {
  const token = sessionToken
  sessionToken = null
  if (!token) return
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000)
    })
  } catch {
    // Already signed out locally; the server session will expire on its own.
  }
}

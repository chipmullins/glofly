import { notePaused, noteUpdateRequired } from './app-status'
import type {
  ForgotPasswordResult,
  SignupMode,
  FriendLinkInfo,
  PublicUser,
  LoginRequest,
  ApiResult,
  LoginStepResult,
  LoginTwoStep,
  QrLoginStart,
  QrPollResult,
  TwoStepMethod,
  RegisterRequest,
  RegisterResult,
  SignedInUser,
  UsernameCheck
} from '../preload/api-types'
import { hostname } from 'node:os'
import { app } from 'electron'
import { clearToken, loadToken, saveToken } from './session-store'

// Where the Glofly server lives. This PC (localhost) unless apps/desktop/.env.local says
// otherwise, e.g. to test on other computers at home:
//   MAIN_VITE_SERVER_URL=http://192.168.1.50:4000
// It's read when the app is built (npm run dev / npm run build:win), so rebuild after changing it.
// Becomes the AWS (https) address at release.
const API_URL = serverUrl(import.meta.env.MAIN_VITE_SERVER_URL)

function serverUrl(setting: string | undefined): string {
  const fallback = 'http://localhost:4000'
  if (!setting) return fallback
  try {
    const url = new URL(setting.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http')
    return url.origin // no trailing slash or path
  } catch {
    console.error(`MAIN_VITE_SERVER_URL isn't a web address (${setting}). Using ${fallback}.`)
    return fallback
  }
}

/** Sent with every request so Glofly Control can show which app versions are in use. */
export const VERSION_HEADER = {
  'X-Glofly-Version': app.getVersion(),
  // Communities round: this app knows threads and forum nebulas; Nov 2026: Campfire
  'X-Glofly-Features': 'threads,campfire'
}

// Shown in Settings → Account → Where you're signed in, only to you: "Windows · DESKTOP-4KQ2".
const DEVICE_NAME = deviceName()

function deviceName(): string {
  const system =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'
  // The computer's name, without anything that could break a layout; cut to fit the server's 60.
  const computer = hostname()
    .replace(/\.local$/i, '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 40)
  return computer ? `${system} · ${computer}` : `Glofly Desktop on ${system}`
}

// The session token is kept here in the main process, never handed to the UI.
// That way, nothing running inside the window can read or steal it.
let sessionToken: string | null = null

export function getSessionToken(): string | null {
  return sessionToken
}

/** The server says this session is no longer valid: forget it on this device. */
export async function endSessionLocally(): Promise<void> {
  sessionToken = null
  await clearToken()
}

export { API_URL }

const UNREACHABLE = "Can't reach Glofly right now. Check your connection and try again."

/** "Keep me signed in" from the password step, for the two-step code that finishes it (0.7.3). */
let pendingKeep = false

async function postAuth(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...VERSION_HEADER },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    return null
  }
}

export async function login(request: LoginRequest): Promise<LoginStepResult> {
  pendingKeep = request.keepSignedIn
  // twoStepAware (0.7.3): this app can ask for a two-step code.
  const response = await postAuth('/auth/login', {
    ...request,
    deviceName: DEVICE_NAME,
    twoStepAware: true
  })
  if (!response) return { ok: false, reason: 'unreachable', message: UNREACHABLE }
  return signInAnswer(response, request.keepSignedIn)
}

/** 0.7.3: the two-step code (or a backup code). */
export async function loginCode(challenge: string, code: string): Promise<LoginStepResult> {
  const response = await postAuth('/auth/login/code', { challenge, code })
  if (!response) return { ok: false, reason: 'unreachable', message: UNREACHABLE }
  return signInAnswer(response, pendingKeep)
}

/** 0.7.3: another code (optionally the other way). */
export async function loginResend(
  challenge: string,
  method?: TwoStepMethod
): Promise<ApiResult<LoginTwoStep['twoStep']>> {
  const response = await postAuth('/auth/login/resend', { challenge, method })
  if (!response) return { ok: false, error: 'unreachable', message: UNREACHABLE }
  const body = (await response.json().catch(() => null)) as
    (Partial<LoginTwoStep> & { error?: string; message?: string }) | null
  if (response.ok && body?.twoStep) return { ok: true, data: body.twoStep }
  return {
    ok: false,
    error: (body?.error as 'invalid') ?? 'invalid',
    message: body?.message ?? 'Something went wrong. Try again.'
  }
}

/** 0.7.3 QR code sign-in: a new code to show. */
let qrKeep = true
export async function qrStart(keepSignedIn: boolean): Promise<ApiResult<QrLoginStart>> {
  qrKeep = keepSignedIn
  const response = await postAuth('/auth/qr', { deviceName: DEVICE_NAME, keepSignedIn })
  if (!response) return { ok: false, error: 'unreachable', message: UNREACHABLE }
  const body = (await response.json().catch(() => null)) as
    (QrLoginStart & { error?: string; message?: string }) | null
  if (response.ok && body?.id && body.secret && body.url) return { ok: true, data: body }
  if (response.status === 426 && body?.error === 'update_required') noteUpdateRequired(body)
  return {
    ok: false,
    error: 'invalid',
    message: body?.message ?? "Couldn't make a QR code right now. Try again in a moment."
  }
}

/** 0.7.3: how the QR code is doing. Approved: signed in here (token kept like a login's). */
export async function qrPoll(id: string, secret: string): Promise<QrPollResult> {
  const response = await postAuth(`/auth/qr/${id}/poll`, { secret })
  if (!response) return { state: 'error', message: UNREACHABLE }
  const body = (await response.json().catch(() => null)) as {
    token?: string
    user?: SignedInUser
    state?: string
    by?: { id: string; displayName: string; avatarVersion: string | null }
    message?: string
  } | null
  if (response.ok && body?.token && body.user) {
    sessionToken = body.token
    if (qrKeep) await saveToken(body.token)
    else await clearToken()
    return { state: 'signed-in', user: body.user }
  }
  if (body?.state === 'scanned' && body.by) return { state: 'scanned', by: body.by }
  if (body?.state === 'waiting' || body?.state === 'declined' || body?.state === 'expired')
    return { state: body.state }
  return { state: 'error', message: body?.message ?? 'Something went wrong. Try again.' }
}

/** What the server said to a sign-in (password, code): signed in, a code needed, or why not. */
async function signInAnswer(response: Response, keepSignedIn: boolean): Promise<LoginStepResult> {
  const body = (await response.json().catch(() => null)) as {
    token?: string
    user?: SignedInUser
    error?: string
    message?: string
    deleteAfter?: string
    twoStep?: LoginTwoStep['twoStep']
  } | null

  if (response.ok && body?.token && body.user) {
    sessionToken = body.token
    if (keepSignedIn) await saveToken(body.token)
    else await clearToken()
    return { ok: true, user: body.user }
  }
  if (response.ok && body?.twoStep) {
    return { ok: false, reason: 'two_step', message: '', twoStep: body.twoStep }
  }
  if (body?.error === 'wrong_code')
    return { ok: false, reason: 'wrong_code', message: body.message ?? "That code isn't right." }
  if (response.status === 410 || body?.error === 'expired')
    return {
      ok: false,
      reason: 'code_expired',
      message: body?.message ?? 'That took too long. Sign in again.'
    }
  if (response.status === 502 && body?.message)
    return { ok: false, reason: 'server_error', message: body.message }

  if (response.status === 426 && body?.error === 'update_required') {
    return { ok: false, reason: 'update_required', message: noteUpdateRequired(body).message }
  }
  if (response.status === 503 && notePaused(body)) {
    return { ok: false, reason: 'server_error', message: body?.message ?? 'Glofly is paused.' }
  }
  if (
    response.status === 403 &&
    body?.error === 'deletion_scheduled' &&
    typeof body.deleteAfter === 'string'
  ) {
    return {
      ok: false,
      reason: 'deletion_scheduled',
      message: 'This account is set to be deleted.',
      deleteAfter: body.deleteAfter
    }
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

/** 0.8.0: who the sign-up made you friends with (from a friend's invite link). */
function cleanLinkedFriend(u: unknown): PublicUser | null {
  const x = u as Record<string, unknown> | null
  if (!x || typeof x.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(x.id)) return null
  return {
    id: x.id,
    username: typeof x.username === 'string' ? x.username.slice(0, 40) : '',
    displayName: typeof x.displayName === 'string' ? x.displayName.slice(0, 64) : '',
    avatarVersion: typeof x.avatarVersion === 'string' ? x.avatarVersion.slice(0, 64) : null
  }
}

export async function register(request: RegisterRequest): Promise<RegisterResult> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...VERSION_HEADER },
      body: JSON.stringify({ ...request, deviceName: DEVICE_NAME }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    return { ok: false, fields: {}, message: UNREACHABLE }
  }

  const body = (await response.json().catch(() => null)) as {
    token?: string
    user?: SignedInUser
    linkedFriend?: unknown
    fields?: Record<string, string>
    message?: string
    error?: string
  } | null

  if (response.status === 426 && body?.error === 'update_required') {
    return { ok: false, fields: {}, message: noteUpdateRequired(body).message }
  }
  if (response.status === 503 && notePaused(body)) {
    return { ok: false, fields: {}, message: body?.message ?? 'Glofly is paused.' }
  }
  if (response.status === 201 && body?.token && body.user) {
    sessionToken = body.token
    await saveToken(body.token) // new accounts start out kept signed in
    const friend = cleanLinkedFriend(body.linkedFriend)
    return { ok: true, user: body.user, ...(friend ? { linkedFriend: friend } : {}) }
  }
  if ((response.status === 400 || response.status === 409) && body?.fields) {
    return { ok: false, fields: body.fields }
  }
  if (response.status === 429) {
    return {
      ok: false,
      fields: {},
      message: body?.message ?? 'Too many sign-up attempts. Try again later.'
    }
  }
  // Sign-ups are closed (Glofly Control → Sign-ups).
  if (response.status === 403 && body?.message)
    return { ok: false, fields: {}, message: body.message }
  return {
    ok: false,
    fields: {},
    message: 'Something went wrong on our end. Try again in a moment.'
  }
}

/** Forgot password. Not signed in, so it doesn't go through the shared request helper. */
export async function forgotPassword(identifier: string): Promise<ForgotPasswordResult> {
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    return { ok: false, message: UNREACHABLE }
  }
  if (response.ok) return { ok: true }
  const body = (await response.json().catch(() => null)) as { message?: string } | null
  if (response.status === 429) {
    return {
      ok: false,
      message: body?.message ?? 'Too many tries. Wait a few minutes and try again.'
    }
  }
  if (response.status === 400) return { ok: false, message: 'Enter your username or email.' }
  return { ok: false, message: 'Something went wrong on our end. Try again in a moment.' }
}

export async function checkUsername(username: string): Promise<UsernameCheck | null> {
  try {
    const response = await fetch(
      `${API_URL}/auth/username-available?username=${encodeURIComponent(username)}`,
      { signal: AbortSignal.timeout(5_000) }
    )
    if (!response.ok) return null
    const body = (await response.json()) as UsernameCheck
    return typeof body.available === 'boolean' ? body : null
  } catch {
    return null
  }
}

/** Who can sign up right now: open, invite only (needs a code) or closed. Null if unknown. */
export async function signupMode(): Promise<SignupMode | null> {
  try {
    const response = await fetch(`${API_URL}/auth/signups`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return null
    const body = (await response.json()) as { mode?: unknown }
    return body.mode === 'open' || body.mode === 'invite' || body.mode === 'closed'
      ? body.mode
      : null
  } catch {
    return null
  }
}

/** 0.8.0: whose friend invite link this is (the sign-up screen's "Chip invited you"). */
export async function friendLinkInfo(code: string): Promise<FriendLinkInfo | null> {
  try {
    const response = await fetch(`${API_URL}/i/${encodeURIComponent(code)}/info`, {
      signal: AbortSignal.timeout(5_000)
    })
    if (!response.ok) return null
    const body = (await response.json()) as Partial<FriendLinkInfo>
    return typeof body.displayName === 'string' && typeof body.username === 'string'
      ? { displayName: body.displayName.slice(0, 64), username: body.username.slice(0, 40) }
      : null
  } catch {
    return null
  }
}

/** On launch: signs back in with the saved session, if there is a valid one. */
export async function restore(): Promise<SignedInUser | null> {
  const token = await loadToken()
  if (!token) return null

  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, ...VERSION_HEADER },
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    // Server unreachable: keep the saved session so it works next time.
    return null
  }

  if (response.status === 401) {
    // Expired or signed out elsewhere: forget it.
    await clearToken()
    return null
  }
  if (response.status === 426) {
    // Too old for the server: keep the saved session for after the update.
    noteUpdateRequired(await response.json().catch(() => null))
    return null
  }
  if (response.status === 503) {
    // Paused (Glofly Control): keep the saved session; the window reloads once it's back.
    notePaused(await response.json().catch(() => null))
    return null
  }

  const body = (await response.json().catch(() => null)) as { user?: SignedInUser } | null
  if (!response.ok || !body?.user) return null

  sessionToken = token
  return body.user
}

export async function logout(): Promise<void> {
  const token = sessionToken
  sessionToken = null
  await clearToken()
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

import type {
  ForgotPasswordResult,
  ApiResult,
  LoginRequest,
  LoginStepResult,
  LoginTwoStep,
  QrLoginStart,
  QrPollResult,
  TwoStepMethod,
  RegisterRequest,
  RegisterResult,
  SignedInUser,
  SignupMode,
  UsernameCheck,
  FriendLinkInfo,
  PublicUser
} from '../../../desktop/src/preload/api-types'
import { FRIEND_LINK_PATTERN } from '@glofly/shared/friendLinks'
import { endSession, isSignedIn, serverFetch, startSession } from './api'
import { API_URL, APP_HEADERS, DEVICE_NAME, UNREACHABLE } from './config'
import { notePaused, noteUpdateRequired } from './appStatus'

// Signing in from a browser (the desktop app's src/main/auth.ts). The server answers a web
// sign-in with an httpOnly session cookie (never visible to this page) plus a CSRF value, kept
// in memory only. "Keep me signed in" decides whether the cookie outlives the browser.

type SignInBody = {
  twoStep?: LoginTwoStep['twoStep']
  user?: SignedInUser
  csrf?: string
  error?: string
  message?: string
  deleteAfter?: string
  fields?: Record<string, string>
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...APP_HEADERS },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000)
  })
}

export async function login(request: LoginRequest): Promise<LoginStepResult> {
  let response: Response
  try {
    // twoStepAware (0.7.3): this app can ask for a two-step code.
    response = await post('/auth/login', {
      ...request,
      deviceName: DEVICE_NAME,
      twoStepAware: true
    })
  } catch {
    return { ok: false, reason: 'unreachable', message: UNREACHABLE }
  }
  return signInAnswer(response)
}

/** 0.7.3: the two-step code (or a backup code). The cookie comes with the answer. */
export async function loginCode(challenge: string, code: string): Promise<LoginStepResult> {
  let response: Response
  try {
    response = await post('/auth/login/code', { challenge, code })
  } catch {
    return { ok: false, reason: 'unreachable', message: UNREACHABLE }
  }
  return signInAnswer(response)
}

export async function loginResend(
  challenge: string,
  method?: TwoStepMethod
): Promise<ApiResult<LoginTwoStep['twoStep']>> {
  try {
    const response = await post('/auth/login/resend', { challenge, method })
    const body = (await response.json().catch(() => null)) as SignInBody | null
    if (response.ok && body?.twoStep) return { ok: true, data: body.twoStep }
    return {
      ok: false,
      error: 'invalid',
      message: body?.message ?? 'Something went wrong. Try again.'
    }
  } catch {
    return { ok: false, error: 'unreachable', message: UNREACHABLE }
  }
}

/** 0.7.3 QR code sign-in. */
export async function qrStart(keepSignedIn: boolean): Promise<ApiResult<QrLoginStart>> {
  try {
    const response = await post('/auth/qr', { deviceName: DEVICE_NAME, keepSignedIn })
    const body = (await response.json().catch(() => null)) as
      (QrLoginStart & { error?: string; message?: string }) | null
    if (response.ok && body?.id && body.secret && body.url) return { ok: true, data: body }
    if (response.status === 426 && body?.error === 'update_required') noteUpdateRequired(body)
    return {
      ok: false,
      error: 'invalid',
      message: body?.message ?? "Couldn't make a QR code right now. Try again in a moment."
    }
  } catch {
    return { ok: false, error: 'unreachable', message: UNREACHABLE }
  }
}

export async function qrPoll(id: string, secret: string): Promise<QrPollResult> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(id)) return { state: 'expired' }
  try {
    const response = await post(`/auth/qr/${id}/poll`, { secret })
    const body = (await response.json().catch(() => null)) as
      | (SignInBody & {
          state?: string
          by?: { id: string; displayName: string; avatarVersion: string | null }
        })
      | null
    if (response.ok && body?.user && typeof body.csrf === 'string') {
      startSession(body.csrf)
      return { state: 'signed-in', user: body.user }
    }
    if (body?.state === 'scanned' && body.by) return { state: 'scanned', by: body.by }
    if (body?.state === 'waiting' || body?.state === 'declined' || body?.state === 'expired')
      return { state: body.state }
    return { state: 'error', message: body?.message ?? 'Something went wrong. Try again.' }
  } catch {
    return { state: 'error', message: UNREACHABLE }
  }
}

async function signInAnswer(response: Response): Promise<LoginStepResult> {
  const body = (await response.json().catch(() => null)) as SignInBody | null

  if (response.ok && body?.user && typeof body.csrf === 'string') {
    startSession(body.csrf)
    return { ok: true, user: body.user }
  }
  if (response.ok && body?.twoStep)
    return { ok: false, reason: 'two_step', message: '', twoStep: body.twoStep }
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
    case 403:
      return { ok: false, reason: 'server_error', message: body?.message ?? 'Not allowed here.' }
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
    response = await post('/auth/register', { ...request, deviceName: DEVICE_NAME })
  } catch {
    return { ok: false, fields: {}, message: UNREACHABLE }
  }
  const body = (await response.json().catch(() => null)) as SignInBody | null

  if (response.status === 426 && body?.error === 'update_required') {
    return { ok: false, fields: {}, message: noteUpdateRequired(body).message }
  }
  if (response.status === 503 && notePaused(body)) {
    return { ok: false, fields: {}, message: body?.message ?? 'Glofly is paused.' }
  }
  if (response.status === 201 && body?.user && typeof body.csrf === 'string') {
    startSession(body.csrf)
    const friend = cleanLinkedFriend((body as { linkedFriend?: unknown }).linkedFriend)
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
  if (response.status === 403 && body?.message)
    return { ok: false, fields: {}, message: body.message }
  return {
    ok: false,
    fields: {},
    message: 'Something went wrong on our end. Try again in a moment.'
  }
}

export async function forgotPassword(identifier: string): Promise<ForgotPasswordResult> {
  const value = identifier.trim()
  if (!value || value.length > 254) return { ok: false, message: 'Enter your username or email.' }
  let response: Response
  try {
    response = await fetch(`${API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: value }),
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
  if (username.length > 40) return null
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
  if (!FRIEND_LINK_PATTERN.test(code)) return null
  try {
    const response = await fetch(`${API_URL}/i/${code}/info`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok) return null
    const body = (await response.json()) as Partial<FriendLinkInfo>
    return typeof body.displayName === 'string' && typeof body.username === 'string'
      ? { displayName: body.displayName.slice(0, 64), username: body.username.slice(0, 40) }
      : null
  } catch {
    return null
  }
}

/** On opening the page: still signed in? (The cookie, if there is one, says.) */
export async function restore(): Promise<SignedInUser | null> {
  let response: Response
  try {
    response = await serverFetch('GET', '/auth/me')
  } catch {
    return null
  }
  if (response.status === 426) {
    noteUpdateRequired(await response.json().catch(() => null))
    return null
  }
  if (response.status === 503) {
    notePaused(await response.json().catch(() => null))
    return null
  }
  const body = (await response.json().catch(() => null)) as SignInBody | null
  if (!response.ok || !body?.user || typeof body.csrf !== 'string') return null
  startSession(body.csrf)
  return body.user
}

/** Who's signed in, asked again (0.4.0: picks up "Restricted" changes). */
export async function me(): Promise<SignedInUser | null> {
  if (!isSignedIn()) return null
  try {
    const response = await serverFetch('GET', '/auth/me')
    if (response.status === 401) {
      endSession()
      return null
    }
    const body = (await response.json().catch(() => null)) as SignInBody | null
    if (!response.ok || !body?.user) return null
    if (typeof body.csrf === 'string') startSession(body.csrf)
    return body.user
  } catch {
    return null
  }
}

export async function logout(): Promise<void> {
  try {
    await serverFetch('POST', '/auth/logout', { timeoutMs: 5_000 })
  } catch {
    // Offline: signed out here anyway. The server's session expires on its own (only the
    // server can clear an httpOnly cookie, and a cookie for an ended session does nothing).
  }
  endSession()
}

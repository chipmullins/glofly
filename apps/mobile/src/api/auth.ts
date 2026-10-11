import { Platform } from 'react-native'
import * as Device from 'expo-device'
import type {
  ForgotPasswordResult,
  LoginRequest,
  LoginResult,
  RegisterRequest,
  RegisterResult,
  SignedInUser,
  SignupMode,
  UsernameCheck,
} from '@glofly/shared'
import { request, requestRaw } from './http'
import { endSessionLocally, startSession, useSession } from '@/state/session'

/** What "Where you're signed in" calls this phone, e.g. "Android · Pixel 8". */
export function deviceName(): string {
  const os = Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'Web'
  const model = Device.modelName?.trim()
  return (model ? `${os} · ${model}` : os).slice(0, 60)
}

const UNREACHABLE = "Can't reach Glofly right now. Check your connection and try again."

export async function login(req: LoginRequest): Promise<LoginResult> {
  const answer = await requestRaw('POST', '/auth/login', { ...req, deviceName: deviceName() })
  if (!answer) return { ok: false, reason: 'unreachable', message: UNREACHABLE }
  const { status, json } = answer
  if (status === 200 && json && typeof json.token === 'string') {
    const user = json.user as SignedInUser
    await startSession(json.token, user, req.keepSignedIn)
    return { ok: true, user }
  }
  const message = typeof json?.message === 'string' ? json.message : 'Something went wrong. Try again.'
  if (status === 426) return { ok: false, reason: 'update_required', message }
  if (status === 403 && json?.error === 'deletion_scheduled')
    return { ok: false, reason: 'deletion_scheduled', message, deleteAfter: String(json.deleteAfter ?? '') }
  if (status === 401) return { ok: false, reason: 'wrong_details', message }
  if (status === 400) return { ok: false, reason: 'invalid', message }
  if (status === 429) return { ok: false, reason: 'too_many_requests', message }
  return { ok: false, reason: 'server_error', message }
}

export async function register(req: RegisterRequest): Promise<RegisterResult> {
  const answer = await requestRaw('POST', '/auth/register', { ...req, deviceName: deviceName() })
  if (!answer) return { ok: false, fields: {}, message: UNREACHABLE }
  const { status, json } = answer
  if (status === 201 && json && typeof json.token === 'string') {
    const user = json.user as SignedInUser
    // New accounts stay signed in (like the desktop app).
    await startSession(json.token, user, true)
    return { ok: true, user }
  }
  const fields = (json?.fields && typeof json.fields === 'object' ? json.fields : {}) as Record<string, string>
  const message = typeof json?.message === 'string' ? json.message : undefined
  if (status === 429) return { ok: false, fields, message: message ?? 'Too many sign-ups from here. Try again later.' }
  return { ok: false, fields, message: Object.keys(fields).length ? message : (message ?? 'Something went wrong. Try again.') }
}

export async function usernameAvailable(username: string): Promise<UsernameCheck | null> {
  const r = await request<UsernameCheck>('GET', `/auth/username-available?username=${encodeURIComponent(username)}`, undefined, { auth: false })
  return r.ok ? r.data : null
}

export async function signupMode(): Promise<SignupMode> {
  const r = await request<{ mode: SignupMode }>('GET', '/auth/signups', undefined, { auth: false })
  return r.ok ? r.data.mode : 'open'
}

export async function forgotPassword(identifier: string): Promise<ForgotPasswordResult> {
  const r = await request<{ ok: true }>('POST', '/auth/forgot-password', { identifier }, { auth: false })
  return r.ok ? { ok: true } : { ok: false, message: r.message }
}

/** Signs this phone out: the server forgets the session (and its push registration). */
export async function logout(): Promise<void> {
  const token = useSession.getState().token
  if (token) await request('POST', '/auth/logout').catch(() => null)
  await endSessionLocally()
}

/** Who the saved token belongs to (refreshes the name and photo; 401 signs out). */
export async function refreshMe(): Promise<void> {
  const r = await request<{ user: SignedInUser }>('GET', '/auth/me')
  if (r.ok) useSession.getState().setUser(r.data.user)
}

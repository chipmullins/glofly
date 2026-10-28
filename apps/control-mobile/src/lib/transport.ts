import type { AdminUser, CallResult, ControlApi, Failure } from '../../../control/src/preload/types'
import { signRequest, type RandomBytes } from './signing'

// The phone's `window.control.call` (what apps/control/src/renderer/src/lib/api.ts calls), plus the
// steps around it: approving the phone, signing in, signing out. Like desktop Control's main
// process (apps/control/src/main/api.ts), but every request is signed with the phone's key.
//
// The private key and the session token live only in memory here; the key is read from the
// Keychain (behind Face ID) by the app and handed in with `unlock()`. No React Native imports, so the
// Node test (test/transport.e2e.ts) exercises this exact code against a live server.

export type Method = Parameters<ControlApi['call']>[0]
export type EndReason = 'expired' | 'ended' | 'phone_removed'

export type TransportDeps = {
  serverUrl: string
  randomBytes: RandomBytes
  fetch?: typeof fetch
  now?: () => number
  /** Sent with sign-in (the audit log shows the approved phone's name anyway). */
  deviceName?: () => string
}

export const UNREACHABLE = "Can't reach the Glofly server. Check your connection and try again."
const TIMEOUT_MS = 20_000

type Raw = { status: number; json: Record<string, unknown> | null; text: string }

/** Same messages as desktop Control's `failure()` (apps/control/src/main/api.ts). */
export function failure(raw: Raw | null): Failure {
  if (!raw) return { ok: false, status: 0, error: 'unreachable', message: UNREACHABLE }
  const json = raw.json ?? {}
  const fields =
    json.fields && typeof json.fields === 'object'
      ? Object.fromEntries(
          Object.entries(json.fields as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as [string, string][],
        )
      : undefined
  const message =
    typeof json.message === 'string'
      ? json.message
      : fields && Object.values(fields)[0]
        ? Object.values(fields)[0]
        : raw.status === 429
          ? 'Too many tries. Wait a few minutes and try again.'
          : 'Something went wrong on the server. Try again in a moment.'
  return {
    ok: false,
    status: raw.status,
    error: typeof json.error === 'string' ? json.error : 'server_error',
    message,
    ...(fields ? { fields } : {}),
  }
}

/** A 401 phone_not_approved that means "removed in desktop Control" (not a wrong clock). */
export const isPhoneRemoved = (f: Failure): boolean =>
  f.status === 401 && f.error === 'phone_not_approved' && !/clock/i.test(f.message)

export type SignedIn = {
  ok: true
  token: string
  expiresAt: string
  admin: AdminUser
  backupCodesLeft: number
  /** Oct 28, 2026: the Face ID sign-in secret (only after a password + code sign-in that asked for it) */
  remember?: string
  /** Until when Face ID can sign this phone back in */
  rememberUntil?: string
}

export function createTransport(deps: TransportDeps) {
  const base = deps.serverUrl.replace(/\/+$/, '')
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? (() => Date.now())

  let deviceId: string | null = null
  let secretKeyHex: string | null = null
  let challenge: string | null = null
  let token: string | null = null
  let expiresAt: number | null = null
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<(reason: EndReason, message?: string) => void>()

  function forget(reason: EndReason | null, message?: string): void {
    const had = token !== null || reason === 'phone_removed'
    token = null
    expiresAt = null
    challenge = null
    secretKeyHex = null
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
    if (had && reason) for (const l of listeners) l(reason, message)
  }

  async function send(method: string, path: string, body: unknown, opts: { sign: boolean; auth: boolean }): Promise<Raw | null> {
    const bodyText = body !== undefined ? JSON.stringify(body) : ''
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.sign) {
      if (!deviceId || !secretKeyHex) return { status: 401, json: { error: 'locked', message: 'Unlock with Face ID first.' }, text: '' }
      Object.assign(headers, signRequest({ deviceId, secretKeyHex, method, path, bodyText, time: now(), randomBytes: deps.randomBytes }))
    }
    if (opts.auth && token) headers.Authorization = `Bearer ${token}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await doFetch(`${base}${path}`, {
        method,
        headers,
        body: body !== undefined ? bodyText : undefined,
        signal: controller.signal,
      })
      const text = await response.text()
      let json: Record<string, unknown> | null = null
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : null
      } catch {
        json = null
      }
      return { status: response.status, json, text }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  function scheduleExpiry(): void {
    if (expiryTimer) clearTimeout(expiryTimer)
    if (!expiresAt) return
    expiryTimer = setTimeout(() => forget('expired'), Math.max(expiresAt - now(), 0))
  }

  /** A signed request's failure: a removed phone wipes everything, a 401 ends the session. */
  function settle(raw: Raw | null): Failure {
    const f = failure(raw)
    if (isPhoneRemoved(f)) forget('phone_removed', f.message)
    else if (f.status === 401 && token) forget('ended', f.message)
    return f
  }

  /** A session from a sign-in answer (password + code, or Face ID). */
  function started(json: Record<string, unknown>): SignedIn {
    token = String(json.token)
    expiresAt = Date.parse(String(json.expiresAt))
    scheduleExpiry()
    return {
      ok: true,
      token,
      expiresAt: String(json.expiresAt),
      admin: json.admin as AdminUser,
      backupCodesLeft: Number(json.backupCodesLeft ?? 0),
      ...(typeof json.remember === 'string' ? { remember: json.remember } : {}),
      ...(typeof json.rememberUntil === 'string' ? { rememberUntil: json.rememberUntil } : {}),
    }
  }

  const transport = {
    /** The approved phone's id (from secure storage, not secret). */
    setDevice(id: string | null) {
      deviceId = id
    },
    /** The private key, read from the Keychain with Face ID. Kept in memory until sign-out. */
    unlock(secretHex: string) {
      secretKeyHex = secretHex
    },
    get unlocked() {
      return secretKeyHex !== null
    },
    get signedIn() {
      return token !== null && (expiresAt ?? 0) > now()
    },
    get expiresAt() {
      return expiresAt
    },
    onEnd(listener: (reason: EndReason, message?: string) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** POST /admin/devices/pair: not signed, no token (the phone isn't approved yet). Home network only. */
    async pair(code: string, publicKey: string, name: string): Promise<{ ok: true; deviceId: string } | Failure> {
      const raw = await send('POST', '/admin/devices/pair', { code, publicKey, name }, { sign: false, auth: false })
      if (raw && raw.status >= 200 && raw.status < 300 && typeof raw.json?.deviceId === 'string') {
        return { ok: true, deviceId: raw.json.deviceId }
      }
      return failure(raw)
    },

    async signInPassword(username: string, password: string): Promise<{ ok: true; username: string; displayName: string } | Failure> {
      token = null
      expiresAt = null
      challenge = null
      const raw = await send(
        'POST',
        '/admin/auth/password',
        { username, password, ...(deps.deviceName ? { deviceName: deps.deviceName() } : {}) },
        { sign: true, auth: false },
      )
      if (raw?.status === 200 && typeof raw.json?.challenge === 'string') {
        challenge = raw.json.challenge
        return { ok: true, username: String(raw.json.username ?? username), displayName: String(raw.json.displayName ?? '') }
      }
      const f = failure(raw)
      if (isPhoneRemoved(f)) forget('phone_removed', f.message)
      return f
    },

    get hasChallenge() {
      return challenge !== null
    },

    async signInCode(kind: 'code' | 'backupCode', value: string, opts: { remember?: boolean } = {}): Promise<SignedIn | Failure> {
      if (!challenge) return { ok: false, status: 401, error: 'start_over', message: 'Start over.' }
      const raw = await send(
        'POST',
        '/admin/auth/code',
        { challenge, [kind]: value, ...(opts.remember ? { remember: true } : {}) },
        { sign: true, auth: false },
      )
      if (raw?.status === 200 && typeof raw.json?.token === 'string') {
        challenge = null
        return started(raw.json)
      }
      const f = failure(raw)
      if (f.error === 'start_over') challenge = null
      if (isPhoneRemoved(f)) forget('phone_removed', f.message)
      return f
    },

    /** Oct 28, 2026: Face ID sign-in. The key must be unlocked (that's the Face ID part). */
    async resume(remember: string): Promise<SignedIn | Failure> {
      token = null
      expiresAt = null
      challenge = null
      const raw = await send('POST', '/admin/auth/resume', { remember }, { sign: true, auth: false })
      if (raw?.status === 200 && typeof raw.json?.token === 'string') return started(raw.json)
      const f = failure(raw)
      if (isPhoneRemoved(f)) forget('phone_removed', f.message)
      return f
    },

    /** Ends the session on the server (best effort) and forgets the key and token. */
    async signOut(): Promise<void> {
      if (token && secretKeyHex) await send('POST', '/admin/auth/logout', undefined, { sign: true, auth: true })
      forget(null)
    },

    /** Forgets everything in memory and tells listeners (e.g. 5 minutes in the background). */
    end(reason: EndReason, message?: string) {
      forget(reason, message)
    },

    /** What `window.control.call` is: signed, with the session token. */
    async call(method: Method, path: string, body?: unknown): Promise<CallResult> {
      if (!path.startsWith('/admin/')) return { ok: false, status: 400, error: 'invalid', message: 'Not a Control address.' }
      if (!transport.signedIn) {
        forget('ended')
        return { ok: false, status: 401, error: 'unauthorized', message: 'Sign in again.' }
      }
      const raw = await send(method, path, body, { sign: true, auth: true })
      if (raw && raw.status >= 200 && raw.status < 300) return { ok: true, data: raw.json ?? {} }
      return settle(raw)
    },
  }
  return transport
}

export type Transport = ReturnType<typeof createTransport>

/** Makes `window.control` (in React Native `window` is the global object) for api.ts. */
export function installWindowControl(t: Transport): void {
  const g = globalThis as unknown as { window?: Record<string, unknown> }
  if (!g.window) g.window = globalThis as unknown as Record<string, unknown>
  g.window.control = { call: (method: Method, path: string, body?: unknown) => t.call(method, path, body) }
}

import { hostname } from 'os'
import type { CallResult, SignInCodeResult, SignInPasswordResult } from '../preload/types'

// Talks to the Glofly server's /admin routes. The admin session token (and the sign-in
// challenge between the two steps) live only here in the main process: the window never
// sees them. Nothing is saved to disk: every launch signs in again, and a session ends
// after 60 minutes (the server decides; this just follows it).

export const SERVER_URL = (import.meta.env.MAIN_VITE_SERVER_URL || 'http://localhost:4000').replace(
  /\/+$/,
  ''
)

let challenge: string | null = null
let token: string | null = null
let expiresAt: number | null = null
let expiryTimer: NodeJS.Timeout | null = null
let onSignedOut: (reason: 'expired' | 'ended') => void = () => {}

export function whenSignedOut(callback: (reason: 'expired' | 'ended') => void): void {
  onSignedOut = callback
}

function forget(reason: 'expired' | 'ended' | null): void {
  const hadSession = token !== null
  token = null
  expiresAt = null
  challenge = null
  if (expiryTimer) clearTimeout(expiryTimer)
  expiryTimer = null
  if (hadSession && reason) onSignedOut(reason)
}

// "Windows · CHIP-DESKTOP", shown in the audit log next to each sign-in.
const DEVICE_NAME = (() => {
  const system =
    process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'Mac' : 'Linux'
  const computer = hostname()
    .replace(/\.local$/i, '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 40)
  return computer ? `${system} · ${computer}` : system
})()

const UNREACHABLE = "Can't reach the Glofly server. Check your connection and try again."

type Raw = { status: number; json: Record<string, unknown> | null; text: string }

async function send(
  method: string,
  path: string,
  body?: unknown,
  auth = false
): Promise<Raw | null> {
  try {
    const response = await fetch(`${SERVER_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000)
    })
    const text = await response.text()
    let json: Record<string, unknown> | null = null
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = null
    }
    return { status: response.status, json, text }
  } catch {
    return null
  }
}

function failure(raw: Raw | null): Extract<CallResult, { ok: false }> {
  if (!raw) return { ok: false, status: 0, error: 'unreachable', message: UNREACHABLE }
  const json = raw.json ?? {}
  const fields =
    json.fields && typeof json.fields === 'object'
      ? Object.fromEntries(
          Object.entries(json.fields as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'string'
          ) as [string, string][]
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
    ...(fields ? { fields } : {})
  }
}

// ───────────── Signing in ─────────────

export async function signInPassword(
  username: string,
  password: string
): Promise<SignInPasswordResult> {
  forget(null)
  const raw = await send('POST', '/admin/auth/password', {
    username,
    password,
    deviceName: DEVICE_NAME
  })
  if (raw?.status === 200 && typeof raw.json?.challenge === 'string') {
    challenge = raw.json.challenge
    return {
      ok: true,
      username: String(raw.json.username ?? username),
      displayName: String(raw.json.displayName ?? '')
    }
  }
  return failure(raw)
}

export async function signInCode(
  kind: 'code' | 'backupCode',
  value: string
): Promise<SignInCodeResult> {
  if (!challenge) {
    return { ok: false, status: 401, error: 'start_over', message: 'Start over.' }
  }
  const raw = await send('POST', '/admin/auth/code', { challenge, [kind]: value })
  if (raw?.status === 200 && typeof raw.json?.token === 'string') {
    challenge = null
    token = raw.json.token
    expiresAt = Date.parse(String(raw.json.expiresAt))
    scheduleExpiry()
    return {
      ok: true,
      expiresAt: String(raw.json.expiresAt),
      admin: raw.json.admin as never,
      backupCodesLeft: Number(raw.json.backupCodesLeft ?? 0)
    }
  }
  const result = failure(raw)
  if (result.error === 'start_over') challenge = null
  return result
}

function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer)
  if (!expiresAt) return
  expiryTimer = setTimeout(() => forget('expired'), Math.max(expiresAt - Date.now(), 0))
}

export async function signOut(): Promise<void> {
  if (token) await send('POST', '/admin/auth/logout', undefined, true)
  forget(null)
}

export const isSignedIn = (): boolean => token !== null && (expiresAt ?? 0) > Date.now()

// ───────────── Everything else ─────────────

// The only requests the window can ask for: Control's own routes, nothing else on the server.
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const QUERY = '(\\?[A-Za-z0-9%._~=&+:-]{0,300})?'
const ALLOWED: [string, RegExp][] = [
  ['GET', new RegExp(`^/admin/auth/me$`)],
  ['GET', new RegExp(`^/admin/dashboard${QUERY}$`)],
  ['GET', new RegExp(`^/admin/accounts${QUERY}$`)],
  ['GET', new RegExp(`^/admin/accounts/${ID}$`)],
  ['GET', new RegExp(`^/admin/username-available${QUERY}$`)],
  [
    'POST',
    new RegExp(
      `^/admin/accounts/${ID}/(password-reset|confirm-email|username|email|sign-out|suspend|unsuspend|cancel-deletion|delete)$`
    )
  ],
  ['POST', new RegExp(`^/admin/invites$`)],
  ['POST', new RegExp(`^/admin/invites/${ID}/(resend|cancel)$`)],
  ['GET', new RegExp(`^/admin/signups$`)],
  ['PUT', new RegExp(`^/admin/signups/mode$`)],
  ['POST', new RegExp(`^/admin/invite-codes$`)],
  ['POST', new RegExp(`^/admin/invite-codes/${ID}/disable$`)],
  ['GET', new RegExp(`^/admin/audit${QUERY}$`)]
]

export function isAllowedCall(method: unknown, path: unknown): boolean {
  return (
    typeof method === 'string' &&
    typeof path === 'string' &&
    path.length <= 400 &&
    ALLOWED.some(([m, pattern]) => m === method && pattern.test(path))
  )
}

export async function call(method: string, path: string, body?: unknown): Promise<CallResult> {
  if (!isSignedIn()) {
    forget('ended')
    return { ok: false, status: 401, error: 'unauthorized', message: 'Sign in again.' }
  }
  const raw = await send(method, path, body, true)
  if (raw && raw.status >= 200 && raw.status < 300) return { ok: true, data: raw.json ?? {} }
  if (raw?.status === 401) forget('ended')
  return failure(raw)
}

/** The audit log as CSV text (the window then offers where to save it). */
export async function fetchAuditCsv(): Promise<
  { ok: true; csv: string } | { ok: false; message: string }
> {
  if (!isSignedIn()) return { ok: false, message: 'Sign in again.' }
  const raw = await send('GET', '/admin/audit/export', undefined, true)
  if (raw?.status === 200) return { ok: true, csv: raw.text }
  if (raw?.status === 401) forget('ended')
  return { ok: false, message: failure(raw).message }
}

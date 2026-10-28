import { AppState } from 'react-native'
import * as ExpoCrypto from 'expo-crypto'
import { create } from 'zustand'
import type { AdminUser } from '../../../control/src/preload/types'
import { makePhoneKey } from '@/lib/signing'
import { createTransport, installWindowControl, type EndReason, type SignedIn } from '@/lib/transport'
import { keystore, type Approved } from '@/lib/keystore'
import { BACKGROUND_LIMIT_MS, SERVER_URL } from '@/lib/config'

// Where the app is: approving this iPhone, signing in, or in Control. The private key and the
// session token only live in memory (in the transport); everything here is forgotten on sign-out.

// noble's helpers look for crypto.getRandomValues; Hermes doesn't always have it.
const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } }
if (!g.crypto) g.crypto = {}
if (typeof g.crypto.getRandomValues !== 'function') {
  g.crypto.getRandomValues = (a: Uint8Array) => ExpoCrypto.getRandomValues(a)
}

const randomBytes = (n: number) => ExpoCrypto.getRandomBytes(n)

export const transport = createTransport({ serverUrl: SERVER_URL, randomBytes })
installWindowControl(transport)

export type Phase = 'starting' | 'approve' | 'signin' | 'app'

type Session = {
  phase: Phase
  approved: Approved | null
  admin: AdminUser | null
  expiresAt: number | null
  /** Why you're looking at the Approve / Sign-in screen again. */
  notice: string | null
  /** A page an alert asked to open (opened once signed in). */
  pendingOpen: Record<string, string> | null
  setPendingOpen: (data: Record<string, string> | null) => void
  clearNotice: () => void
}

export const useSession = create<Session>((set) => ({
  phase: 'starting',
  approved: null,
  admin: null,
  expiresAt: null,
  notice: null,
  pendingOpen: null,
  setPendingOpen: (pendingOpen) => set({ pendingOpen }),
  clearNotice: () => set({ notice: null }),
}))

const END_TEXT: Record<Exclude<EndReason, 'phone_removed'>, string> = {
  expired: 'You were signed out after 30 minutes. Sign in again.',
  ended: 'Your Control session ended. Sign in again.',
}

transport.onEnd((reason, message) => {
  if (reason === 'phone_removed') return void phoneRemoved(message)
  // With Face ID sign-in on, the Sign-in screen just asks for Face ID again: no notice needed.
  void keystore.remember().then((r) =>
    useSession.setState({ phase: 'signin', admin: null, expiresAt: null, notice: r ? null : END_TEXT[reason] }),
  )
})

async function phoneRemoved(message?: string) {
  await keystore.wipe()
  transport.setDevice(null)
  useSession.setState({
    phase: 'approve',
    approved: null,
    admin: null,
    expiresAt: null,
    notice: `This iPhone was removed from Glofly Control${message ? ` (${message.replace(/\.$/, '')})` : ''}. Approve it again from desktop Control at home.`,
  })
}

export async function startSession(): Promise<void> {
  const approved = await keystore.approved()
  transport.setDevice(approved?.deviceId ?? null)
  useSession.setState({ approved, phase: approved ? 'signin' : 'approve' })
}

/** "K7M2QF" or "k7m-2qf" → "K7M-2QF" while typing. */
export function formatPairCode(typed: string): string {
  const raw = typed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw
}

/** First run: make the key, hand the public half to the server with the code, keep the key. */
export async function approvePhone(code: string, name: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!keystore.canUseFaceId()) {
    return { ok: false, message: 'Set up Face ID and a passcode on this iPhone first (Settings → Face ID & Passcode).' }
  }
  const key = makePhoneKey(randomBytes)
  const result = await transport.pair(code, key.publicKey, name.trim() || "Chip's iPhone")
  if (!result.ok) return { ok: false, message: result.message }
  try {
    await keystore.saveApproval(key.secretKeyHex, result.deviceId, name.trim() || "Chip's iPhone")
  } catch {
    return {
      ok: false,
      message: "The server approved this iPhone but the key couldn't be saved behind Face ID. Remove it in desktop Control and try again.",
    }
  }
  const approved = { deviceId: result.deviceId, phoneName: name.trim() || "Chip's iPhone" }
  transport.setDevice(approved.deviceId)
  useSession.setState({ approved, phase: 'signin', notice: null })
  return { ok: true }
}

/** Face ID → the key into memory. */
export async function unlockKey(): Promise<{ ok: true } | { ok: false; message: string }> {
  if (transport.unlocked) return { ok: true }
  const r = await keystore.readKey()
  if (r.ok) {
    transport.unlock(r.key)
    return { ok: true }
  }
  if (r.gone) await phoneRemoved(r.message.replace(/\.$/, ''))
  return { ok: false, message: r.message }
}

/**
 * Oct 28, 2026: Face ID sign-in. Face ID unlocks the key, the key signs the saved secret, and the
 * server starts a session (14 days after the last password + code sign-in, then those again).
 */
export async function signInWithFaceId(): Promise<
  { ok: true; result: SignedIn } | { ok: false; needsPassword: boolean; message: string }
> {
  const saved = await keystore.remember()
  if (!saved) return { ok: false, needsPassword: true, message: '' }
  const key = await unlockKey()
  if (!key.ok) return { ok: false, needsPassword: false, message: key.message }
  const r = await transport.resume(saved.secret)
  if (r.ok) return { ok: true, result: r }
  if (r.error === 'remember_expired' || r.status === 401) {
    await keystore.forgetRemember()
    return { ok: false, needsPassword: true, message: r.error === 'phone_not_approved' ? '' : r.message }
  }
  return { ok: false, needsPassword: false, message: r.message }
}

export function signedIn(result: SignedIn): void {
  if (result.remember && result.rememberUntil) void keystore.setRemember(result.remember, result.rememberUntil)
  useSession.setState({ phase: 'app', admin: result.admin, expiresAt: Date.parse(result.expiresAt), notice: null })
}

export async function signOut(notice: string | null = null): Promise<void> {
  // Signing out on purpose also ends Face ID sign-in (the server forgets it too).
  await keystore.forgetRemember()
  await transport.signOut()
  useSession.setState({ phase: 'signin', admin: null, expiresAt: null, notice })
}

// 5 minutes or more in the background: sign out and forget the key when coming back. The check
// happens on return because timers don't run while iOS has the app suspended.
let backgroundSince: number | null = null
AppState.addEventListener('change', (state) => {
  if (state === 'background') {
    backgroundSince = Date.now()
    return
  }
  if (state !== 'active' || backgroundSince === null) return
  const away = Date.now() - backgroundSince
  backgroundSince = null
  if (away < BACKGROUND_LIMIT_MS) return
  const wasIn = useSession.getState().phase === 'app'
  transport.end('ended') // forgets the key and token (and moves a signed-in app to Sign in)
  if (wasIn) {
    void keystore.remember().then((r) =>
      useSession.setState({
        phase: 'signin',
        admin: null,
        expiresAt: null,
        notice: r ? null : 'You were signed out after 5 minutes in the background.',
      }),
    )
  }
})

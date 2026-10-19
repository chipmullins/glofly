import { Platform } from 'react-native'
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX, scrubError } from '@glofly/shared'
import { SERVER_URL, VERSION_HEADERS } from '@/lib/config'
import { useSession } from '@/state/session'
import { usePhonePrefs } from '@/state/prefs'

// 0.7.3 error reports: when something breaks, the phone tells Glofly's server what and where
// (Glofly Control → Errors). Never message text: everything is scrubbed first (emails, numbers,
// ids, tokens), and Settings → Privacy → "Send error reports" turns it off.

const MAX_PER_RUN = 10
const SAME_EVERY_MS = 60_000
let sent = 0
const lastSent = new Map<string, number>()
let where = 'app'

/** Which screen or action is going on (included in reports). */
export function noteWhere(w: string): void {
  where = w.slice(0, 60)
}

const osName = () => `${Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'} ${String(Platform.Version ?? '')}`.trim()

export function reportError(err: unknown, at?: string): void {
  try {
    if (!usePhonePrefs.getState().errorReports || sent >= MAX_PER_RUN) return
    const e = err as { message?: unknown; stack?: unknown; name?: unknown }
    const raw = typeof e?.message === 'string' ? `${typeof e.name === 'string' && e.name !== 'Error' ? `${e.name}: ` : ''}${e.message}` : String(err)
    const message = scrubError(raw.split('\n')[0] || 'Unknown error', ERROR_MESSAGE_MAX)
    const now = Date.now()
    if (now - (lastSent.get(message) ?? 0) < SAME_EVERY_MS) return
    lastSent.set(message, now)
    sent++
    const token = useSession.getState().token
    void fetch(`${SERVER_URL}/errors`, {
      method: 'POST',
      headers: {
        ...VERSION_HEADERS,
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message,
        stack: typeof e?.stack === 'string' ? scrubError(e.stack, ERROR_STACK_MAX) : undefined,
        where: (at ?? where).slice(0, 60),
        os: osName(),
      }),
    }).catch(() => {})
  } catch {
    // reporting must never break anything
  }
}

let installed = false
/** Catches errors nothing else caught (keeps React Native's own handling too). */
export function installErrorReports(): void {
  if (installed) return
  installed = true
  const g = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler: () => (e: unknown, fatal?: boolean) => void
      setGlobalHandler: (fn: (e: unknown, fatal?: boolean) => void) => void
    }
    addEventListener?: (type: string, fn: (ev: { reason?: unknown; error?: unknown }) => void) => void
  }
  const prev = g.ErrorUtils?.getGlobalHandler()
  g.ErrorUtils?.setGlobalHandler((e, fatal) => {
    reportError(e, fatal ? `${where} (crash)` : undefined)
    prev?.(e, fatal)
  })
  // Promises nobody waited for (Hermes and browsers both have this event in recent versions).
  try {
    g.addEventListener?.('unhandledrejection', (ev) => reportError(ev?.reason ?? 'Unhandled promise rejection'))
    if (Platform.OS === 'web') g.addEventListener?.('error', (ev) => reportError(ev?.error ?? 'Script error'))
  } catch {
    // not available here
  }
}

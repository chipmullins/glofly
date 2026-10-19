import { app } from 'electron'
import { release } from 'node:os'
import {
  ERROR_MESSAGE_MAX,
  ERROR_STACK_MAX,
  scrubError,
  type ErrorReport
} from '@glofly/shared/security'
import { API_URL, getSessionToken, VERSION_HEADER } from './auth'

// 0.7.3 error reports (Glofly Control → Errors): what broke and where, never what anyone wrote.
// The window's own errors come through reportError (the window checks Settings → Privacy first);
// the main process's only while reports are on (the window says so at start and when changed).
// At most 10 a run, the same one at most once a minute.

let on = true
let sent = 0
const lastSent = new Map<string, number>()

export function setErrorReports(enabled: boolean): void {
  on = enabled
}

const osName = (): string =>
  `${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} ${release()}`

export function reportError(report: ErrorReport): void {
  if (!app.isPackaged && !process.env.GLOFLY_REPORT_ERRORS) return // not while developing
  if (sent >= 10) return
  const message = scrubError(String(report.message ?? ''), ERROR_MESSAGE_MAX)
  if (!message.trim()) return
  const key = `${report.where ?? ''}|${message}`
  const now = Date.now()
  if (now - (lastSent.get(key) ?? 0) < 60_000) return
  lastSent.set(key, now)
  sent++
  const token = getSessionToken()
  void fetch(`${API_URL}/errors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...VERSION_HEADER,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      message,
      stack: report.stack ? scrubError(String(report.stack), ERROR_STACK_MAX) : undefined,
      where: report.where?.slice(0, 60),
      os: report.os?.slice(0, 80) || osName()
    }),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => undefined)
}

/** The main process's own unexpected errors. */
export function watchMainErrors(): void {
  process.on('uncaughtException', (err) => {
    console.error(err)
    if (on) reportError({ message: err?.message ?? String(err), stack: err?.stack, where: 'main' })
  })
  process.on('unhandledRejection', (err) => {
    const e = err as { message?: string; stack?: string }
    if (on)
      reportError({ message: e?.message ?? String(err), stack: e?.stack, where: 'main (promise)' })
  })
}

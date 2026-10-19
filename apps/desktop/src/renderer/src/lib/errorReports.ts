import { ERROR_MESSAGE_MAX, scrubError } from '@glofly/shared/security'

// 0.7.3 error reports (Glofly Control → Errors): what broke and where, never what anyone wrote.
// Settings → Privacy → "Send error reports" (on unless turned off, kept on this device).

const KEY = 'glofly.errorReports'

export function errorReportsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setErrorReportsOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // storage off: just for now
  }
  window.glofly.setErrorReports(on)
}

/** Noise that isn't Glofly's: the browser's own warnings, extensions' scripts. */
function ignorable(message: string, stack: string): boolean {
  if (
    /ResizeObserver loop|Script error\.?$|AbortError|The play\(\) request was interrupted/i.test(
      message
    )
  )
    return true
  if (/(chrome|moz|safari)-extension:\/\//.test(stack)) return true
  return false
}

export function sendErrorReport(err: unknown, where: string): void {
  if (!errorReportsOn()) return
  const e = err as { message?: string; stack?: string; name?: string } | null
  const message = String(e?.message ?? err ?? '')
  const stack = String(e?.stack ?? '')
  if (!message || ignorable(message, stack)) return
  const named = e?.name && !message.startsWith(e.name) ? `${e.name}: ${message}` : message
  window.glofly.reportError({
    message: scrubError(named, ERROR_MESSAGE_MAX),
    stack: stack || undefined,
    where
  })
}

/** Catches what nothing else did. Called once at start. */
export function startErrorReports(): void {
  window.glofly.setErrorReports(errorReportsOn())
  window.addEventListener('error', (e) => sendErrorReport(e.error ?? e.message, 'window'))
  window.addEventListener('unhandledrejection', (e) => sendErrorReport(e.reason, 'promise'))
}

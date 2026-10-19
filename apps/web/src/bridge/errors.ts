import type { ErrorReport } from '../../../desktop/src/preload/api-types'
import { ERROR_MESSAGE_MAX, ERROR_STACK_MAX, scrubError } from '@glofly/shared/security'
import { API_URL, APP_HEADERS, browserName } from './config'

// 0.7.3 error reports from the browser version (desktop: src/main/errors.ts). The page checks
// Settings → Privacy before calling this. At most 10 a visit, the same one once a minute.

let sent = 0
const lastSent = new Map<string, number>()

function osName(): string {
  const ua = navigator.userAgent
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown'
  return `${browserName()} on ${os}`
}

export function reportError(report: ErrorReport): void {
  if (sent >= 10) return
  const message = scrubError(String(report.message ?? ''), ERROR_MESSAGE_MAX)
  if (!message.trim()) return
  const key = `${report.where ?? ''}|${message}`
  const now = Date.now()
  if (now - (lastSent.get(key) ?? 0) < 60_000) return
  lastSent.set(key, now)
  sent++
  void fetch(`${API_URL}/errors`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...APP_HEADERS },
    body: JSON.stringify({
      message,
      stack: report.stack ? scrubError(String(report.stack), ERROR_STACK_MAX) : undefined,
      where: report.where?.slice(0, 60),
      os: osName()
    }),
    keepalive: true
  }).catch(() => undefined)
}

import type {
  ApiResult,
  PinnedMessage,
  QuietHours,
  ScheduledMessage,
  TwoStepStatus
} from '../../../preload/api-types'

// 0.7.3: typed calls for two-step settings, quiet hours, pins, mark unread and send later
// (all through window.glofly.tools, which only lets these routes through).

const req = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.tools.request<T>(method, path, body)

export const twoStep = {
  status: () => req<TwoStepStatus>('GET', '/account/two-step'),
  start: (method: 'email' | 'sms', password: string, phone?: string) =>
    req<{ sentTo: string }>('POST', '/account/two-step/start', { method, password, phone }),
  confirm: (code: string) =>
    req<{ status: TwoStepStatus; backupCodes: string[] | null }>(
      'POST',
      '/account/two-step/confirm',
      { code }
    ),
  off: (password: string) => req<TwoStepStatus>('POST', '/account/two-step/off', { password }),
  removePhone: (password: string) =>
    req<TwoStepStatus>('POST', '/account/two-step/remove-phone', { password }),
  newBackupCodes: (password: string) =>
    req<{ backupCodes: string[]; status: TwoStepStatus }>(
      'POST',
      '/account/two-step/backup-codes',
      { password }
    )
}

export const quietHours = {
  get: () => req<{ quietHours: QuietHours | null }>('GET', '/account/quiet-hours'),
  set: (q: QuietHours | null) =>
    req<{ quietHours: QuietHours | null }>('PUT', '/account/quiet-hours', { quietHours: q })
}

export const pins = {
  list: (conversationId: string) =>
    req<{ pins: PinnedMessage[]; canPin: boolean }>('GET', `/conversations/${conversationId}/pins`),
  set: (conversationId: string, messageId: string, pinned: boolean) =>
    req<{ pins: PinnedMessage[] }>(
      pinned ? 'POST' : 'DELETE',
      `/conversations/${conversationId}/messages/${messageId}/pin`
    )
}

export const markUnread = (
  conversationId: string,
  messageId: string
): Promise<ApiResult<{ lastReadAt: string }>> =>
  req<{ lastReadAt: string }>('POST', `/conversations/${conversationId}/unread`, { messageId })

export const scheduled = {
  list: (conversationId: string) =>
    req<{ scheduled: ScheduledMessage[] }>('GET', `/conversations/${conversationId}/scheduled`),
  add: (conversationId: string, body: string, sendAt: Date, replyToId?: string | null) =>
    req<{ scheduled: ScheduledMessage }>('POST', `/conversations/${conversationId}/scheduled`, {
      body,
      sendAt: sendAt.toISOString(),
      replyToId: replyToId ?? undefined
    }),
  edit: (conversationId: string, id: string, changes: { body?: string; sendAt?: Date }) =>
    req<{ scheduled: ScheduledMessage }>(
      'PATCH',
      `/conversations/${conversationId}/scheduled/${id}`,
      {
        ...(changes.body !== undefined ? { body: changes.body } : {}),
        ...(changes.sendAt ? { sendAt: changes.sendAt.toISOString() } : {})
      }
    ),
  remove: (conversationId: string, id: string) =>
    req<null>('DELETE', `/conversations/${conversationId}/scheduled/${id}`),
  sendNow: (conversationId: string, id: string) =>
    req<null>('POST', `/conversations/${conversationId}/scheduled/${id}/send`)
}

/** "Tomorrow, 9:00 AM" / "Today, 8:00 PM" / "Mon, Oct 26, 9:00 AM" */
export function whenLabel(iso: string | Date, now = new Date()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(d) - day(now)) / 86_400_000)
  if (diff === 0) return `Today, ${time}`
  if (diff === 1) return `Tomorrow, ${time}`
  return `${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
}

/** For <input type="datetime-local">: "2026-10-20T09:00" in local time. */
export function localInputValue(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

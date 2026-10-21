import type {
  Announcement,
  ApiResult,
  ReportReason,
  ReportRequest,
  TeamNotice
} from '../preload/api-types'
import { isUserId, request } from './api'
import { cleanAnnouncement } from './realtime'

// Reporting messages and people, messages from the Glofly team, and the announcement banner.

const REASONS: ReportReason[] = [
  'spam',
  'harassment',
  'hate',
  'sexual',
  'violence',
  'self_harm',
  'other'
]

/** Checks a report from the window before sending it. */
export function isReportRequest(value: unknown): value is ReportRequest {
  const r = value as Record<string, unknown> | null
  if (typeof r !== 'object' || r === null || Array.isArray(r)) return false
  const allowed = ['messageId', 'conversationId', 'userId', 'reason', 'details', 'block']
  if (!Object.keys(r).every((k) => allowed.includes(k))) return false
  if (!REASONS.includes(r.reason as ReportReason)) return false
  for (const k of ['messageId', 'conversationId', 'userId']) {
    if (r[k] !== undefined && !isUserId(r[k])) return false
  }
  if (r.details !== undefined && (typeof r.details !== 'string' || r.details.length > 1000))
    return false
  if (r.block !== undefined && typeof r.block !== 'boolean') return false
  return !!(r.messageId || r.userId)
}

export const sendReport = (
  report: ReportRequest
): Promise<ApiResult<{ ok: true; alreadyReported?: boolean }>> =>
  request('POST', '/reports', report)

export async function listNotices(): Promise<
  ApiResult<{ notices: TeamNotice[]; announcement: Announcement | null }>
> {
  const result = await request<{ notices: unknown[]; announcement: unknown }>('GET', '/notices')
  if (!result.ok) return result
  const notices = (Array.isArray(result.data.notices) ? result.data.notices : [])
    .map((n) => n as Record<string, unknown>)
    .filter((n) => typeof n.id === 'string' && typeof n.body === 'string')
    .map((n) => ({
      id: n.id as string,
      kind: typeof n.kind === 'string' ? n.kind : 'warning',
      body: (n.body as string).slice(0, 1000),
      createdAt: String(n.createdAt),
      allowReply: n.allowReply === true
    }))
  return { ok: true, data: { notices, announcement: cleanAnnouncement(result.data.announcement) } }
}

/** 0.9.0: answer a Glofly Team message (it goes to Glofly Control's Inbox). */
export async function noticeReply(id: string, body: string): Promise<ApiResult<null>> {
  const result = await request('POST', `/notices/${id}/reply`, { body })
  return result.ok ? { ok: true, data: null } : result
}

export async function noticeSeen(id: string): Promise<ApiResult<null>> {
  const result = await request('POST', `/notices/${id}/seen`)
  return result.ok ? { ok: true, data: null } : result
}

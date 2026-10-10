import type { CallResult, Failure } from '../../../preload/types'

// Typed calls to the server's /admin routes (through the main process).

export type { Failure }
export type Result<T> = { ok: true; data: T } | Failure

async function call<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown
): Promise<Result<T>> {
  const result: CallResult = await window.control.call(method, path, body)
  return result.ok ? { ok: true, data: result.data as T } : result
}

const q = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '') as [
    string,
    string
  ][]
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
}

// ───────────── Shapes ─────────────

export type AccountStatus = 'deleting' | 'suspended' | 'unconfirmed' | 'confirmed'
export type InviteStatus = 'pending' | 'expired' | 'accepted' | 'cancelled'

export type AuditEntry = {
  id: string
  createdAt: string
  action: string
  targetUserId: string | null
  targetLabel: string | null
  details: Record<string, unknown> | null
  note: string
  ip: string | null
  adminUsername: string | null
}

export type Dashboard = {
  timeZone: string
  stats: {
    accounts: number
    newThisWeek: number
    onlineNow: number
    devicesConnected: number
    messagesToday: number
    messagesYesterday: number
    callsToday: number
    groupCallsToday: number
    storageBytes: number
    fileCount: number
  }
  health: {
    server: { ok: boolean; uptimeSec: number; files: string }
    database: { ok: boolean; ms: number }
    redis: { ok: boolean }
    realtime: { devices: number }
    email: { transport: string; failedToday: number }
    calls: { configured: boolean }
  }
  daily: { day: string; messages: number; calls: number; signups: number }[]
  versions: { version: string | null; people: number }[]
  signupMode: SignupMode
  /** Control v2 (missing from older servers) */
  openReports?: number
  minVersion?: string | null
  recentAccounts: {
    kind: 'account' | 'invite'
    id: string
    username: string
    displayName: string
    createdAt: string
    status: AccountStatus | 'invited' | 'invite_expired'
  }[]
  recentActions: AuditEntry[]
}

export type AccountRow = {
  id: string
  username: string
  displayName: string
  email: string
  createdAt: string
  lastSeenAt: string | null
  online: boolean
  isAdmin: boolean
  status: AccountStatus
}

export type InviteRow = {
  id: string
  username: string
  displayName: string
  email: string
  createdAt: string
  sentAt: string
  expiresAt: string
  status: InviteStatus
}

export type Filter = 'all' | 'invited' | 'unconfirmed' | 'suspended' | 'deleting'

export type AccountList = {
  counts: Record<Filter, number>
  more: boolean
  invites: InviteRow[]
  accounts: AccountRow[]
}

export type AccountDetail = {
  account: {
    id: string
    username: string
    displayName: string
    email: string
    emailVerified: boolean
    pendingEmail: string | null
    createdAt: string
    lastSeenAt: string | null
    online: boolean
    statusText: string | null
    isAdmin: boolean
    status: AccountStatus
    suspendedAt: string | null
    suspendReason: string | null
    deleteAfter: string | null
    friends: number
    groups: number
    storageBytes: number
    fileCount: number
    inviteCode: { code: string; label: string } | null
    invitedBy: string | null
    devices: {
      id: string
      deviceName: string | null
      appVersion: string | null
      createdAt: string
      lastUsedAt: string
      online: boolean
    }[]
  }
  history: AuditEntry[]
}

export type SignupMode = 'open' | 'invite' | 'closed'

export type InviteCode = {
  id: string
  code: string
  label: string
  maxUses: number
  uses: number
  expiresAt: string | null
  disabledAt: string | null
  createdAt: string
  usedBy: { username: string; usedAt: string }[]
  state: 'active' | 'used_up' | 'expired' | 'off'
}

export type ReportReason =
  'spam' | 'harassment' | 'hate' | 'sexual' | 'violence' | 'self_harm' | 'other'
export type ReportOutcome = 'dismissed' | 'removed' | 'warned' | 'suspended'
export type ReportPerson = { id: string; username: string; displayName: string; exists: boolean }

export type ReportRow = {
  id: string
  reason: ReportReason
  reasonLabel: string
  kind: 'message' | 'person'
  preview: string | null
  chatKind: 'dm' | 'group' | null
  reporter: ReportPerson | null
  reported: ReportPerson | null
  status: 'open' | 'resolved'
  outcome: ReportOutcome | null
  createdAt: string
  resolvedAt: string | null
}

export type ReportMessage = {
  id: string
  senderId: string
  body: string
  createdAt: string
  deleted?: boolean
  attachments: string[]
}

export type ReportDetail = {
  id: string
  reason: ReportReason
  reasonLabel: string
  details: string | null
  kind: 'message' | 'person'
  messageId: string | null
  chat: { kind: 'dm' | 'group'; name: string | null } | null
  message: ReportMessage | null
  context: ReportMessage[]
  people: { id: string; username: string; displayName: string }[]
  reporter: ReportPerson | null
  reported: ReportPerson | null
  reportedSuspended: boolean
  otherReportsAboutThem: number
  status: 'open' | 'resolved'
  outcome: ReportOutcome | null
  note: string | null
  resolvedBy: string | null
  createdAt: string
  resolvedAt: string | null
}

export type ResolveAction =
  | { action: 'dismiss'; note: string }
  | { action: 'remove'; note: string }
  | { action: 'warn'; warning: string; alsoRemove: boolean; note: string }
  | { action: 'suspend'; reason: string; alsoRemove: boolean; note: string }

export type Announcement = {
  id: string
  body: string
  tone: 'info' | 'important'
  linkUrl: string | null
  linkLabel: string | null
  createdAt: string
  endsAt: string | null
  endedAt?: string | null
}

export type AppVersionInfo = {
  minVersion: string | null
  message: string | null
  newest: string | null
  check: { version: string; devices: number; people: number } | null
}

type Done = { ok: true; message?: string }

// ───────────── Calls ─────────────

export const api = {
  dashboard: () =>
    call<Dashboard>(
      'GET',
      `/admin/dashboard${q({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone })}`
    ),
  accounts: (search: string, filter: Filter) =>
    call<AccountList>('GET', `/admin/accounts${q({ q: search.trim() || undefined, filter })}`),
  account: (id: string) => call<AccountDetail>('GET', `/admin/accounts/${id}`),
  usernameAvailable: (username: string) =>
    call<{ available: boolean; reason?: string }>(
      'GET',
      `/admin/username-available${q({ username })}`
    ),
  accountAction: (id: string, action: string, body: Record<string, unknown>) =>
    call<Done>('POST', `/admin/accounts/${id}/${action}`, body),
  createInvite: (body: {
    email: string
    username: string
    displayName: string
    addFriend: boolean
    note: string
  }) => call<Done>('POST', '/admin/invites', body),
  inviteAction: (id: string, action: 'resend' | 'cancel', note: string) =>
    call<Done>('POST', `/admin/invites/${id}/${action}`, { note }),
  signups: () => call<{ mode: SignupMode; codes: InviteCode[] }>('GET', '/admin/signups'),
  setMode: (mode: SignupMode, note: string) =>
    call<Done>('PUT', '/admin/signups/mode', { mode, note }),
  createCode: (body: {
    label: string
    maxUses: number
    expiresInDays: number | null
    note: string
  }) => call<{ ok: true; code: string; id: string }>('POST', '/admin/invite-codes', body),
  disableCode: (id: string, note: string) =>
    call<Done>('POST', `/admin/invite-codes/${id}/disable`, { note }),
  reports: (status: 'open' | 'resolved', before?: string) =>
    call<{ counts: { open: number; resolved: number }; more: boolean; reports: ReportRow[] }>(
      'GET',
      `/admin/reports${q({ status, before })}`
    ),
  report: (id: string) => call<{ report: ReportDetail }>('GET', `/admin/reports/${id}`),
  resolveReport: (id: string, body: ResolveAction) =>
    call<Done>('POST', `/admin/reports/${id}/resolve`, body),
  announcements: () =>
    call<{
      current: Announcement | null
      history: Announcement[]
      minVersion: { version: string | null; message: string | null }
    }>('GET', '/admin/announcements'),
  postAnnouncement: (body: {
    body: string
    tone: 'info' | 'important'
    linkUrl?: string
    linkLabel?: string
    hours: number | null
    note: string
  }) => call<Done>('POST', '/admin/announcements', body),
  endAnnouncement: (id: string, note: string) =>
    call<Done>('POST', `/admin/announcements/${id}/end`, { note }),
  appVersion: (check?: string) => call<AppVersionInfo>('GET', `/admin/app-version${q({ check })}`),
  setAppVersion: (version: string | null, message: string, note: string) =>
    call<Done>('PUT', '/admin/app-version', {
      version,
      ...(message ? { message } : {}),
      note
    }),
  audit: (search: string, before?: string) =>
    call<{ entries: AuditEntry[]; hasMore: boolean }>(
      'GET',
      `/admin/audit${q({ q: search.trim() || undefined, before })}`
    )
}

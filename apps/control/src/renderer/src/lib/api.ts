import type { CallResult, Failure } from '../../../preload/types'

// Typed calls to the server's /admin routes (through the main process).
// 0.8.2: Control for iPhone (apps/control-mobile) uses this same file; it supplies its own
// `window.control.call` (signed requests from the approved phone).

export type { Failure }
export type Result<T> = { ok: true; data: T } | Failure

async function call<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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

/** 0.7.3: an error report from the apps (one row per problem and app version) */
export type ErrorApp = 'desktop' | 'web' | 'android' | 'ios' | 'server' | 'control'
export type ErrorRow = {
  id: string
  app: ErrorApp
  appVersion: string | null
  os: string | null
  message: string
  stack: string | null
  where: string | null
  count: number
  /** Different accounts that hit it (up to 20 are remembered) */
  people: number
  firstAt: string
  lastAt: string
  resolvedAt: string | null
}

/** 2.0: Constellations, as Control sees them */
export type ConstellationStatus = 'all' | 'live' | 'taken_down' | 'frozen' | 'reports' | 'growing'
export type ConstellationOwner = { id: string; username: string; displayName: string }
export type ConstellationRow = {
  id: string
  name: string
  visibility: 'invite' | 'public' | 'approval'
  type: string | null
  createdAt: string
  lastActivityAt: string
  takenDownAt: string | null
  takedownReason: string | null
  owner: ConstellationOwner
  memberCount: number
  openReports: number
  /** 0.8.2 (missing from older servers) */
  joinsToday?: number
  nebulaCount?: number
  frozenAt?: string | null
  invitesOffAt?: string | null
}
/** 0.8.2: across Glofly */
export type ConstellationTotals = { constellations: number; nebulas: number; voiceLive: number }
export type ConstellationInfo = {
  id: string
  name: string
  description: string | null
  visibility: ConstellationRow['visibility']
  type: string | null
  tags: string[]
  createdAt: string
  takenDownAt: string | null
  takedownReason: string | null
  owner: ConstellationOwner | undefined
  memberCount: number
  nebulas: {
    id: string
    name: string
    kind: 'text' | 'voice'
    messages: number
    /** 0.8.2 (missing from older servers) */
    visibility?: 'everyone' | 'roles'
    readOnly?: boolean
    messagesToday?: number
    inVoice?: number
  }[]
  /** 0.8.2 (missing from older servers) */
  joinsToday?: number
  messagesToday?: number
  openReports?: number
  frozenAt?: string | null
  invitesOffAt?: string | null
  moderation: {
    action: string
    actor: string | null
    target: string | null
    details: Record<string, unknown> | null
    createdAt: string
  }[]
}

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
    /** Push notifications to phones (missing from servers before the phone apps) */
    push?: { configured: boolean; failedToday: number }
  }
  daily: { day: string; messages: number; calls: number; signups: number }[]
  /** platform: 'desktop' | 'android' | 'ios' (missing from servers before the phone apps = desktop) */
  versions: { platform?: AppPlatform; version: string | null; people: number }[]
  signupMode: SignupMode
  /** Control v2 (missing from older servers) */
  openReports?: number
  minVersion?: string | null
  /** Per platform (missing from servers before the phone apps) */
  minVersions?: Record<AppPlatform, string | null>
  recentAccounts: {
    kind: 'account' | 'invite'
    id: string
    username: string
    displayName: string
    createdAt: string
    status: AccountStatus | 'invited' | 'invite_expired'
  }[]
  recentActions: AuditEntry[]
  /** 0.8.2: what's happening now (missing from older servers) */
  now?: HappeningNow
}

// ───────────── 0.8.2: phones, alerts, quick notes, lockdown, uptime, Inbox ─────────────

export type LockdownState = { on: boolean; since: string | null }

export type HappeningNow = {
  calls: number
  inCalls: number
  oldestOpenReport: { createdAt: string; reason: ReportReason } | null
  inboxUnread: number
  lockdown: LockdownState
  alerts: ControlAlert[]
}

export const ALERT_KINDS = [
  'server_down',
  'control_signin',
  'report_spike',
  'report_new',
  'delivery_failures',
  'account_new',
  'constellation_growing',
  'inbox_reply',
  'morning_summary'
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]
/** Urgent kinds break through Focus on the phone */
export const URGENT_ALERTS: AlertKind[] = ['server_down', 'control_signin', 'report_spike']
export const ALERT_LABELS: Record<AlertKind, { title: string; sub: string }> = {
  server_down: {
    title: 'Server down or back',
    sub: 'After about a minute and a half of no answer'
  },
  control_signin: {
    title: 'Control sign-in somewhere new',
    sub: 'A new device, a backup code or a wrong code'
  },
  report_spike: { title: 'Report spike', sub: '5 or more reports in 10 minutes' },
  report_new: { title: 'New report', sub: 'One alert per report' },
  delivery_failures: { title: 'Failed emails or pushes', sub: 'Bundled, at most once an hour' },
  account_new: { title: 'New account', sub: 'Sign-ups and accepted invites' },
  constellation_growing: {
    title: 'Constellation growing fast',
    sub: '25 or more joins in an hour'
  },
  inbox_reply: { title: 'Inbox reply', sub: 'Someone answered a Glofly Team message' },
  morning_summary: { title: 'Morning summary', sub: '9:00 AM · the last 24 hours in numbers' }
}

export type ControlAlert = {
  id: string
  kind: AlertKind | string
  title: string
  body: string
  /** open: which page it's about (reports, accounts, constellations, inbox, server, dashboard) */
  data: Record<string, string>
  createdAt: string
}
export type AlertPrefs = { kinds: Record<AlertKind, boolean>; desktop: boolean }

export type ApprovedPhone = {
  id: string
  name: string
  createdAt: string
  lastUsedAt: string | null
  lastIp: string | null
  alerts: boolean
  thisDevice: boolean
}

export type UptimeDay = { day: string; status: 'up' | 'you' | 'down'; downSec: number }
export type UptimeEvent = {
  kind: 'outage' | 'restart' | 'update' | 'pause'
  startedAt: string
  endedAt: string | null
  seconds: number | null
}
export type Uptime = { percent: number; days: UptimeDay[]; events: UptimeEvent[] }

export type InboxPerson = {
  id: string
  username: string
  displayName: string
  avatarVersion: string | null
}
export type InboxThread = {
  user: InboxPerson
  lastAt: string
  preview: string
  lastFromTeam: boolean
  unread: number
}
export type InboxItem =
  | {
      id: string
      from: 'team'
      body: string
      createdAt: string
      seen: boolean
      allowReply: boolean
    }
  | { id: string; from: 'user'; body: string; createdAt: string; unread: boolean; noticeId: string }

export type AccountRow = {
  id: string
  username: string
  displayName: string
  email: string
  createdAt: string
  lastSeenAt: string | null
  online: boolean
  isAdmin: boolean
  /** 0.4.0: a restricted (family-managed) account (missing from older servers) */
  restricted?: boolean
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
  /** 0.4.0: starts out restricted (a family account) */
  restricted?: boolean
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
    restricted?: boolean
    status: AccountStatus
    suspendedAt: string | null
    suspendReason: string | null
    deleteAfter: string | null
    friends: number
    groups: number
    /** 0.8.2 (missing from older servers) */
    constellations?: number
    openReports?: number
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
  chat:
    | { kind: 'dm' | 'group'; name: string | null }
    | { kind: 'nebula'; name: string; constellation: { id: string; name: string } }
    | null
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

/** Which Glofly app: each has its own version numbers and its own minimum. */
export type AppPlatform = 'desktop' | 'android' | 'ios' | 'web'

export const PLATFORM_LABEL: Record<AppPlatform, string> = {
  desktop: 'Desktop',
  android: 'Android',
  ios: 'iPhone',
  web: 'Web'
}

export type AppVersionInfo = {
  platform?: AppPlatform
  minVersion: string | null
  message: string | null
  newest: string | null
  check: { version: string; devices: number; people: number } | null
}

type Done = { ok: true; message?: string }

/** Control → Server (0.4.0). */
export type PauseState = { paused: boolean; message: string; since: string | null }
export type ServerInfo = {
  pause: PauseState
  defaultPauseMessage: string
  startedAt: string
  uptimeSec: number
  /** Only the live server (Docker) can restart itself. */
  canRestart: boolean
  devicesConnected: number
  /** 0.8.2 (missing from older servers) */
  lockdown?: LockdownState
}

/** A restricted account's friends (Accounts → Family). */
export type FamilyFriend = {
  id: string
  username: string
  displayName: string
  avatarVersion: string | null
  since: string | null
}

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
    restricted?: boolean
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
  constellations: (query: string, status: ConstellationStatus, offset = 0) =>
    call<{ constellations: ConstellationRow[]; hasMore: boolean; totals?: ConstellationTotals }>(
      'GET',
      `/admin/constellations${q({ q: query, status, offset: offset ? String(offset) : undefined })}`
    ),
  constellation: (id: string) =>
    call<{ constellation: ConstellationInfo }>('GET', `/admin/constellations/${id}`),
  takeDown: (id: string, reason: string, note: string) =>
    call<Done>('POST', `/admin/constellations/${id}/take-down`, { reason, note }),
  restoreConstellation: (id: string, note: string) =>
    call<Done>('POST', `/admin/constellations/${id}/restore`, { note }),
  deleteConstellation: (id: string, confirmName: string, note: string) =>
    call<Done>('POST', `/admin/constellations/${id}/delete`, { confirmName, note }),
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
  appVersion: (check?: string, platform: AppPlatform = 'desktop') =>
    call<AppVersionInfo>('GET', `/admin/app-version${q({ check, platform })}`),
  setAppVersion: (
    version: string | null,
    message: string,
    note: string,
    platform: AppPlatform = 'desktop'
  ) =>
    call<Done>('PUT', '/admin/app-version', {
      version,
      ...(message ? { message } : {}),
      platform,
      note
    }),
  server: () => call<ServerInfo>('GET', '/admin/server'),
  setPause: (paused: boolean, message: string, note: string) =>
    call<Done & { pause: PauseState }>('PUT', '/admin/server/pause', {
      paused,
      ...(message ? { message } : {}),
      note
    }),
  restartServer: (note: string) =>
    call<Done & { startedAt: string }>('POST', '/admin/server/restart', { note }),
  family: (id: string) =>
    call<{ restricted: boolean; friends: FamilyFriend[] }>('GET', `/admin/accounts/${id}/family`),
  setRestricted: (id: string, restricted: boolean, note: string) =>
    call<Done>('PUT', `/admin/accounts/${id}/restricted`, { restricted, note }),
  addFamilyFriend: (id: string, username: string, note: string) =>
    call<Done>('POST', `/admin/accounts/${id}/friends`, { username, note }),
  removeFamilyFriend: (id: string, friendId: string, note: string) =>
    call<Done>('POST', `/admin/accounts/${id}/friends/${friendId}/remove`, { note }),
  errors: (show: 'open' | 'fixed', app?: ErrorApp) =>
    call<{ errors: ErrorRow[]; lastDay: number }>('GET', `/admin/errors${q({ show, app })}`),
  errorAction: (id: string, action: 'resolve' | 'reopen') =>
    call<Done>('POST', `/admin/errors/${id}/${action}`),
  clearFixedErrors: () => call<{ removed: number }>('DELETE', '/admin/errors'),
  // ── 0.8.2 ──
  freezeConstellation: (id: string, frozen: boolean, note: string) =>
    call<Done>('POST', `/admin/constellations/${id}/freeze`, { frozen, note }),
  constellationInvites: (id: string, off: boolean, note: string) =>
    call<Done>('POST', `/admin/constellations/${id}/invites`, { off, note }),
  transferConstellation: (id: string, username: string, note: string) =>
    call<Done>('POST', `/admin/constellations/${id}/transfer`, { username, note }),
  /** Add a friend for any account (it was family accounts only before 0.8.2) */
  addFriendFor: (id: string, username: string, note: string) =>
    call<Done>('POST', `/admin/accounts/${id}/friends`, { username, note }),
  messageUser: (id: string, body: string, allowReply: boolean, note: string) =>
    call<Done>('POST', `/admin/accounts/${id}/message`, { body, allowReply, note }),
  inbox: () => call<{ threads: InboxThread[]; unreadTotal: number }>('GET', '/admin/inbox'),
  inboxThread: (userId: string) =>
    call<{ user: InboxPerson; items: InboxItem[] }>('GET', `/admin/inbox/${userId}`),
  quickNotes: () => call<{ notes: string[] }>('GET', '/admin/quick-notes'),
  setQuickNotes: (notes: string[]) =>
    call<{ notes: string[] }>('PUT', '/admin/quick-notes', { notes }),
  lockdown: () =>
    call<{ lockdown: LockdownState; affected: number; hours: number }>(
      'GET',
      '/admin/server/lockdown'
    ),
  setLockdown: (on: boolean, note: string) =>
    call<Done & { lockdown: LockdownState }>('PUT', '/admin/server/lockdown', { on, note }),
  endAllCalls: (note: string) =>
    call<Done & { ended: number }>('POST', '/admin/server/end-calls', { note }),
  uptime: () => call<Uptime>('GET', '/admin/server/uptime'),
  alerts: (after?: string) =>
    call<{ alerts: ControlAlert[]; prefs: AlertPrefs; pushReady: boolean; now: string }>(
      'GET',
      `/admin/alerts${q({ after })}`
    ),
  setAlertPrefs: (prefs: { kinds?: Partial<Record<AlertKind, boolean>>; desktop?: boolean }) =>
    call<{ prefs: AlertPrefs }>('PUT', '/admin/alerts/prefs', prefs),
  testAlert: () => call<Done & { sent: number }>('POST', '/admin/alerts/test'),
  phones: () => call<{ devices: ApprovedPhone[]; max: number }>('GET', '/admin/devices'),
  phonePairCode: (note: string) =>
    call<{ code: string; expiresIn: number }>('POST', '/admin/devices/pair-code', { note }),
  removePhone: (id: string, note: string) =>
    call<Done>('POST', `/admin/devices/${id}/remove`, { note }),
  audit: (search: string, before?: string) =>
    call<{ entries: AuditEntry[]; hasMore: boolean }>(
      'GET',
      `/admin/audit${q({ q: search.trim() || undefined, before })}`
    )
}

/** Open errors last seen in the last 24 hours (the sidebar's badge). */
export function openLastDay(rows: ErrorRow[]): number {
  const since = Date.now() - 24 * 60 * 60 * 1000
  return rows.filter((r) => !r.resolvedAt && new Date(r.lastAt).getTime() > since).length
}

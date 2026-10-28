// Browser preview only (never in the iPhone app: Metro picks preview.ts there). Shows the screens
// with made-up data so they can be compared with the mockups:
//   CONTROL_WEB_PREVIEW=1 npx expo export -p web   (see README → "Screens in a browser")
// Every call to window.control answers from the sample data below; nothing reaches a server.
import { useSession } from '@/state/session'

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString()
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const people = {
  dusty: { id: U(1), username: 'dustyr', displayName: 'Dusty Rhodes', exists: true },
  lena: { id: U(2), username: 'lena', displayName: 'Lena Park', exists: true },
  marcus: { id: U(3), username: 'marcus', displayName: 'Marcus Webb', exists: true },
  maya: { id: U(4), username: 'maya.l', displayName: 'Maya Lin', exists: true },
}

const alerts = [
  { id: 'a1', kind: 'report_new', title: 'New report', body: '@dustyr in Night Owls', data: { open: 'reports' }, createdAt: iso(25) },
  { id: 'a2', kind: 'server_down', title: 'Server back after restart', body: '6 s', data: { open: 'server' }, createdAt: iso(180) },
]

const constellations = [
  ['Starlight Lounge', 'jacobr', 212, 9, 41, 0, null],
  ['Night Owls', 'marcus', 64, 6, 2, 3, null],
  ['Ranked Grind', 'samo', 38, 4, 0, 0, null],
  ['Book Nook', 'lena', 21, 3, 1, 0, null],
  ['Free Skins 4 U', 'dustyr', 9, 2, 0, 1, iso(300)],
  ['Mullins Family', 'chipm', 7, 2, 0, 0, null],
].map(([name, owner, members, nebulas, joins, reports, frozen], i) => ({
  id: U(100 + i),
  name,
  visibility: 'invite',
  type: null,
  createdAt: iso(60 * 24 * 4),
  lastActivityAt: iso(5),
  takenDownAt: null,
  takedownReason: null,
  owner: { id: U(200 + i), username: owner, displayName: owner },
  memberCount: members,
  openReports: reports,
  joinsToday: joins,
  nebulaCount: nebulas,
  frozenAt: frozen,
  invitesOffAt: null,
}))

const report = {
  id: U(300),
  reason: 'spam',
  reasonLabel: 'Spam',
  details: 'Same link in every nebula he joined.',
  kind: 'message',
  messageId: 'm3',
  chat: { kind: 'nebula', name: 'general', constellation: { id: U(101), name: 'Night Owls' } },
  message: { id: 'm3', senderId: people.dusty.id, body: 'free skins here → [link removed from preview]', createdAt: iso(125), attachments: [] },
  context: [
    { id: 'm1', senderId: people.marcus.id, body: 'anyone up for ranked tonight?', createdAt: iso(130), attachments: [] },
    { id: 'm2', senderId: people.lena.id, body: 'after 10 maybe', createdAt: iso(128), attachments: [] },
    { id: 'm3', senderId: people.dusty.id, body: 'free skins here → [link removed from preview]', createdAt: iso(125), attachments: [] },
    { id: 'm4', senderId: people.marcus.id, body: 'bro stop posting that', createdAt: iso(124), attachments: [] },
  ],
  people: [people.dusty, people.lena, people.marcus],
  reporter: people.lena,
  reported: people.dusty,
  reportedSuspended: false,
  otherReportsAboutThem: 2,
  status: 'open',
  outcome: null,
  note: null,
  resolvedBy: null,
  createdAt: iso(120),
  resolvedAt: null,
}

const kinds = {
  server_down: true,
  control_signin: true,
  report_spike: true,
  report_new: true,
  delivery_failures: true,
  account_new: false,
  constellation_growing: true,
  inbox_reply: true,
  morning_summary: true,
  costs: true,
}

function answer(method: string, path: string): Record<string, unknown> | null {
  const p = path.split('?')[0]
  if (method !== 'GET') return { ok: true, message: 'Done (preview).' }
  if (p === '/admin/dashboard')
    return {
      timeZone: 'America/Chicago',
      stats: { accounts: 148, newThisWeek: 4, onlineNow: 23, devicesConnected: 31, messagesToday: 1284, messagesYesterday: 1178, callsToday: 9, groupCallsToday: 2, storageBytes: 0, fileCount: 0 },
      health: {
        server: { ok: true, uptimeSec: 6 * 86400 + 3600, files: 'ok' },
        database: { ok: true, ms: 2 },
        redis: { ok: true },
        realtime: { devices: 31 },
        email: { transport: 'ses', failedToday: 2 },
        calls: { configured: true },
        push: { configured: true, failedToday: 0 },
      },
      daily: [],
      versions: [],
      signupMode: 'open',
      openReports: 3,
      recentAccounts: [],
      recentActions: [],
      now: { calls: 2, inCalls: 6, oldestOpenReport: { createdAt: iso(120), reason: 'spam' }, inboxUnread: 1, lockdown: { on: false, since: null }, alerts },
    }
  if (p === '/admin/server')
    return { pause: { paused: false, message: '', since: null }, defaultPauseMessage: 'Glofly is taking a short break.', startedAt: iso(8700), uptimeSec: 6 * 86400 + 3600, canRestart: true, devicesConnected: 31, lockdown: { on: false, since: null } }
  if (p === '/admin/server/uptime')
    return {
      percent: 99.98,
      days: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, status: i === 22 ? 'down' : i === 14 || i === 27 ? 'you' : 'up', downSec: 0 })),
      events: [
        { kind: 'restart', startedAt: iso(180), endedAt: iso(179), seconds: 6 },
        { kind: 'outage', startedAt: iso(60 * 24 * 7), endedAt: iso(60 * 24 * 7 - 3), seconds: 160 },
      ],
    }
  if (p === '/admin/server/lockdown') return { lockdown: { on: false, since: null }, affected: 3, hours: 24 }
  if (p === '/admin/signups') return { mode: 'open', codes: [] }
  if (p === '/admin/announcements') return { current: null, history: [], minVersion: { version: null, message: null } }
  if (p === '/admin/app-version') {
    const plat = new URLSearchParams(path.split('?')[1] ?? '').get('platform')
    return { minVersion: plat === 'desktop' ? '0.8.0' : plat === 'ios' || plat === 'android' ? '1.0.0' : null, message: null, newest: '0.8.2', check: null }
  }
  if (p === '/admin/devices')
    return { devices: [{ id: U(900), name: "Chip's iPhone", createdAt: iso(60 * 24), lastUsedAt: iso(1), lastIp: '203.0.113.9', alerts: true, thisDevice: true }], max: 3 }
  if (p === '/admin/quick-notes') return { notes: ['Server stuck', 'Spam wave', 'Maintenance', 'Testing a fix', 'Report follow-up'] }
  if (p === '/admin/alerts') return { alerts, prefs: { kinds, desktop: true }, pushReady: true, now: iso(0) }
  if (p === '/admin/reports')
    return {
      counts: { open: 3, resolved: 12 },
      more: false,
      reports: [0, 1, 2].map((i) => ({ id: i ? U(300 + i) : report.id, reason: 'spam', reasonLabel: 'Spam', kind: 'message', preview: null, chatKind: null, reporter: people.lena, reported: people.dusty, status: 'open', outcome: null, createdAt: iso(120 - i * 30), resolvedAt: null })),
    }
  if (p.startsWith('/admin/reports/')) return { report }
  if (p === '/admin/accounts')
    return {
      counts: { all: 148, invited: 2, unconfirmed: 5, suspended: 1, deleting: 0 },
      more: false,
      invites: [],
      accounts: Object.values(people).map((x, i) => ({ id: x.id, username: x.username, displayName: x.displayName, email: `${x.username}@example.com`, createdAt: iso(60 * 24 * (i + 2)), lastSeenAt: iso(i * 40), online: i === 3, isAdmin: false, status: i === 0 ? 'unconfirmed' : 'confirmed' })),
    }
  if (p.startsWith('/admin/accounts/'))
    return {
      account: {
        id: people.maya.id,
        username: 'maya.l',
        displayName: 'Maya Lin',
        email: 'maya@example.com',
        emailVerified: true,
        pendingEmail: null,
        createdAt: '2026-10-09T15:00:00Z',
        lastSeenAt: iso(0),
        online: true,
        statusText: null,
        isAdmin: false,
        status: 'confirmed',
        suspendedAt: null,
        suspendReason: null,
        deleteAfter: null,
        friends: 18,
        groups: 4,
        storageBytes: 48_000_000,
        fileCount: 31,
        inviteCode: null,
        invitedBy: 'you',
        devices: [
          { id: 'd1', deviceName: 'iPhone', appVersion: '1.0.0', createdAt: iso(9000), lastUsedAt: iso(0), online: true },
          { id: 'd2', deviceName: 'Windows', appVersion: '0.8.0', createdAt: iso(9000), lastUsedAt: iso(600), online: false },
        ],
      },
      history: [],
    }
  if (p === '/admin/constellations') return { constellations, hasMore: false, totals: { constellations: 27, nebulas: 118, voiceLive: 14 } }
  if (p.startsWith('/admin/constellations/'))
    return {
      constellation: {
        ...constellations[0],
        description: null,
        tags: [],
        messagesToday: 3410,
        openReports: 0,
        nebulas: [
          { id: 'n1', name: 'welcome', kind: 'text', messages: 900, visibility: 'everyone', readOnly: false, messagesToday: 86, inVoice: 0 },
          { id: 'n2', name: 'general', kind: 'text', messages: 9000, visibility: 'everyone', readOnly: false, messagesToday: 2120, inVoice: 0 },
          { id: 'n3', name: 'Lounge Voice', kind: 'voice', messages: 0, inVoice: 7 },
          { id: 'n4', name: 'mods', kind: 'text', messages: 300, visibility: 'roles', readOnly: false, messagesToday: 31, inVoice: 0 },
          { id: 'n5', name: 'Movie Night', kind: 'voice', messages: 0, inVoice: 4 },
        ],
        moderation: [],
      },
    }
  if (p === '/admin/inbox')
    return { threads: [{ user: { ...people.maya, avatarVersion: null }, lastAt: iso(30), preview: 'Thanks! It stopped.', lastFromTeam: false, unread: 1 }], unreadTotal: 1 }
  if (p.startsWith('/admin/inbox/'))
    return {
      user: { ...people.maya, avatarVersion: null },
      items: [
        { id: 'i1', from: 'team', body: 'Hey Maya! Your report about the spam link was handled, thanks for flagging it.', createdAt: iso(90), seen: true, allowReply: true },
        { id: 'i2', from: 'user', body: 'Thanks! It stopped.', createdAt: iso(30), unread: false, noticeId: 'x' },
      ],
    }
  if (p === '/admin/audit')
    return { entries: [{ id: 'e1', createdAt: iso(4), action: 'Signed in', targetUserId: null, targetLabel: null, details: null, note: "Chip's iPhone (phone)", ip: '203.0.113.9', adminUsername: 'chipm' }], hasMore: false }
  return null
}

export function installPreview(): boolean {
  if (typeof window === 'undefined') return false
  ;(window as unknown as { control: unknown }).control = {
    call: async (method: string, path: string) => {
      const data = answer(method, path)
      return data ? { ok: true, data } : { ok: false, status: 404, error: 'not_found', message: `Preview has no sample for ${path}` }
    },
  }
  // ?phase=signin or ?phase=approve shows those screens instead.
  const phase = new URLSearchParams(window.location.search).get('phase')
  if (phase === 'signin' || phase === 'approve') {
    useSession.setState({ phase, approved: phase === 'signin' ? { deviceId: U(900), phoneName: "Chip's iPhone" } : null })
    return true
  }
  useSession.setState({
    phase: 'app',
    approved: { deviceId: U(900), phoneName: "Chip's iPhone" },
    admin: { userId: U(999), username: 'chipm', displayName: 'Chip', avatarVersion: null },
    expiresAt: Date.now() + 30 * 60_000,
  })
  return true
}

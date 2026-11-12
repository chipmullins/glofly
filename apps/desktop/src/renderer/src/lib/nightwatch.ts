import { MOD_REPORT_REASONS } from '@glofly/shared'
import type {
  ApiResult,
  BanAppeal,
  BanAppeals,
  BanDeleteWindow,
  ConstellationDetail,
  ModLogEntry,
  ModLogFilter,
  MyBan,
  NightWatch,
  PublicUser,
  SafetySettings,
  TimeoutLength
} from '@glofly/shared'

// Communities round 2: Night watch (approved canvas "Glofly communities round 2", boards 1a–1d).
// Requests go through the constellations gateway (only /constellations/…).

const call = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

const base = (id: string): string => `/constellations/${id}`

export type ModLogQuery = {
  filter: ModLogFilter
  actor: string | null
  q: string
  days: number
  before?: string
}
const qs = (q: ModLogQuery): string => {
  const p = new URLSearchParams({ filter: q.filter, days: String(q.days) })
  if (q.actor) p.set('actor', q.actor)
  if (q.q.trim()) p.set('q', q.q.trim())
  if (q.before) p.set('before', q.before)
  return p.toString()
}

export type RaidJoiner = {
  user: import('@glofly/shared').PublicUser
  joinedAt: string
  accountCreatedAt: string
}

export const watch = {
  dashboard: (id: string) => call<NightWatch>('GET', `${base(id)}/watch`),
  log: (id: string, q: ModLogQuery) =>
    call<{ entries: ModLogEntry[]; hasMore: boolean }>('GET', `${base(id)}/modlog?${qs(q)}`),
  exportLog: (id: string, q: ModLogQuery) =>
    call<{ csv: string; lines: number }>('GET', `${base(id)}/modlog/export?${qs(q)}`),
  undo: (id: string, entryId: string) =>
    call<{ entry: ModLogEntry }>('POST', `${base(id)}/modlog/${entryId}/undo`),
  safety: (id: string) =>
    call<{ safety: SafetySettings; canChange: boolean }>('GET', `${base(id)}/safety`),
  setSafety: (id: string, changes: Partial<SafetySettings>) =>
    call<{ safety: SafetySettings; canChange: boolean }>('PUT', `${base(id)}/safety`, changes),
  pauseJoins: (id: string, minutes: number) =>
    call<{ pausedUntil: string }>('POST', `${base(id)}/joins/pause`, { minutes }),
  reopenJoins: (id: string) => call<{ pausedUntil: null }>('DELETE', `${base(id)}/joins/pause`),
  raidJoiners: (id: string) => call<{ joiners: RaidJoiner[] }>('GET', `${base(id)}/raid/joiners`),
  raidClear: (id: string, userIds?: string[]) =>
    call<{ cleared: number }>('POST', `${base(id)}/raid/clear`, userIds ? { userIds } : {}),
  raidKick: (id: string, userIds: string[]) =>
    call<{ kicked: number }>('POST', `${base(id)}/raid/kick`, { userIds }),
  report: (id: string, messageId: string, reason: string) =>
    call<{ ok: true }>('POST', `${base(id)}/reports`, { messageId, reason }),
  assign: (id: string, reportId: string) =>
    call<NightWatch>('POST', `${base(id)}/reports/${reportId}/assign`),
  resolve: (
    id: string,
    reportId: string,
    action: 'dismiss' | 'delete' | 'delete_timeout',
    length?: TimeoutLength
  ) => call<NightWatch>('POST', `${base(id)}/reports/${reportId}/resolve`, { action, length }),
  keepHidden: (id: string, heldId: string) =>
    call<NightWatch>('POST', `${base(id)}/held/${heldId}/keep`),
  letThrough: (id: string, heldId: string) =>
    call<unknown>('POST', `${base(id)}/automod/held/${heldId}/release`),
  appeals: (id: string, status: 'open' | 'all' = 'open') =>
    call<{ appeals: BanAppeal[] }>('GET', `${base(id)}/appeals?status=${status}`),
  decide: (id: string, appealId: string, decision: 'accept' | 'deny', reply: string) =>
    call<{ appeal: BanAppeal | null }>('POST', `${base(id)}/appeals/${appealId}`, {
      decision,
      reply: reply.trim() || null
    }),
  ban: (
    id: string,
    userId: string,
    opts: { reason?: string; appeals: BanAppeals; deleteWindow: BanDeleteWindow }
  ) =>
    call<{ constellation: ConstellationDetail }>('POST', `${base(id)}/members/${userId}/ban`, opts),
  myBans: () => call<{ bans: MyBan[] }>('GET', '/constellations/bans/mine'),
  appeal: (id: string, body: string) => call<{ ok: true }>('POST', `${base(id)}/appeal`, { body })
}

// ───────────── Words for the mod log (shared by the dashboard and the log) ─────────────

export const ago = (iso: string, now = Date.now()): string => {
  const s = (now - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86_400) return 'Yesterday'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
export const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
export const at = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
export const handle = (u: PublicUser | null): string => (u ? `@${u.username}` : 'someone')
export const reasonName = (id: string): string =>
  MOD_REPORT_REASONS.find((r) => r.id === id)?.name ?? id

// ───────────── What a mod log line says ─────────────

const WORDS: Record<string, string> = {
  kicked: 'kicked',
  banned: 'banned',
  unbanned: 'unbanned',
  timed_out: 'timed out',
  timeout_removed: 'removed the time-out on',
  message_deleted: 'deleted a message from',
  messages_deleted: 'deleted recent messages from',
  roles_changed: 'changed the roles of',
  role_created: 'created a role',
  role_changed: 'changed a role',
  role_deleted: 'deleted a role',
  nebula_deleted: 'deleted a nebula',
  category_deleted: 'deleted a category',
  voice_muted: 'muted in voice',
  voice_unmuted: 'unmuted in voice',
  voice_disconnected: 'disconnected from voice',
  visibility_changed: 'changed who can join',
  settings_changed: 'changed settings',
  onboarding_changed: 'changed onboarding',
  request_approved: 'let in',
  request_denied: 'turned down',
  ownership_transferred: 'gave ownership to',
  automod_hidden: 'held a message from',
  automod_links: 'held links from',
  automod_mentions: 'held a message with too many mentions from',
  automod_raid: 'held a message from a raid joiner,',
  automod_wait: 'asked a new member to wait:',
  automod_undo: 'let a held message through from',
  automod_kept: 'kept a held message hidden from',
  automod_changed: 'changed AutoMod',
  safety_changed: 'changed Safety',
  joins_locked: 'paused joins',
  joins_unlocked: 'reopened joins',
  raid_cleared: 'let raid joiners talk',
  raid_kicked: 'kicked raid joiners',
  report_dismissed: 'dismissed a report about',
  report_actioned: 'acted on a report about',
  appeal_accepted: 'accepted the appeal of',
  appeal_denied: 'turned down the appeal of',
  event_cancelled: 'cancelled an event by'
}

export function actorName(e: { actor: PublicUser | null; by: string }, meId: string): string {
  if (e.actor) return e.actor.id === meId ? 'You' : e.actor.displayName
  return e.by === 'safety' ? 'Safety' : e.by === 'automod' ? 'AutoMod' : 'Glofly'
}

export function logLine(e: Pick<ModLogEntry, 'action' | 'target' | 'details'>): {
  verb: string
  target: string
  extra: string
  reason: string | null
} {
  const d = (e.details ?? {}) as Record<string, unknown>
  const s = (k: string): string | null => (typeof d[k] === 'string' ? (d[k] as string) : null)
  const n = (k: string): number | null => (typeof d[k] === 'number' ? (d[k] as number) : null)
  let extra = ''
  if (e.action === 'timed_out' && s('length')) extra = ` for ${s('length')}`
  else if (e.action === 'joins_locked')
    extra =
      n('joins') !== null
        ? ` (raid protection: ${n('joins')} joins in ${n('seconds') ?? 60} s, ${n('newAccounts')} new accounts)`
        : n('minutes')
          ? ` for ${n('minutes')! >= 60 ? `${n('minutes')! / 60} h` : `${n('minutes')} min`}`
          : ''
  else if (e.action === 'raid_cleared' || e.action === 'raid_kicked')
    extra = n('count') ? ` (${n('count')})` : ''
  else if (e.action === 'messages_deleted' && n('count')) extra = ` (${n('count')})`
  else if (e.action === 'automod_hidden' && s('word')) extra = ` · blocked word “${s('word')}”`
  else if (e.action === 'automod_mentions' && n('count')) extra = ` (${n('count')} pings)`
  else if (e.action === 'safety_changed' && s('verification'))
    extra = `: verification ${s('verification')}`
  else if ((e.action.startsWith('role_') || e.action.endsWith('_deleted')) && s('name'))
    extra = ` “${s('name')}”`
  else if (e.action === 'banned' && s('appeals'))
    extra =
      s('appeals') === 'never'
        ? ' · no appeals'
        : s('appeals') === 'later'
          ? ' · appeals after 7 days'
          : ''
  const nebula = s('nebulaName')
  if (nebula && e.action.startsWith('automod_')) extra = ` in #${nebula}${extra}`
  // A nebula you can't see (role-only): the server leaves out what happened there.
  if ((e.details as { hidden?: unknown } | null)?.hidden === true) extra = ' in a nebula you can’t see'
  const reason = s('reason') && s('reason') !== 'account_removed' ? s('reason') : null
  return {
    verb: WORDS[e.action] ?? e.action.replace(/_/g, ' '),
    target:
      e.target && !['joins_locked', 'joins_unlocked'].includes(e.action)
        ? ` ${handle(e.target)}`
        : '',
    extra,
    reason
  }
}

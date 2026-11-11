// Communities round 2 (Nov 11, 2026): moderation at scale, "Night watch" (approved canvas
// "Glofly communities round 2", boards 1a–1e). Types and rules the server and every app share.

import type { PublicUser } from './types'

// ───────────── Safety: verification, raid protection, mention cap (board 1d) ─────────────

export type VerificationLevel = 'off' | 'low' | 'medium' | 'high'

export const VERIFICATION_LEVELS: readonly { id: VerificationLevel; name: string; what: string }[] = [
  { id: 'off', name: 'Off', what: 'Anyone who joins' },
  { id: 'low', name: 'Low', what: 'Their email is confirmed' },
  { id: 'medium', name: 'Medium', what: 'Confirmed email and a Glofly account at least 7 days old' },
  { id: 'high', name: 'High', what: 'Medium, and in the constellation for at least 10 minutes' },
]

/** Medium and High: the Glofly account's age. */
export const VERIFY_ACCOUNT_DAYS = 7
/** High: how long someone has been in the constellation. */
export const VERIFY_MEMBER_MINUTES = 10

export type MentionCapAction = 'block' | 'timeout10' | 'timeout60'

export type SafetySettings = {
  verification: VerificationLevel
  /** Roles that skip verification (moderators and up always do) */
  verificationSkipRoles: string[]
  raidOn: boolean
  /** Pause joins after this many joins… */
  raidJoins: number
  /** …within this many seconds… */
  raidSeconds: number
  /** …counting only Glofly accounts younger than this many days */
  raidAccountDays: number
  /** How long joins stay paused */
  raidPauseMinutes: number
  /** Hold messages from people who joined during the raid until a moderator looks */
  raidHold: boolean
  /** Push alert to moderators */
  raidAlert: boolean
  mentionCapOn: boolean
  /** Block messages that mention more than this many people or roles */
  mentionCap: number
  mentionCapAction: MentionCapAction
}

export const DEFAULT_SAFETY: SafetySettings = {
  verification: 'off',
  verificationSkipRoles: [],
  raidOn: true,
  raidJoins: 15,
  raidSeconds: 60,
  raidAccountDays: 7,
  raidPauseMinutes: 30,
  raidHold: true,
  raidAlert: true,
  mentionCapOn: true,
  mentionCap: 5,
  mentionCapAction: 'timeout10',
}

export const RAID_JOINS_CHOICES: readonly number[] = [5, 10, 15, 25, 50, 100]
export const RAID_SECONDS_CHOICES: readonly { s: number; name: string }[] = [
  { s: 10, name: '10 seconds' },
  { s: 30, name: '30 seconds' },
  { s: 60, name: '1 minute' },
  { s: 300, name: '5 minutes' },
]
export const RAID_ACCOUNT_DAYS_CHOICES: readonly { d: number; name: string }[] = [
  { d: 1, name: '1 day' },
  { d: 7, name: '7 days' },
  { d: 30, name: '30 days' },
  { d: 36500, name: 'any age' },
]
export const RAID_PAUSE_CHOICES: readonly { m: number; name: string }[] = [
  { m: 10, name: '10 minutes' },
  { m: 30, name: '30 minutes' },
  { m: 60, name: '1 hour' },
  { m: 360, name: '6 hours' },
]
export const MENTION_CAP_CHOICES: readonly number[] = [3, 5, 8, 10, 15, 20]
export const MENTION_CAP_ACTIONS: readonly { id: MentionCapAction; name: string }[] = [
  { id: 'block', name: 'Just block it' },
  { id: 'timeout10', name: 'Time out 10 minutes' },
  { id: 'timeout60', name: 'Time out 1 hour' },
]

/** Fills anything missing or out of range with the defaults (settings saved by older servers, or bad input). */
export function cleanSafety(raw: unknown): SafetySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof SafetySettings, unknown>>
  const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d)
  const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d)
  const D = DEFAULT_SAFETY
  return {
    verification: pick(r.verification, VERIFICATION_LEVELS.map((l) => l.id), D.verification),
    verificationSkipRoles: Array.isArray(r.verificationSkipRoles)
      ? [...new Set(r.verificationSkipRoles.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))].slice(0, 20)
      : [],
    raidOn: bool(r.raidOn, D.raidOn),
    raidJoins: pick(r.raidJoins, RAID_JOINS_CHOICES, D.raidJoins),
    raidSeconds: pick(r.raidSeconds, RAID_SECONDS_CHOICES.map((c) => c.s), D.raidSeconds),
    raidAccountDays: pick(r.raidAccountDays, RAID_ACCOUNT_DAYS_CHOICES.map((c) => c.d), D.raidAccountDays),
    raidPauseMinutes: pick(r.raidPauseMinutes, RAID_PAUSE_CHOICES.map((c) => c.m), D.raidPauseMinutes),
    raidHold: bool(r.raidHold, D.raidHold),
    raidAlert: bool(r.raidAlert, D.raidAlert),
    mentionCapOn: bool(r.mentionCapOn, D.mentionCapOn),
    mentionCap: pick(r.mentionCap, MENTION_CAP_CHOICES, D.mentionCap),
    mentionCapAction: pick(r.mentionCapAction, MENTION_CAP_ACTIONS.map((a) => a.id), D.mentionCapAction),
  }
}

/**
 * Does someone meet a verification level? Null = yes; otherwise what to tell them. `now` and
 * the dates are milliseconds.
 */
export function verificationProblem(
  level: VerificationLevel,
  who: { emailConfirmed: boolean; accountCreatedAt: number; joinedAt: number },
  now: number,
): string | null {
  if (level === 'off') return null
  if (!who.emailConfirmed) return 'Confirm your email to chat here. (Settings → Account sends the link again.)'
  if (level === 'low') return null
  const accountReady = who.accountCreatedAt + VERIFY_ACCOUNT_DAYS * 86_400_000
  if (accountReady > now) return `This constellation lets new Glofly accounts chat after ${VERIFY_ACCOUNT_DAYS} days. You can chat ${whenText(accountReady - now)}.`
  if (level === 'medium') return null
  const memberReady = who.joinedAt + VERIFY_MEMBER_MINUTES * 60_000
  if (memberReady > now) return `New members can chat after ${VERIFY_MEMBER_MINUTES} minutes here. You can chat ${whenText(memberReady - now)}.`
  return null
}

function whenText(ms: number): string {
  const min = Math.ceil(ms / 60_000)
  if (min < 60) return `in ${min} minute${min === 1 ? '' : 's'}`
  const h = Math.ceil(min / 60)
  if (h < 48) return `in ${h} hour${h === 1 ? '' : 's'}`
  const d = Math.ceil(h / 24)
  return `in ${d} days`
}

/**
 * How many people and roles a message pings, for the mention cap: each person and role once,
 * and @everyone / @here together count as one.
 */
export function mentionCount(people: readonly string[], roles: readonly string[], everyoneOrHere: boolean): number {
  return new Set(people).size + new Set(roles).size + (everyoneOrHere ? 1 : 0)
}

// ───────────── Bans + appeals (board 1c) ─────────────

export type BanAppeals = 'now' | 'later' | 'never'
/** "Can appeal after 7 days" */
export const BAN_APPEAL_WAIT_DAYS = 7
/** Another appeal after a "no", this many days later. */
export const BAN_APPEAL_AGAIN_DAYS = 30
export const APPEAL_MAX = 1000
export const APPEAL_REPLY_MAX = 500

export type BanDeleteWindow = 'none' | '1h' | '24h' | '7d'
export const BAN_DELETE_WINDOWS: readonly { id: BanDeleteWindow; name: string; ms: number }[] = [
  { id: 'none', name: 'Keep all', ms: 0 },
  { id: '1h', name: 'Last hour', ms: 3_600_000 },
  { id: '24h', name: 'Last 24 h', ms: 86_400_000 },
  { id: '7d', name: 'Last 7 days', ms: 7 * 86_400_000 },
]
/** The quick reasons above the ban reason box. */
export const QUICK_BAN_REASONS: readonly string[] = ['Spam', 'Harassment', 'Spoilers', 'Raid account']

/** A ban, as the banned person sees it (Constellations dashboard → Your bans). */
export type MyBan = {
  constellation: { id: string; name: string; color: string; iconVersion: string | null }
  reason: string | null
  createdAt: string
  appeals: BanAppeals
  /** When they can appeal (null = never) */
  appealFrom: string | null
  /** Their latest appeal (null = none yet) */
  appeal: { status: AppealStatus; createdAt: string; reply: string | null } | null
}

export type AppealStatus = 'open' | 'accepted' | 'denied'

/** An appeal, as moderators see it (Night watch → Appeals). */
export type BanAppeal = {
  id: string
  user: PublicUser
  body: string
  status: AppealStatus
  createdAt: string
  ban: { reason: string | null; createdAt: string; by: PublicUser | null }
  /** 1 = their first appeal for this ban */
  number: number
  /** Before the ban: warnings, time-outs, held messages (from the mod log) */
  history: { timeouts: number; deleted: number; held: number }
  decidedBy: PublicUser | null
  decidedAt: string | null
  reply: string | null
}

/** When an appeal may be sent, or null if never. */
export function appealOpensAt(appeals: BanAppeals, bannedAt: number, lastDeniedAt: number | null): number | null {
  if (appeals === 'never') return null
  let at = appeals === 'later' ? bannedAt + BAN_APPEAL_WAIT_DAYS * 86_400_000 : bannedAt
  if (lastDeniedAt !== null) at = Math.max(at, lastDeniedAt + BAN_APPEAL_AGAIN_DAYS * 86_400_000)
  return at
}

// ───────────── Night watch: the queue (board 1a) ─────────────

export type ReportStatus = 'open' | 'actioned' | 'dismissed'
export const MOD_REPORT_REASONS: readonly { id: string; name: string }[] = [
  { id: 'spam', name: 'Spam' },
  { id: 'harassment', name: 'Harassment' },
  { id: 'hate', name: 'Hate' },
  { id: 'nsfw', name: 'Not safe for this place' },
  { id: 'other', name: 'Something else' },
]

export type QueueItem =
  | {
      kind: 'report'
      id: string
      createdAt: string
      reason: string
      reporters: PublicUser[]
      reportCount: number
      target: PublicUser | null
      nebula: { id: string; name: string } | null
      messageId: string | null
      /** What the message said when it was first reported */
      excerpt: string
      /** The message is still there (not deleted since) */
      messageLive: boolean
      assignedTo: PublicUser | null
    }
  | {
      kind: 'held'
      id: string
      createdAt: string
      /** word / links / mentions / raid */
      reason: string
      detail: string | null
      target: PublicUser | null
      nebula: { id: string; name: string } | null
      excerpt: string
    }
  | {
      kind: 'appeal'
      id: string
      createdAt: string
      target: PublicUser
      excerpt: string
      banReason: string | null
      bannedAt: string
    }

export type RaidState = {
  /** Joins are paused until then (null = open) */
  pausedUntil: string | null
  /** When the last raid was noticed */
  raidAt: string | null
  /** People who joined during it and are still waiting for a look (raidHold) */
  heldJoiners: number
}

export type NightWatch = {
  counts: { reports: number; held: number; appeals: number; timedOut: number; actionsWeek: number; moderatorsWeek: number }
  queue: QueueItem[]
  safety: SafetySettings
  raid: RaidState
  joinsToday: number
  /** Typical joins per day over the last 2 weeks */
  joinsUsual: number
  /** Latest mod log lines (people, AutoMod, Safety) */
  latest: { id: string; actor: PublicUser | null; by: 'person' | 'automod' | 'safety' | 'glofly'; action: string; target: PublicUser | null; details: Record<string, unknown> | null; createdAt: string }[]
  /** What you can do here (each button follows your role) */
  can: { delete: boolean; timeout: boolean; ban: boolean; safety: boolean }
}

/** Mod log filters (board 1b). */
export type ModLogFilter = 'all' | 'bans' | 'timeouts' | 'kicks' | 'deleted' | 'automod' | 'safety' | 'roles' | 'settings'
export const MOD_LOG_FILTERS: readonly { id: ModLogFilter; name: string; actions: readonly string[] }[] = [
  { id: 'all', name: 'Every action', actions: [] },
  { id: 'bans', name: 'Bans', actions: ['banned', 'unbanned', 'appeal_accepted', 'appeal_denied'] },
  { id: 'timeouts', name: 'Time-outs', actions: ['timed_out', 'timeout_removed'] },
  { id: 'kicks', name: 'Kicks', actions: ['kicked'] },
  { id: 'deleted', name: 'Deleted messages', actions: ['message_deleted', 'messages_deleted'] },
  { id: 'automod', name: 'AutoMod', actions: ['automod_hidden', 'automod_links', 'automod_wait', 'automod_mentions', 'automod_raid', 'automod_undo', 'automod_kept', 'automod_changed'] },
  { id: 'safety', name: 'Safety', actions: ['joins_locked', 'joins_unlocked', 'raid_cleared', 'raid_kicked', 'safety_changed', 'report_dismissed', 'report_actioned'] },
  { id: 'roles', name: 'Roles', actions: ['roles_changed', 'role_created', 'role_changed', 'role_deleted'] },
  { id: 'settings', name: 'Settings', actions: ['settings_changed', 'visibility_changed', 'onboarding_changed', 'nebula_deleted', 'category_deleted', 'ownership_transferred', 'stage_started', 'stage_ended', 'follow_added', 'follow_removed'] },
]
export const MOD_LOG_DAYS: readonly { d: number; name: string }[] = [
  { d: 1, name: 'Today' },
  { d: 7, name: 'Last 7 days' },
  { d: 30, name: 'Last 30 days' },
  { d: 180, name: 'Everything kept' },
]
/** The mod log keeps this long. */
export const MOD_LOG_KEEP_DAYS = 180

/** Mod log entry with whether Undo is still possible for you. */
export type ModLogEntry = {
  id: string
  actor: PublicUser | null
  by: 'person' | 'automod' | 'safety' | 'glofly'
  action: string
  target: PublicUser | null
  details: Record<string, unknown> | null
  createdAt: string
  canUndo: boolean
}

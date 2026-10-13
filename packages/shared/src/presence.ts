import type { Activity, MyStatusChoice, Presence, PresenceStatus } from './types'

export const STATUS_LABEL: Record<PresenceStatus | MyStatusChoice, string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do not disturb',
  offline: 'Offline',
  invisible: 'Invisible'
}

// Some JavaScript engines (Hermes on older Android setups) don't have Intl.RelativeTimeFormat:
// fall back to plain English rather than failing to load.
type Unit = 'minute' | 'hour' | 'day'
const relative: { format: (value: number, unit: Unit) => string } =
  typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function'
    ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
    : {
        format: (value, unit) => {
          const n = Math.abs(value)
          if (unit === 'day' && n === 1) return value < 0 ? 'yesterday' : 'tomorrow'
          const words = `${n} ${unit}${n === 1 ? '' : 's'}`
          return value < 0 ? `${words} ago` : `in ${words}`
        }
      }

/** "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago", or a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 60) return 'just now'
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 7 * 86400) return relative.format(Math.round(seconds / 86400), 'day')
  return `on ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

/** How long they've been playing: "1h 12m", "25m", or "just started". */
export function playedFor(activity: Activity, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(activity.since).getTime()) / 60000)
  if (!Number.isFinite(minutes) || minutes < 1) return 'just started'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`
}

/** What they're playing, if anything (never while offline). */
export const playing = (p: Presence | undefined): Activity | null =>
  p && p.status !== 'offline' ? (p.activity ?? null) : null

/** "Playing Guild Wars 2 · 1h 12m" */
export const activityLine = (activity: Activity, now = Date.now()): string =>
  `Playing ${activity.name} · ${playedFor(activity, now)}`

/**
 * The line under someone's name: what they're playing, custom status, their status, or when
 * they were last seen.
 */
export function presenceLine(p: Presence | undefined, now = Date.now()): string {
  if (!p) return ''
  if (p.status === 'offline')
    return p.lastSeenAt ? `Last seen ${timeAgo(p.lastSeenAt, now)}` : 'Offline'
  const game = playing(p)
  if (game) return `Playing ${game.name}`
  return p.statusText || (onMobile(p) && p.status === 'online' ? 'Active on mobile' : STATUS_LABEL[p.status])
}

/** Chat header version from the design: "Online · Grinding ranked tonight" (or "· Playing …"). */
export function presenceHeader(p: Presence | undefined, now = Date.now()): string {
  if (!p) return ''
  if (p.status === 'offline') return presenceLine(p, now)
  const game = playing(p)
  const label = mobileLabel(p) ?? STATUS_LABEL[p.status]
  if (game) return `${label} · ${activityLine(game, now)}`
  return p.statusText ? `${label} · ${p.statusText}` : label
}

/** Your own choice mapped to the dot friends see (Invisible looks offline). */
export const dotFor = (choice: MyStatusChoice): PresenceStatus =>
  choice === 'invisible' ? 'offline' : choice

/** "Active on mobile": shown with a small phone instead of (or next to) the status dot. */
export const onMobile = (p: Presence | undefined): boolean => !!p && p.status !== 'offline' && p.mobile === true

/** Profile card line: "Active on mobile" (or "Away · on mobile", "Do not disturb · on mobile"). */
export function mobileLabel(p: Presence | undefined): string | null {
  if (!onMobile(p)) return null
  return p!.status === 'online' ? 'Active on mobile' : `${STATUS_LABEL[p!.status]} · on mobile`
}

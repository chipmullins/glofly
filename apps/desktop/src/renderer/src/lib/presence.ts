import type { MyStatusChoice, Presence, PresenceStatus } from '../../../preload/api-types'

export const STATUS_LABEL: Record<PresenceStatus | MyStatusChoice, string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do not disturb',
  offline: 'Offline',
  invisible: 'Invisible'
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

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

/** The line under someone's name: custom status, their status, or when they were last seen. */
export function presenceLine(p: Presence | undefined, now = Date.now()): string {
  if (!p) return ''
  if (p.status === 'offline')
    return p.lastSeenAt ? `Last seen ${timeAgo(p.lastSeenAt, now)}` : 'Offline'
  return p.statusText || STATUS_LABEL[p.status]
}

/** Chat header version from the design: "Online · Grinding ranked tonight". */
export function presenceHeader(p: Presence | undefined, now = Date.now()): string {
  if (!p) return ''
  if (p.status === 'offline') return presenceLine(p, now)
  return p.statusText ? `${STATUS_LABEL[p.status]} · ${p.statusText}` : STATUS_LABEL[p.status]
}

/** Your own choice mapped to the dot friends see (Invisible looks offline). */
export const dotFor = (choice: MyStatusChoice): PresenceStatus =>
  choice === 'invisible' ? 'offline' : choice

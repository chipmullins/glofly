// Dates, sizes, names: how Control writes them.

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

export function time(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** "Today 9:41 PM", "Yesterday 8:30 PM", "Oct 7, 4:12 PM", "Oct 7, 2025, 4:12 PM". */
export function when(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  if (sameDay(date, now)) return `Today ${time(date)}`
  if (sameDay(date, new Date(now.getTime() - DAY))) return `Yesterday ${time(date)}`
  const sameYear = date.getFullYear() === now.getFullYear()
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })}, ${time(date)}`
}

/** "October 9, 2026". */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

/** "Oct 23". */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' })
  })
}

/** "just now", "5 min ago", "2 hours ago", "yesterday", "3 days ago", "Oct 7". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR)
    return h === 1 ? '1 hour ago' : `${h} hours ago`
  }
  const d = Math.floor(ms / DAY)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d} days ago`
  return shortDate(iso)
}

/** Days from now until a date, rounded up ("in 3 days"). */
export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY))
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function uptime(seconds: number): string {
  if (seconds < 3600) return `up ${Math.max(1, Math.round(seconds / 60))} min`
  if (seconds < 86400) return `up ${Math.round(seconds / 3600)} hours`
  const d = Math.floor(seconds / 86400)
  return d === 1 ? 'up 1 day' : `up ${d} days`
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => [...part][0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

// Same idea as the Glofly app: a steady color per person, picked from their id.
const AVATAR_COLORS = [
  '#c2410c',
  '#1d4ed8',
  '#7c3aed',
  '#0f766e',
  '#be185d',
  '#4d7c0f',
  '#b45309',
  '#0e7490'
]
export function avatarColor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

import { clockTime } from '@glofly/shared'

/** "November 10, 2026" */
export function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

/** The time in a chat list row: "10:04 PM", "Yesterday", "Tue", or "Oct 3". */
export function listTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return clockTime(iso)
  if (t >= startOfToday - 86_400_000) return 'Yesterday'
  if (t >= startOfToday - 6 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** "0:07", "1:23" */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** "12:48" or "1:02:05" for call timers. */
export function timer(fromIso: string, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** "2.4 MB" */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** First name for short labels ("Maya"). */
export const firstName = (displayName: string, username?: string) => displayName.trim().split(/\s+/)[0] || username || ''

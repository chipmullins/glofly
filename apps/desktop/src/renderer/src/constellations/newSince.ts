import type { Message } from '../../../preload/api-types'

// 0.7.5 "New since you left" (canvas board 7, approved): you land on a glowing line where you
// stopped reading, with a pill to jump up to it or mark the nebula read.

/** What you hadn't read when you opened a nebula. */
export type NewSince = {
  nebulaId: string
  /** When you last read it (ISO) */
  since: string
  /** How many new messages there were */
  count: number
}

const clock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** "6:12 PM" today, "Mon 6:12 PM" this week, "Oct 3, 6:12 PM" before that. */
export function sinceLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date(now).toDateString()) return clock(iso)
  if (now - d.getTime() < 6 * 24 * 60 * 60_000)
    return `${d.toLocaleDateString([], { weekday: 'short' })} ${clock(iso)}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(iso)}`
}

/** The first message after `since` that someone else wrote gets the line before it. */
export function isFirstNew(
  m: Message,
  previous: Message | undefined,
  since: string,
  meId: string
): boolean {
  const t = new Date(since).getTime()
  if (m.senderId === meId || m.event || new Date(m.createdAt).getTime() <= t) return false
  // The one before it was read already, is a quiet event line or yours (or it's the oldest one
  // loaded). The screen keeps the first one it finds, so a later one never gets a second line.
  return (
    !previous ||
    !!previous.event ||
    previous.senderId === meId ||
    new Date(previous.createdAt).getTime() <= t
  )
}

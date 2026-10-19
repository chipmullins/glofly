// 0.7.3: pinned messages, mark as unread, send later and quiet hours.

import type { Message } from './types'

// ---------------------------------------------------------------------------------------------
// Pinned messages

export type PinnedMessage = {
  message: Message
  pinnedBy: string | null
  pinnedAt: string
}

/** At most this many pins in one chat (the oldest has to be unpinned first) */
export const PINS_MAX = 50

// ---------------------------------------------------------------------------------------------
// Send later

export type ScheduledMessage = {
  id: string
  conversationId: string
  body: string
  replyToId: string | null
  sendAt: string
  /** Why it couldn't be sent at its time ("You're no longer in this group."), or null */
  failed: string | null
  createdAt: string
}

/** Send later: at least a minute ahead, at most a year */
export const SCHEDULE_MIN_MS = 60 * 1000
export const SCHEDULE_MAX_MS = 365 * 24 * 60 * 60 * 1000
/** Waiting messages per person in one chat */
export const SCHEDULED_PER_CHAT_MAX = 25

/** The quick choices in the Send later menu, from now (local time) */
export function sendLaterChoices(now: Date): { label: string; at: Date }[] {
  const at = (days: number, hour: number): Date => {
    const d = new Date(now)
    d.setDate(d.getDate() + days)
    d.setHours(hour, 0, 0, 0)
    return d
  }
  const out: { label: string; at: Date }[] = []
  const inAnHour = new Date(now.getTime() + 60 * 60 * 1000)
  out.push({ label: 'In 1 hour', at: inAnHour })
  const tonight = at(0, 20)
  if (tonight.getTime() - now.getTime() > 30 * 60 * 1000) out.push({ label: 'Tonight, 8 PM', at: tonight })
  out.push({ label: 'Tomorrow morning, 9 AM', at: at(1, 9) })
  out.push({ label: 'Tomorrow, 1 PM', at: at(1, 13) })
  // Next Monday 9 AM (a week from today if today is Monday)
  const toMonday = ((8 - now.getDay()) % 7) || 7
  out.push({ label: 'Monday, 9 AM', at: at(toMonday, 9) })
  return out
}

// ---------------------------------------------------------------------------------------------
// Quiet hours

export type QuietHours = {
  /** "HH:MM", 24-hour */
  from: string
  to: string
  /** IANA time zone */
  tz: string
  /** Calls still ring during quiet hours */
  calls: boolean
}

export const QUIET_DEFAULT = { from: '22:00', to: '08:00' } as const
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

export const isTimeOfDay = (s: unknown): s is string => typeof s === 'string' && HHMM.test(s)

const minutesOf = (s: string): number => {
  const m = HHMM.exec(s)
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0
}

/** Minutes past midnight right now in a time zone (UTC if the zone isn't known). */
export function minutesNowIn(tz: string, now: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(now)
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return (h % 24) * 60 + m
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes()
  }
}

/** Is it quiet hours right now? (From 22:00 to 08:00 crosses midnight; equal times = never.) */
export function inQuietHours(q: QuietHours | null | undefined, now: Date = new Date()): boolean {
  if (!q || !isTimeOfDay(q.from) || !isTimeOfDay(q.to)) return false
  const from = minutesOf(q.from)
  const to = minutesOf(q.to)
  if (from === to) return false
  const t = minutesNowIn(q.tz, now)
  return from < to ? t >= from && t < to : t >= from || t < to
}

/** "10:00 PM" from "22:00" */
export function timeOfDayLabel(s: string): string {
  const total = minutesOf(s)
  const h = Math.floor(total / 60)
  const m = total % 60
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

// 0.8.0 Statuses that clear themselves: "Clear after" for the custom status.
//
// The server works out the end time (statusClearEndsAt) from the choice and the person's own time
// zone; the apps only show it (statusEndsLine). "Today" ends at the next midnight where you are,
// "This week" at the end of Sunday (the midnight that starts Monday).

export const STATUS_CLEAR_AFTER = ['30m', '1h', '4h', 'today', 'week', 'never'] as const
export type StatusClearAfter = (typeof STATUS_CLEAR_AFTER)[number]

export const STATUS_CLEAR_LABEL: Record<StatusClearAfter, string> = {
  '30m': '30 minutes',
  '1h': '1 hour',
  '4h': '4 hours',
  today: 'Today',
  week: 'This week',
  never: 'Never'
}

const FIXED_MINUTES: Partial<Record<StatusClearAfter, number>> = { '30m': 30, '1h': 60, '4h': 240 }

export function isStatusClearAfter(value: unknown): value is StatusClearAfter {
  return typeof value === 'string' && (STATUS_CLEAR_AFTER as readonly string[]).includes(value)
}

/** True if the runtime knows this IANA time zone ("America/Chicago"). */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number; weekday: number }
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const formatters = new Map<string, Intl.DateTimeFormat>()

/** The wall-clock date and time at this moment in a time zone. */
function partsIn(date: Date, timeZone: string): Parts {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    formatters.set(timeZone, f)
  }
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(date)) p[part.type] = part.value
  return {
    y: +p.year,
    m: +p.month,
    d: +p.day,
    h: +p.hour % 24,
    mi: +p.minute,
    s: +p.second,
    weekday: WEEKDAYS.indexOf(p.weekday)
  }
}

/** How far the zone's clock is ahead of UTC at this moment (ms). */
function offsetAt(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone)
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * The moment the zone's clock first reads midnight starting this date (y, m, d may overflow,
 * e.g. day 32 = the 1st of next month). Where midnight is skipped by a clock change, it's the
 * first moment of that day.
 */
function midnightIn(y: number, m: number, d: number, timeZone: string): Date {
  const wall = Date.UTC(y, m - 1, d)
  let guess = wall - offsetAt(new Date(wall), timeZone)
  guess = wall - offsetAt(new Date(guess), timeZone)
  // A skipped midnight (clocks jump 00:00 → 01:00) lands an hour early, on the day before:
  // step forward to the start of the right day.
  const want = new Date(wall).toISOString().slice(0, 10)
  const got = partsIn(new Date(guess), timeZone)
  const gotDay = new Date(Date.UTC(got.y, got.m - 1, got.d)).toISOString().slice(0, 10)
  if (gotDay < want) guess += (24 - got.h) * 3_600_000 - got.mi * 60_000 - got.s * 1000
  return new Date(guess)
}

/** When a status set now with this "Clear after" ends, or null for Never. */
export function statusClearEndsAt(choice: StatusClearAfter, now: Date, timeZone: string): Date | null {
  if (choice === 'never') return null
  const minutes = FIXED_MINUTES[choice]
  if (minutes) return new Date(now.getTime() + minutes * 60_000)
  const p = partsIn(now, timeZone)
  // Today: the midnight that starts tomorrow. This week: the midnight that starts Monday.
  const days = choice === 'today' ? 1 : p.weekday === 0 ? 1 : 8 - p.weekday
  return midnightIn(p.y, p.m, p.d + days, timeZone)
}

function inWords(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const hours = Math.round(minutes / 60)
  const exact = minutes % 60 === 0
  return `in ${exact ? '' : 'about '}${hours} hour${hours === 1 ? '' : 's'}`
}

/**
 * The line under "Clear after": "Clears at 5:10 PM (in 4 hours)", "Clears tonight at midnight",
 * "Clears Sunday night at midnight" or "Stays until you change it". `endsAt` = ISO or Date, null
 * for Never. The zone and locale default to the device's own.
 */
export function statusEndsLine(
  endsAt: string | Date | null | undefined,
  now: Date = new Date(),
  options: { timeZone?: string; locale?: string } = {}
): string {
  if (!endsAt) return 'Stays until you change it'
  const end = typeof endsAt === 'string' ? new Date(endsAt) : endsAt
  if (Number.isNaN(end.getTime())) return 'Stays until you change it'
  const timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const e = partsIn(end, timeZone)
  if (e.h === 0 && e.mi === 0 && end.getTime() > now.getTime()) {
    // A midnight: name the night it ends ("tonight" if that's today).
    const n = partsIn(now, timeZone)
    const nightBefore = new Date(Date.UTC(e.y, e.m - 1, e.d - 1))
    const today = Date.UTC(n.y, n.m - 1, n.d)
    if (nightBefore.getTime() === today) return 'Clears tonight at midnight'
    const day = new Intl.DateTimeFormat(options.locale ?? 'en-US', { weekday: 'long', timeZone: 'UTC' }).format(nightBefore)
    return `Clears ${day} night at midnight`
  }
  const time = new Intl.DateTimeFormat(options.locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(end)
  return `Clears at ${time} (${inWords(end.getTime() - now.getTime())})`
}

/**
 * Which "Clear after" to show as picked for a status ending then: the choice that would end at
 * that same moment if picked now, or the nearest fixed one. Used to pre-select the chip when the
 * menu opens on a status that has an end. Never when there's no end.
 */
export function statusClearChoiceFor(endsAt: string | null | undefined, now: Date = new Date(), timeZone?: string): StatusClearAfter {
  if (!endsAt) return 'never'
  const end = new Date(endsAt).getTime()
  if (Number.isNaN(end)) return 'never'
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  for (const c of ['today', 'week'] as const) {
    if (statusClearEndsAt(c, now, tz)?.getTime() === end) return c
  }
  const left = (end - now.getTime()) / 60_000
  if (left <= 45) return '30m'
  if (left <= 150) return '1h'
  return '4h'
}

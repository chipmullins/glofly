// Event lines in chats ("Chip added Maya", "Video call · 12 min") and how they stay readable
// for older apps.
//
// 0.2.0's chat view breaks on an event type it doesn't know, so the server sends event types
// newer than 0.2.0 with `event: null`, a plain-text `body`, and the real event as `eventLine`.
// Newer apps turn `eventLine` back into `event` with `upgradeEvents`. Any new event type must get
// a plain-text fallback in `legacyEventBody`.
//
// 0.5.0: apps from 0.2.1 to 0.4.0 turn every `eventLine` back into a line, and show a line they
// don't know as an empty one. So event types newer than 0.4.0 (Watch Together's) travel as
// `eventLine2` instead: those apps don't know that field, so they show the plain-text `body` (a
// readable message from whoever did it), while 0.5.0+ apps turn `eventLine2` back into a line.
//
// 0.5.2: 0.5.0 and 0.5.1 apps turn every `eventLine2` back into a line too, and show one they
// don't know as an empty line. So event types newer than 0.5.1 (Add people's `callAdd`) travel as
// `eventLine3`: only 0.5.2+ apps turn that back into a line; older ones show the plain-text body.
//
// 0.7.5: 0.5.2–0.7.4 apps turn every `eventLine3` back into a line too (and show unknown ones as
// an empty line), so event types newer than 0.7.4 (Constellations' join and milestone lines)
// travel as `eventLine4`.

import type { ChatEvent } from './types'
import { listNames, milestoneText } from './groups'

/** Event types 0.2.0 apps understand (sent as they are). */
export const EVENTS_IN_020: ReadonlySet<string> = new Set([
  'created',
  'renamed',
  'added',
  'removed',
  'left',
  'call'
])

/** Event types 0.2.1–0.4.0 apps understand (sent to them as `eventLine`). */
export const EVENTS_IN_040: ReadonlySet<string> = new Set([...EVENTS_IN_020, 'photo'])

/** Event types 0.5.0–0.5.1 apps understand (sent to them as `eventLine2`). */
export const EVENTS_IN_051: ReadonlySet<string> = new Set([...EVENTS_IN_040, 'watch'])

/** Event types 0.5.2–0.7.4 apps understand (sent to them as `eventLine3`). */
export const EVENTS_IN_074: ReadonlySet<string> = new Set([...EVENTS_IN_051, 'callAdd'])

/**
 * For an event 0.2.0 apps don't know: the plain text they show instead (as a message from the
 * person who did it). Null for events they know.
 */
export function legacyEventBody(event: ChatEvent | null): string | null {
  if (!event || EVENTS_IN_020.has(event.type)) return null
  if (event.type === 'photo') return event.removed ? 'removed the group photo' : 'changed the group photo'
  if (event.type === 'watch') return `started watching “${event.title.slice(0, 80)}” together in the call`
  if (event.type === 'callAdd') {
    const who = listNames(event.names.length ? event.names : ['someone'], 4)
    return event.movedTo
      ? `added ${who} to the call. It carries on in a new group with everyone.`
      : `added ${who} to the call`
  }
  if (event.type === 'cxJoined') return `joined ${event.name.slice(0, 60)} 👋`
  if (event.type === 'cxMilestone') return milestoneText(event)
  return ''
}

/**
 * How the server sends an event line: as it is, as `eventLine` (0.2.1+ know it), as
 * `eventLine2` (only 0.5.0+ know it), or as `eventLine3` (only 0.5.2+). See above.
 */
export function eventField(event: ChatEvent | null): 'event' | 'eventLine' | 'eventLine2' | 'eventLine3' | 'eventLine4' {
  if (!event || EVENTS_IN_020.has(event.type)) return 'event'
  if (EVENTS_IN_040.has(event.type)) return 'eventLine'
  if (EVENTS_IN_051.has(event.type)) return 'eventLine2'
  return EVENTS_IN_074.has(event.type) ? 'eventLine3' : 'eventLine4'
}

/**
 * Turns `eventLine` / `eventLine2` / `eventLine3` / `eventLine4` (see above) back into `event` so the line shows as a line.
 * Works on any API answer or live event, at any depth (changes it in place).
 */
export function upgradeEvents<T>(value: T, depth = 0): T {
  if (depth > 8 || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const item of value) upgradeEvents(item, depth + 1)
    return value
  }
  const o = value as Record<string, unknown>
  for (const field of ['eventLine', 'eventLine2', 'eventLine3', 'eventLine4']) {
    const line = o[field] as { type?: unknown } | undefined
    if (line && typeof line === 'object' && typeof line.type === 'string' && o.event === null) {
      o.event = line
      o.body = ''
    }
    delete o[field]
  }
  for (const key of Object.keys(o)) {
    if (o[key] && typeof o[key] === 'object') upgradeEvents(o[key], depth + 1)
  }
  return value
}

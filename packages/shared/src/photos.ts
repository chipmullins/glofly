// The photo viewer (0.7.5, PhotoViewer.dc.html, approved): which photos of a chat it steps
// through, the "Saturday 6:42 PM" line, and the zoom/pan arithmetic. Desktop, web and phones
// share these so they agree. Plain TypeScript.

import type { Attachment, Message } from './types'

/** One photo in the viewer, with the message it came in. */
export type ViewerPhoto = { photo: Attachment; message: Pick<Message, 'id' | 'senderId' | 'createdAt'> }

/** Every photo (not stickers) of the loaded, not deleted messages, oldest first. */
export function viewerPhotos(
  messages: Pick<Message, 'id' | 'senderId' | 'createdAt' | 'deleted' | 'attachments'>[]
): ViewerPhoto[] {
  const list = messages
    .filter((m) => !m.deleted && m.attachments.length > 0)
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  const out: ViewerPhoto[] = []
  for (const m of list) {
    for (const a of m.attachments) {
      if (a.kind === 'image' && !a.sticker) {
        out.push({ photo: a, message: { id: m.id, senderId: m.senderId, createdAt: m.createdAt } })
      }
    }
  }
  return out
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function clock(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? '0' : ''}${m} ${h < 12 ? 'AM' : 'PM'}`
}

/** "Today 6:42 PM", "Yesterday …", "Saturday …" (this week), "Oct 3, 6:42 PM", "Oct 3, 2025, …" (local time). */
export function photoWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((day(now) - day(d)) / 86_400_000)
  if (days === 0) return `Today ${clock(d)}`
  if (days === 1) return `Yesterday ${clock(d)}`
  if (days > 1 && days < 7) return `${WEEKDAYS[d.getDay()]} ${clock(d)}`
  const year = d.getFullYear() === now.getFullYear() ? '' : `, ${d.getFullYear()}`
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${year}, ${clock(d)}`
}

/** The viewer's second header line: "Saturday 6:42 PM · in Weekend Hike" (groups and nebulas). */
export function photoSubtitle(iso: string, chatName: string | null, now?: Date): string {
  const when = photoWhen(iso, now)
  return chatName ? `${when} · in ${chatName}` : when
}

// ---- Zoom and pan. Scale 1 = the photo's own pixels; "fit" = as big as the screen allows (never above 1). ----

export const ZOOM_MAX = 8
export const ZOOM_STEP = 1.25

export type Size = { w: number; h: number }

/** The scale that shows the whole photo in the box (never enlarging a small photo). */
export function fitScale(photo: Size, box: Size): number {
  if (photo.w <= 0 || photo.h <= 0 || box.w <= 0 || box.h <= 0) return 1
  return Math.min(1, box.w / photo.w, box.h / photo.h)
}

/** One − or + press: a step down or up, snapping to fit (null) when it gets there. */
export function stepZoom(scale: number, fit: number, dir: 1 | -1): number | null {
  const next = dir > 0 ? Math.min(ZOOM_MAX, scale * ZOOM_STEP) : scale / ZOOM_STEP
  return next <= fit + 1e-6 ? null : next
}

/** Double-click / double-tap: fit ↔ 100% (or 2× fit when the photo is smaller than the screen). */
export function toggleZoom(scale: number | null, fit: number): number | null {
  if (scale !== null && scale > fit + 1e-6) return null
  return fit < 1 ? 1 : Math.min(ZOOM_MAX, fit * 2)
}

/** Keeps the photo covering the box while zoomed in (no panning it off screen). */
export function clampPan(pan: { x: number; y: number }, photo: Size, scale: number, box: Size): { x: number; y: number } {
  const maxX = Math.max(0, (photo.w * scale - box.w) / 2)
  const maxY = Math.max(0, (photo.h * scale - box.h) / 2)
  return { x: Math.max(-maxX, Math.min(maxX, pan.x)), y: Math.max(-maxY, Math.min(maxY, pan.y)) }
}

/**
 * Zooms from `from` to `to` keeping the point under the cursor still. `at` is that point measured
 * from the box's center; the pan is the photo center's offset from the box center.
 */
export function zoomAround(pan: { x: number; y: number }, from: number, to: number, at: { x: number; y: number }): { x: number; y: number } {
  const k = to / from
  return { x: at.x - (at.x - pan.x) * k, y: at.y - (at.y - pan.y) * k }
}

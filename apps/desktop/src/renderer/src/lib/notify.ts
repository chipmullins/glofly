// Windows notifications, decided here and shown by the main process.
//
// A notification only appears when Glofly isn't the window you're using, notifications are on
// (Settings → Notifications & sounds) and Do not disturb isn't silencing things. Its picture is
// the person's round photo (or initials), drawn here because Windows wants a PNG.

import type { NotificationSettings, PublicUser, ShowNotification } from '../../../preload/api-types'
import { colorsFor } from './avatarColors'
import { initials } from './names'
import { avatarUrl } from './media'
import { isSilenced } from './sounds'
import { inQuiet } from './quiet'
import { isWeb } from './platform'

let settings: NotificationSettings = { enabled: true, preview: true }

/** Called at startup and whenever Settings changes them. */
export function setNotificationSettings(next: NotificationSettings): void {
  settings = next
}

export const previewsOn = (): boolean => settings.preview

/** Worth a notification right now? (You're elsewhere, they're on, not Do not disturb.) */
export function shouldNotify(): boolean {
  return notificationsAllowed() && !document.hasFocus()
}

/** Notifications are on and nothing is silencing them (whether or not Glofly is in front). */
export function notificationsAllowed(): boolean {
  return settings.enabled && !isSilenced() && !inQuiet()
}

const FACE = 96

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    // So the photo can be drawn and read back. In a browser it comes from the Glofly server,
    // which only shares it with the session cookie (and only with chat.glofly.app).
    img.crossOrigin = isWeb ? 'use-credentials' : 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Someone's round photo, or their initials in their color, as a PNG. */
async function faceImage(person: PublicUser): Promise<string | null> {
  const canvas = document.createElement('canvas')
  canvas.width = FACE
  canvas.height = FACE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.beginPath()
  ctx.arc(FACE / 2, FACE / 2, FACE / 2, 0, Math.PI * 2)
  ctx.clip()
  const photo = person.avatarVersion
    ? await loadImage(avatarUrl(person.id, person.avatarVersion))
    : null
  if (photo) {
    ctx.drawImage(photo, 0, 0, FACE, FACE)
  } else {
    const [bg, fg] = colorsFor(person.id)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, FACE, FACE)
    ctx.fillStyle = fg
    ctx.font = `600 ${Math.round(FACE * 0.38)}px Outfit, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(person.displayName), FACE / 2, FACE / 2 + 2)
  }
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null // a photo that can't be read back: fall back to the Glofly icon
  }
}

/** A photo (a message's photo, a game picture, a header image) made small enough for a toast. */
async function pictureData(src: string, maxWidth: number): Promise<string | null> {
  const img = await loadImage(src)
  if (!img || !img.naturalWidth) return null
  const scale = Math.min(1, maxWidth / img.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  try {
    const data = canvas.toDataURL('image/jpeg', 0.82)
    return data.length <= 1_400_000 ? data : null
  } catch {
    return null
  }
}

/**
 * Shows a notification with this person's face as its picture. 0.9.3: on Windows it's Glofly's own
 * notification (`rich`: round photo, where it came from, buttons, a picture). `pictureUrl` is a
 * photo to show in it (only when previews are on).
 */
export async function notify(
  n: Omit<ShowNotification, 'icon'>,
  person: PublicUser | null,
  pictureUrl?: string | null
): Promise<void> {
  const icon = person ? await faceImage(person) : null
  const rich = n.rich ?? { kind: 'other' as const, attribution: 'Glofly' }
  const picture =
    pictureUrl && previewsOn() ? await pictureData(pictureUrl, rich.hero ? 728 : 560) : null
  window.glofly.notifications.show({ ...n, icon, rich: { ...rich, ...(picture ? { picture } : {}) } })
}

/** "Maya" from "Maya Reyes" (notification buttons and reply boxes). */
export const firstNameOf = (p: Pick<PublicUser, 'displayName' | 'username'>): string =>
  p.displayName.trim().split(/\s+/)[0] || p.username

/** The three buttons every message notification gets (Nov 8: both mute choices). */
export const MESSAGE_BUTTONS = [
  { id: 'read', label: 'Mark as read' },
  { id: 'mute-1h', label: 'Mute 1 h' },
  { id: 'mute-tomorrow', label: 'Mute until tomorrow' }
] as const

export function clearNotification(key: string): void {
  window.glofly.notifications.clear(key)
}

/** The red badge with the unread count, for the taskbar icon. */
export function badgeImage(count: number): string | null {
  const size = 32
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#C4410C' // the design's unread badge
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#FFFFFF'
  const text = count > 99 ? '99+' : String(count)
  ctx.font = `700 ${text.length > 2 ? 12 : text.length > 1 ? 16 : 20}px "DM Sans Variable", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, size / 2, size / 2 + 1)
  return canvas.toDataURL('image/png')
}

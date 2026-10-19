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
  return settings.enabled && !isSilenced() && !inQuiet() && !document.hasFocus()
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

/** Shows a notification with this person's face as its picture. */
export async function notify(
  n: Omit<ShowNotification, 'icon'>,
  person: PublicUser | null
): Promise<void> {
  const icon = person ? await faceImage(person) : null
  window.glofly.notifications.show({ ...n, icon })
}

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

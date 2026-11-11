// Campfire (Nov 2026): the tabletop's live events. Pure (no Electron), so the web bridge
// (apps/web/src/bridge/realtime.ts) uses the same list and checks.
//
// The server filters every event per person before sending it (fog, GM-only things), so these
// checks are only about shape: a known event name, an object of a sane size, the campaign id and
// the person's own sequence number (a gap makes the table load itself again).

export const CAMPFIRE_EVENT_NAMES = [
  'campfire:opened',
  'campfire:closed',
  'campfire:state',
  'campfire:token',
  'campfire:scene',
  'campfire:fog',
  'campfire:roll',
  'campfire:pending',
  'campfire:hit',
  'campfire:combat',
  'campfire:character',
  'campfire:handout',
  'campfire:music',
  'campfire:ping',
  'campfire:presence',
  'campfire:members',
  // Round A: the campaign hub changed
  'campfire:hub'
] as const

export type CampfireEventName = (typeof CAMPFIRE_EVENT_NAMES)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The biggest event passed on (a scene with its built map and 500 tokens fits easily). */
const MAX_EVENT_CHARS = 3_000_000

export type CampfireWireEvent = {
  type: 'campfire'
  name: CampfireEventName
  data: Record<string, unknown> & { campaignId: string; seq: number }
}

export function cleanCampfireEvent(name: string, payload: unknown): CampfireWireEvent | null {
  if (!(CAMPFIRE_EVENT_NAMES as readonly string[]).includes(name)) return null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const p = payload as Record<string, unknown>
  if (typeof p.campaignId !== 'string' || !UUID.test(p.campaignId)) return null
  if (typeof p.seq !== 'number' || !Number.isInteger(p.seq) || p.seq < 0) return null
  let data: Record<string, unknown>
  try {
    const json = JSON.stringify(p)
    if (json.length > MAX_EVENT_CHARS) return null
    // A plain copy: only JSON values reach the window.
    data = JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
  return {
    type: 'campfire',
    name: name as CampfireEventName,
    data: data as CampfireWireEvent['data']
  }
}

/** A Campfire request the window may make: /campfire/… with plain characters, a JSON body. */
export function isCampfirePath(method: unknown, path: unknown, body: unknown): boolean {
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method as string)) return false
  if (typeof path !== 'string' || path.length > 400) return false
  if (!/^\/campfire(\/[A-Za-z0-9_-]+)+\/?(\?[A-Za-z0-9=&%._+,:-]*)?$/.test(path)) return false
  // Files are never fetched as JSON (they load through the media address).
  if (method === 'GET' && /^\/campfire\/files\//.test(path)) return false
  if (body === undefined || body === null) return true
  try {
    // Built maps and sheets are bigger than chat requests (the server takes up to 512 KB).
    return typeof body === 'object' && JSON.stringify(body).length <= 520_000
  } catch {
    return false
  }
}

export type CampfireUploadKind = 'map' | 'token' | 'portrait' | 'handout' | 'audio'
const MB = 1024 * 1024
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave'
]

/** Kinds, their size limits and file types (the server checks again, by the file's first bytes). */
export const CAMPFIRE_UPLOADS: Record<
  CampfireUploadKind,
  { maxBytes: number; types: string[]; label: string }
> = {
  map: { maxBytes: 25 * MB, types: IMAGE_TYPES, label: 'Map pictures can be up to 25 MB.' },
  token: { maxBytes: 8 * MB, types: IMAGE_TYPES, label: 'Token pictures can be up to 8 MB.' },
  portrait: { maxBytes: 8 * MB, types: IMAGE_TYPES, label: 'Portraits can be up to 8 MB.' },
  handout: { maxBytes: 8 * MB, types: IMAGE_TYPES, label: 'Handout pictures can be up to 8 MB.' },
  audio: { maxBytes: 20 * MB, types: AUDIO_TYPES, label: 'Music files can be up to 20 MB.' }
}

/** Null when the upload may go; otherwise what's wrong with it. */
export function campfireUploadProblem(
  campaignId: unknown,
  kind: unknown,
  size: number,
  type: unknown
): string | null {
  if (typeof campaignId !== 'string' || !UUID.test(campaignId))
    return 'Something about that request was off.'
  if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(CAMPFIRE_UPLOADS, kind))
    return 'Something about that request was off.'
  const rule = CAMPFIRE_UPLOADS[kind as CampfireUploadKind]
  if (typeof type !== 'string' || !rule.types.includes(type.toLowerCase()))
    return kind === 'audio'
      ? 'Music can be MP3, Ogg, M4A or WAV.'
      : 'Pictures can be PNG, JPEG, WebP or GIF.'
  if (size <= 0) return 'That file is empty.'
  if (size > rule.maxBytes) return rule.label
  return null
}

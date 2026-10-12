import { API_URL, getSessionToken } from './auth'
import { isUserId } from './api'

// Photos are only given to signed-in people, so the window can't load them straight
// from the server (it never sees the session token). Instead it asks for
//   glofly-media://avatars/<userId>/<version>                       profile photos
//   glofly-media://groups/<conversationId>/<version>                group photos (0.2.1)
//   glofly-media://attachments/<conversationId>/<id>/<preview|full> photos in chats
//   glofly-media://attachments/<conversationId>/<id>/voice          voice messages (0.2.1)
// and this fetches them with the token, here in the main process. Only these shapes are
// allowed, and only WebP images (re-saved by the server) or voice audio (Opus in WebM/Ogg, AAC in MP4; checked
// by its first bytes) are passed back.

export const MEDIA_SCHEME = 'glofly-media'

const MB = 1024 * 1024
const CACHE_LIMIT_BYTES = 150 * MB

// A photo's address never shows anything else, so a saved copy never goes stale.
// Kept in memory only, and dropped when a different account signs in.
const cache = new Map<string, Uint8Array>()
let cacheBytes = 0
let cacheOwner: string | null = null

function remember(key: string, bytes: Uint8Array): void {
  cache.set(key, bytes)
  cacheBytes += bytes.byteLength
  // Drop the oldest until it fits.
  for (const [oldKey, old] of cache) {
    if (cacheBytes <= CACHE_LIMIT_BYTES) break
    cache.delete(oldKey)
    cacheBytes -= old.byteLength
  }
}

const empty = (status: number): Response => new Response(null, { status })

/** The server address for a glofly-media address, or null if it isn't one we allow. */
function serverPathFor(url: URL): { path: string; maxBytes: number; audio?: boolean } | null {
  const parts = url.pathname.split('/').slice(1)
  if (url.host === 'avatars' && parts.length === 2 && parts.every(isUserId)) {
    return { path: `/avatars/${parts[0]}/${parts[1]}`, maxBytes: 2 * MB }
  }
  if (url.host === 'groups' && parts.length === 2 && parts.every(isUserId)) {
    return { path: `/conversations/${parts[0]}/photo/${parts[1]}`, maxBytes: 2 * MB }
  }
  if (
    url.host === 'attachments' &&
    parts.length === 3 &&
    isUserId(parts[0]) &&
    isUserId(parts[1]) &&
    (parts[2] === 'preview' || parts[2] === 'full')
  ) {
    return {
      path: `/conversations/${parts[0]}/attachments/${parts[1]}/${parts[2]}`,
      maxBytes: 30 * MB
    }
  }
  // A voice message is stored as a file (only ever a download for anything else).
  if (
    url.host === 'attachments' &&
    parts.length === 3 &&
    isUserId(parts[0]) &&
    isUserId(parts[1]) &&
    parts[2] === 'voice'
  ) {
    return {
      path: `/conversations/${parts[0]}/attachments/${parts[1]}/file`,
      maxBytes: 6 * MB,
      audio: true
    }
  }
  return null
}

export async function handleMediaRequest(req: Request): Promise<Response> {
  if (req.method !== 'GET') return empty(404)
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return empty(404)
  }
  const target = serverPathFor(url)
  if (!target || url.search || url.username || url.password || url.port) return empty(404)

  const token = getSessionToken()
  if (!token) return empty(401)
  if (cacheOwner !== token) {
    cache.clear()
    cacheBytes = 0
    cacheOwner = token
  }

  let bytes = cache.get(target.path)
  if (!bytes) {
    let response: Response
    try {
      response = await fetch(`${API_URL}${target.path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000)
      })
    } catch {
      return empty(502)
    }
    const expected = target.audio ? 'application/octet-stream' : 'image/webp'
    if (!response.ok || response.headers.get('content-type') !== expected) {
      return empty(response.ok ? 502 : response.status)
    }
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > target.maxBytes) return empty(502)
    if (target.audio && !audioType(data)) return empty(502)
    bytes = data
    remember(target.path, bytes)
  }

  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': target.audio
        ? (audioType(bytes) ?? 'application/octet-stream')
        : 'image/webp',
      'X-Content-Type-Options': 'nosniff',
      // Lets the Glofly page draw photos onto a canvas (notification pictures). Only Glofly's
      // own page can load glofly-media:// at all (the window never shows any other page).
      'Access-Control-Allow-Origin': '*'
    }
  })
}

/**
 * A voice message's audio type by its first bytes: Opus in WebM (desktop) or Ogg (Android), or
 * AAC in MP4 (iPhone; Electron's Chromium plays AAC).
 */
function audioType(data: Uint8Array): 'audio/webm' | 'audio/ogg' | 'audio/mp4' | null {
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3)
    return 'audio/webm'
  if (data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53)
    return 'audio/ogg'
  if (
    data.length >= 12 &&
    data[4] === 0x66 &&
    data[5] === 0x74 &&
    data[6] === 0x79 &&
    data[7] === 0x70
  )
    return 'audio/mp4'
  return null
}

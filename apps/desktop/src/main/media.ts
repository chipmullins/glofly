import { API_URL, getSessionToken } from './auth'
import { isUserId } from './api'

// Photos are only given to signed-in people, so the window can't load them straight
// from the server (it never sees the session token). Instead it asks for
//   glofly-media://avatars/<userId>/<version>                       profile photos
//   glofly-media://attachments/<conversationId>/<id>/<preview|full> photos in chats
// and this fetches them with the token, here in the main process. Only these two shapes
// are allowed, and only WebP images (re-saved by the server) are passed back.

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
function serverPathFor(url: URL): { path: string; maxBytes: number } | null {
  const parts = url.pathname.split('/').slice(1)
  if (url.host === 'avatars' && parts.length === 2 && parts.every(isUserId)) {
    return { path: `/avatars/${parts[0]}/${parts[1]}`, maxBytes: 2 * MB }
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
    if (!response.ok || response.headers.get('content-type') !== 'image/webp') {
      return empty(response.ok ? 502 : response.status)
    }
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > target.maxBytes) return empty(502)
    bytes = data
    remember(target.path, bytes)
  }

  return new Response(bytes as BodyInit, {
    headers: { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff' }
  })
}

import { API_URL, getSessionToken } from './auth'
import { isUserId } from './api'

// Profile photos are only given to signed-in people, so the window can't load them
// straight from the server (it never sees the session token). Instead it asks for
// glofly-media://avatars/<userId>/<version>, and this fetches the photo with the
// token, here in the main process.

export const MEDIA_SCHEME = 'glofly-media'

const MAX_PHOTO_BYTES = 2 * 1024 * 1024 // stored photos are ~30 KB; anything huge is wrong
const CACHE_LIMIT = 300

// A photo's address changes whenever it's replaced, so a saved copy never goes stale.
// Kept in memory only, and dropped when a different account signs in.
const cache = new Map<string, Uint8Array>()
let cacheOwner: string | null = null

const notFound = (): Response => new Response(null, { status: 404 })

export async function handleMediaRequest(req: Request): Promise<Response> {
  if (req.method !== 'GET') return notFound()
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return notFound()
  }
  const [, userId, version, ...rest] = url.pathname.split('/')
  if (url.host !== 'avatars' || rest.length || !isUserId(userId) || !isUserId(version)) {
    return notFound()
  }

  const token = getSessionToken()
  if (!token) return new Response(null, { status: 401 })
  if (cacheOwner !== token) {
    cache.clear()
    cacheOwner = token
  }

  const key = `${userId}/${version}`
  let bytes = cache.get(key)
  if (!bytes) {
    let response: Response
    try {
      response = await fetch(`${API_URL}/avatars/${key}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      return new Response(null, { status: 502 })
    }
    if (!response.ok || response.headers.get('content-type') !== 'image/webp') {
      return new Response(null, { status: response.ok ? 502 : response.status })
    }
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength > MAX_PHOTO_BYTES) return new Response(null, { status: 502 })
    bytes = data
    cache.set(key, bytes)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  }

  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'image/webp',
      'X-Content-Type-Options': 'nosniff'
    }
  })
}

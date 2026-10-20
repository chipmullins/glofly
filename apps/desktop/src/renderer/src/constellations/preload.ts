import type { ConstellationDetail } from '../../../preload/api-types'
import { api } from '../lib/constellations'
import { prefetchAllowed, prefetchMessages } from '../lib/messagePrefetch'
import { lastPlaceIn } from './phase'

// 0.7.5 instant fly-in (canvas board 5, approved): the constellation you were last in, its nebula
// list and the newest messages of the nebula you'll land in are loaded quietly while you're home,
// so the approved swipe lands on a finished screen. Others load when you hover their icon. Light
// on purpose: only after Glofly has been idle a moment, skipped on slow or metered connections.

/** The last look at each constellation (flying back in shows it straight away). */
export const detailCache = new Map<string, ConstellationDetail>()
const loadedAt = new Map<string, number>()
const FRESH_MS = 60_000

/** Loads a constellation (and its landing nebula's messages) ahead of time. */
export async function preloadConstellation(
  constellationId: string,
  nebulaId: string | null = null
): Promise<void> {
  if (!prefetchAllowed()) return
  let detail = detailCache.get(constellationId)
  if (!detail || Date.now() - (loadedAt.get(constellationId) ?? 0) > FRESH_MS) {
    const r = await api.get(constellationId)
    if (!r.ok) return
    detail = r.data.constellation
    detailCache.set(detail.id, detail)
    loadedAt.set(detail.id, Date.now())
  }
  const land =
    detail.nebulas.find((n) => n.id === nebulaId) ?? detail.nebulas.find((n) => n.kind === 'text')
  if (land && land.kind === 'text') await prefetchMessages(land.conversationId)
}

/** Marks a copy as fresh (the screen loaded it itself). */
export function rememberDetail(detail: ConstellationDetail): void {
  detailCache.set(detail.id, detail)
  loadedAt.set(detail.id, Date.now())
}

/** While you're home: the place the Constellations button will take you, once things are idle. */
export function preloadLastPlace(userId: string, constellationIds: string[]): () => void {
  let cancelled = false
  const run = (): void => {
    if (cancelled) return
    const place = lastPlaceIn(userId, constellationIds)
    if (place) void preloadConstellation(place.constellationId, place.nebulaId)
  }
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
    cancelIdleCallback?: (id: number) => void
  }
  let idle = 0
  const timer = setTimeout(() => {
    if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout: 4000 })
    else run()
  }, 2500)
  return () => {
    cancelled = true
    clearTimeout(timer)
    if (idle && w.cancelIdleCallback) w.cancelIdleCallback(idle)
  }
}

import type { Href } from 'expo-router'
import { prefs } from '@/lib/storage'
import { useSession } from '@/state/session'
import { useCx } from '@/state/constellations'

// 0.7.1 (Chip): getting to a nebula from Glofly home took too many taps (Constellations, wait for
// the animation, the constellation, then the nebula). Now:
//   - the Constellations tab flies straight back to the nebula you had open last (a quick hop,
//     once you're in at least one constellation; the dashboard and the full swipe otherwise);
//   - nebulas with news for you show in the Chats list, and a tap flies right into that nebula.
// The Constellations icon inside (the strip's galaxy, the Home dashboard) still gets you to the
// dashboard.

type Place = { constellationId: string; nebulaId: string | null }
let last: (Place & { userId: string }) | null = null
let loadedFor: string | null = null

/** The constellation (and nebula) on screen: remembered for the tab (and for next time). */
export function rememberCxPlace(constellationId: string, nebulaId: string | null) {
  const userId = useSession.getState().user?.id
  if (!userId) return
  if (last && last.userId === userId && last.constellationId === constellationId && (nebulaId === null || last.nebulaId === nebulaId)) return
  last = { userId, constellationId, nebulaId: nebulaId ?? (last?.constellationId === constellationId ? last.nebulaId : null) }
  void prefs.set('cxLastPlace', last)
}

/** Reads what was remembered last time Glofly ran (once per account). */
export async function loadCxPlace(): Promise<void> {
  const userId = useSession.getState().user?.id
  if (!userId || loadedFor === userId) return
  loadedFor = userId
  if (last?.userId === userId) return
  const saved = await prefs.get<(Place & { userId: string }) | null>('cxLastPlace', null)
  if (saved && saved.userId === userId && typeof saved.constellationId === 'string') {
    last = { userId, constellationId: saved.constellationId, nebulaId: typeof saved.nebulaId === 'string' ? saved.nebulaId : null }
  }
}

/** Screens to push for a place: phones stack constellation → nebula; iPad opens it in one. */
export function placePaths(place: Place, wide: boolean): Href[] {
  if (wide) return [{ pathname: '/constellations/[cid]', params: place.nebulaId ? { cid: place.constellationId, nebula: place.nebulaId } : { cid: place.constellationId } }] as Href[]
  const list: Href[] = ['/constellations', `/constellations/${place.constellationId}` as Href]
  if (place.nebulaId) list.push(`/constellations/${place.constellationId}/nebula/${place.nebulaId}` as Href)
  return list
}

/** Where the tab should land: your last place if you're still in that constellation, else null. */
export function lastCxPlace(): Place | null {
  const userId = useSession.getState().user?.id
  if (!last || last.userId !== userId) return null
  const cards = useCx.getState().cards
  if (!cards.some((c) => c.id === last!.constellationId)) return null
  return { constellationId: last.constellationId, nebulaId: last.nebulaId }
}

/** You're in at least one constellation: going there and back is a quick hop. */
export const quickHop = (): boolean => useCx.getState().cards.length > 0

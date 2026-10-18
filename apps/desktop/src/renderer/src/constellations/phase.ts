import { useCallback, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './skyData'

// The Constellations transition's state (Transition.dc.html, approved; timings from the mockup's
// Component: sweep → space at 1050 ms, return → home at 2100 ms). Kept in the main screen,
// because it moves the normal screen too.

/** The nebula chat on screen in Constellations right now (no ding or notification for it). */
export const viewingNebula: { conversationId: string | null } = { conversationId: null }

export type CxPhase = 'home' | 'sweep' | 'space' | 'return'
export type CxPlace = { constellationId: string; nebulaId: string | null } | null

const SWEEP_MS = 1050
const RETURN_MS = 2100
// 0.7.1 (Chip): once you're in a constellation, going back and forth is a quick hop.
const QUICK_SWEEP_MS = 420
const QUICK_RETURN_MS = 620

// ---- Where you were (0.7.1): the Constellations button takes you back there ----

const LAST_KEY = 'glofly.cxLastPlace'
type LastPlace = { userId: string; place: NonNullable<CxPlace> }
let lastPlace: LastPlace | null = null

/** The constellation (and nebula) open on the night side right now: remembered for next time. */
export function rememberPlace(userId: string, place: CxPlace): void {
  if (!place) return
  lastPlace = {
    userId,
    place: { constellationId: place.constellationId, nebulaId: place.nebulaId }
  }
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(lastPlace))
  } catch {
    // storage off: remembered until Glofly closes
  }
}

/** Where you were last, if it's one of these constellations (you might have left it since). */
export function lastPlaceIn(userId: string, constellationIds: string[]): CxPlace {
  if (!lastPlace) {
    try {
      const raw = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null') as LastPlace | null
      if (
        raw &&
        typeof raw.userId === 'string' &&
        raw.place &&
        typeof raw.place.constellationId === 'string'
      ) {
        lastPlace = {
          userId: raw.userId,
          place: {
            constellationId: raw.place.constellationId,
            nebulaId: typeof raw.place.nebulaId === 'string' ? raw.place.nebulaId : null
          }
        }
      }
    } catch {
      // nothing remembered
    }
  }
  const last = lastPlace as LastPlace | null
  if (!last || last.userId !== userId) return null
  return constellationIds.includes(last.place.constellationId) ? { ...last.place } : null
}

/**
 * The transition's state, kept in the main screen (it moves the normal screen too). `quick`:
 * you're in at least one constellation, so going there and back is a quick hop (0.7.1); the
 * full starry swipe and firefly swarm play while you aren't in any yet.
 */
export function useConstellationsPhase(quickAllowed = false): {
  phase: CxPhase
  origin: { x: number; y: number }
  /** Where to land (a constellation, or null for the dashboard) */
  start: CxPlace
  enter: (from: HTMLElement | null, place?: CxPlace) => void
  leave: () => void
  /** The normal screen's extra class while the night is up */
  homeClass: string
  /** This trip is a quick hop */
  quick: boolean
} {
  const [phase, setPhase] = useState<CxPhase>('home')
  const [origin, setOrigin] = useState({ x: 150, y: 250 })
  const [start, setStart] = useState<CxPlace>(null)
  const [quick, setQuick] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phaseRef = useRef<CxPhase>('home')
  const quickRef = useRef(quickAllowed)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    quickRef.current = quickAllowed
  }, [quickAllowed])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const enter = useCallback((from: HTMLElement | null, place: CxPlace = null) => {
    // Already up there (say, a nebula's notification was clicked): just fly to the place.
    if (phaseRef.current === 'space' || phaseRef.current === 'sweep') {
      setStart(place ? { ...place } : null)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setStart(place)
    // 0.7.1: turned around on the way home: straight back up, without starting the swipe over
    // (that flashed the normal screen between the two animations).
    if (phaseRef.current === 'return') {
      setPhase('space')
      return
    }
    const r = from?.getBoundingClientRect()
    if (r) setOrigin({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
    const q = quickRef.current
    setQuick(q)
    if (prefersReducedMotion()) {
      setPhase('space')
      return
    }
    setPhase('sweep')
    timer.current = setTimeout(() => setPhase('space'), q ? QUICK_SWEEP_MS : SWEEP_MS)
  }, [])

  const leave = useCallback(() => {
    if (phaseRef.current === 'home' || phaseRef.current === 'return') return
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const q = quickRef.current
    setQuick(q)
    if (prefersReducedMotion()) {
      setPhase('home')
      return
    }
    setPhase('return')
    timer.current = setTimeout(() => setPhase('home'), q ? QUICK_RETURN_MS : RETURN_MS)
  }, [])

  const homeClass =
    phase === 'sweep'
      ? 'cx-home-out'
      : phase === 'space'
        ? 'cx-home-gone'
        : phase === 'return'
          ? 'cx-home-in'
          : ''
  return {
    phase,
    origin,
    start,
    enter,
    leave,
    homeClass: quick && homeClass ? `${homeClass} cx-quick` : homeClass,
    quick
  }
}

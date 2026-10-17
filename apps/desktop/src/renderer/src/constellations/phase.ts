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

/** The transition's state, kept in the main screen (it moves the normal screen too). */
export function useConstellationsPhase(): {
  phase: CxPhase
  origin: { x: number; y: number }
  /** Where to land (a constellation, or null for the dashboard) */
  start: CxPlace
  enter: (from: HTMLElement | null, place?: CxPlace) => void
  leave: () => void
  /** The normal screen's extra class while the night is up */
  homeClass: string
} {
  const [phase, setPhase] = useState<CxPhase>('home')
  const [origin, setOrigin] = useState({ x: 150, y: 250 })
  const [start, setStart] = useState<CxPlace>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const phaseRef = useRef<CxPhase>('home')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
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
    const r = from?.getBoundingClientRect()
    if (r) setOrigin({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
    if (prefersReducedMotion()) {
      setPhase('space')
      return
    }
    setPhase('sweep')
    timer.current = setTimeout(() => setPhase('space'), SWEEP_MS)
  }, [])

  const leave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (prefersReducedMotion()) {
      setPhase('home')
      return
    }
    setPhase('return')
    timer.current = setTimeout(() => setPhase('home'), RETURN_MS)
  }, [])

  const homeClass =
    phase === 'sweep'
      ? 'cx-home-out'
      : phase === 'space'
        ? 'cx-home-gone'
        : phase === 'return'
          ? 'cx-home-in'
          : ''
  return { phase, origin, start, enter, leave, homeClass }
}

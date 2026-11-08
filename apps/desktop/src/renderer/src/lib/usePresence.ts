import { useEffect, useState } from 'react'

/**
 * 0.9.1 polish: keeps something on screen for its closing animation after `open` turns false.
 * `shown`: render it; `leaving`: it's on its way out (give it the closing class, e.g. .glo-side-out).
 */
export function usePresence(open: boolean, ms = 200): { shown: boolean; leaving: boolean } {
  const [lingering, setLingering] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  // Closing: stay for `ms` (set while rendering, so there's no frame where it's gone).
  if (wasOpen !== open) {
    setWasOpen(open)
    setLingering(!open)
  }
  useEffect(() => {
    if (!lingering) return
    const t = window.setTimeout(() => setLingering(false), ms)
    return () => window.clearTimeout(t)
  }, [lingering, ms])
  return { shown: open || lingering, leaving: !open && lingering }
}

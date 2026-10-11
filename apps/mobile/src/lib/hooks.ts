import { useEffect, useState } from 'react'

/** The current time, updated every `ms` (for timers and "typing…" that runs out). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

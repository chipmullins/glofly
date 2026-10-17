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

/**
 * For the Chats and Groups lists: ticks every 4 seconds only while someone's "typing…" can still
 * run out, otherwise once a minute (mutes ending). It used to redraw every row every 4 seconds.
 */
export function useListNow(typing: Record<string, Record<string, number>>): number {
  const t = Date.now()
  const live = Object.values(typing).some((forChat) => Object.values(forChat).some((until) => until > t))
  return useNow(live ? 4000 : 60_000)
}

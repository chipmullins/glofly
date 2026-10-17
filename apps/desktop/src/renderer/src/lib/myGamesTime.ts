/** "today", "yesterday", "Monday", "Oct 3" (when a game was last played). */
export function relativeDay(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const startOf = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(new Date(now)) - startOf(d)) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: days > 300 ? 'numeric' : undefined
  })
}

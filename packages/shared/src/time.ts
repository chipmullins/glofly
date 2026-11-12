const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/** "10:02 PM" */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** "Today", "Yesterday", or "Monday, October 5" (with the year if it isn't this year). */
export function dayLabel(iso: string, now = new Date()): string {
  const date = new Date(iso)
  if (sameDay(date, now)) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(date, yesterday)) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
  })
}

export function isSameDay(a: string, b: string): boolean {
  return sameDay(new Date(a), new Date(b))
}

/** Messages from the same person within 5 minutes are shown together under one name. */
export function continuesGroup(
  previous: { senderId: string; createdAt: string; bridged?: { name: string } | null } | undefined,
  next: { senderId: string; createdAt: string; bridged?: { name: string } | null }
): boolean {
  if (!previous || previous.senderId !== next.senderId) return false
  // Communities round 2: Discord people all arrive through one bridge bot: group by their name.
  if ((previous.bridged?.name ?? null) !== (next.bridged?.name ?? null)) return false
  if (!isSameDay(previous.createdAt, next.createdAt)) return false
  return new Date(next.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000
}

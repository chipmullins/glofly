// "Jump to latest": how many messages from other people arrived below where you are (pure, so it
// can be tested on its own).

/**
 * Messages from others newer than `anchorId` (the newest message when you scrolled up), in a
 * newest-first list. Your own messages and chat events ("Maya renamed the group") don't count.
 * An anchor that's no longer in the list (deleted, or the list reloaded) counts nothing.
 */
export function newSince(
  newestFirst: readonly { id: string; senderId: string; event?: unknown }[],
  anchorId: string | null,
  meId: string,
): number {
  if (!anchorId) return 0
  let count = 0
  for (const m of newestFirst) {
    if (m.id === anchorId) return count
    if (m.senderId !== meId && !m.event) count++
  }
  return 0
}

/** "3 new", "99+ new" */
export const newLabel = (count: number): string => (count > 99 ? '99+ new' : `${count} new`)

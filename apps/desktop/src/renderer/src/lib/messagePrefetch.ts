import type { MessagePage } from '../../../preload/api-types'

// 0.7.5 instant fly-in (canvas board 5, approved): the newest messages of the nebula you'll most
// likely land in, fetched quietly ahead of time so the chat opens finished (no loading, no jump).
// Kept for two minutes; the chat still fetches a fresh page as it opens.

const KEEP_MS = 2 * 60_000
const pages = new Map<string, { at: number; page: MessagePage }>()
const inFlight = new Set<string>()

/** Fetches a chat's newest messages ahead of time (once; quiet on failure). */
export async function prefetchMessages(conversationId: string): Promise<void> {
  const have = pages.get(conversationId)
  if ((have && Date.now() - have.at < KEEP_MS / 2) || inFlight.has(conversationId)) return
  inFlight.add(conversationId)
  try {
    const r = await window.glofly.conversations.messages(conversationId)
    if (r.ok) pages.set(conversationId, { at: Date.now(), page: r.data })
  } catch {
    // Not important: the chat loads them itself.
  } finally {
    inFlight.delete(conversationId)
  }
}

/** The messages fetched ahead for this chat, if they're fresh enough. */
export function prefetchedMessages(conversationId: string): MessagePage | null {
  const have = pages.get(conversationId)
  if (!have) return null
  if (Date.now() - have.at > KEEP_MS) {
    pages.delete(conversationId)
    return null
  }
  return have.page
}

/** Light on purpose: nothing ahead of time on a slow or metered connection. */
export function prefetchAllowed(): boolean {
  const c = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection
  if (!c) return true
  return !c.saveData && c.effectiveType !== 'slow-2g' && c.effectiveType !== '2g'
}

import { GLIDE_MS } from './listGlide'

// 0.9.3 "Hop" (the approved "Glofly Dock Hop" canvas): when someone messages you, their face
// hops where you can see it, like an app in the Mac Dock (once, never nagging).
// - Pinned chats and the dock (data-hop-kind="full"): two hops, landing with a little squash.
// - Every other chat in the list ("soft"): one small hop once the row has glided to the top.
// MainScreen decides whether a message hops (not yours, not the chat you're looking at, not a
// muted chat, not Do not disturb or quiet hours, and the setting is on); this file does the rest.
// Any element with data-hop="<conversation id>" hops; Reduce Motion: it glows once instead (CSS).
// Settings → Appearance → "Hop when someone messages you" (kept on this device).

const KEY = 'glofly.hops'
/** One hop per face at most this often: a burst of messages is one hop. */
const EVERY_MS = 4000
/** Messages arriving this close together: only the newest chat hops. */
const BURST_MS = 150
const FULL_MS = 950
const SOFT_MS = 520

export function hopsOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setHopsOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // storage off: just for now
  }
}

const last = new Map<string, number>()
let pending: string | null = null
let timer: number | null = null

/** A message for this chat should make its face hop (the checks are the caller's). */
export function queueHop(conversationId: string): void {
  if (!hopsOn()) return
  pending = conversationId
  if (timer !== null) window.clearTimeout(timer)
  // Wait for the burst to end and for the list to glide the row to the top.
  timer = window.setTimeout(() => {
    timer = null
    const id = pending
    pending = null
    if (id) hop(id)
  }, BURST_MS + GLIDE_MS)
}

function hop(id: string): void {
  const now = Date.now()
  if (now - (last.get(id) ?? 0) < EVERY_MS) return
  last.set(id, now)
  for (const el of document.querySelectorAll<HTMLElement>(`[data-hop="${CSS.escape(id)}"]`)) {
    const soft = el.dataset.hopKind === 'soft'
    const cls = soft ? 'glo-hop--soft' : 'glo-hop'
    el.classList.remove('glo-hop', 'glo-hop--soft')
    void el.offsetWidth // restart the animation if it was still running
    el.classList.add(cls)
    window.setTimeout(() => el.classList.remove(cls), (soft ? SOFT_MS : FULL_MS) + 50)
  }
}

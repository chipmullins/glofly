import { useEffect, useState } from 'react'
import { friendLinkUrl } from '@glofly/shared/friendLinks'
import type { MyFriendLink } from '../../../preload/api-types'

// 0.8.0 shareable friend invite links: your link, fetched once and shared by every place that
// shows it (Add friend, Settings → Friends, the welcome flow, the empty Friends screen), so a
// reset in one shows everywhere at once.

type State = { link: MyFriendLink | null; problem: string | null; loading: boolean }

let state: State = { link: null, problem: null, loading: false }
let loadedFor: string | null = null
const listeners = new Set<(s: State) => void>()

function set(next: Partial<State>): void {
  state = { ...state, ...next }
  for (const l of listeners) l(state)
}

// Someone joined or added you with your link: the joined count changed. Listened to once, for as
// long as the app runs (whether or not anything showing the link is open right now).
let watching = false
function watchJoins(): void {
  if (watching) return
  watching = true
  window.glofly.onEvent((event) => {
    if ((event.type === 'friend:joined' || event.type === 'friend:linked') && loadedFor)
      void loadFriendLink(loadedFor, true)
  })
}

/** Fetches your link (again with `force`: after a friend joined, the count changed). */
export async function loadFriendLink(userId: string, force = false): Promise<void> {
  watchJoins()
  if (state.loading || (!force && loadedFor === userId && state.link)) return
  if (loadedFor !== userId) set({ link: null, problem: null })
  loadedFor = userId
  set({ loading: true })
  const r = await window.glofly.friends.myLink()
  if (r.ok) set({ link: r.data, problem: null, loading: false })
  else set({ problem: r.message, loading: false })
}

/** A new link; the old one stops working right away. Null if it worked, else what went wrong. */
export async function resetFriendLink(): Promise<string | null> {
  const r = await window.glofly.friends.resetLink()
  if (r.ok) {
    set({ link: r.data, problem: null })
    return null
  }
  return r.message
}

/** Your link (loads it the first time). */
export function useFriendLink(userId: string, enabled = true): State {
  const [s, setS] = useState(state)
  useEffect(() => {
    listeners.add(setS)
    if (enabled) void loadFriendLink(userId)
    return () => {
      listeners.delete(setS)
    }
  }, [userId, enabled])
  return s
}

/** Copies the full link (https://glofly.app/i/<code>). True if it worked. */
export async function copyFriendLink(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(friendLinkUrl(code))
    return true
  } catch {
    return false
  }
}

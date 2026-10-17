// 0.5.0: glows, who's free to hang, birthdays today and who's live, kept fresh for every screen.
// Fetched from GET /social when the app starts, whenever the server says it changed
// (social:changed), when the window comes back to the front, and every few minutes (so a new day
// or a hang running out shows without a message).
import { useEffect, useSyncExternalStore } from 'react'
import { EMPTY_SOCIAL, type SocialToday } from '@glofly/shared/social'

let state: SocialToday = EMPTY_SOCIAL
const listeners = new Set<() => void>()
let asking: Promise<void> | null = null

function set(next: SocialToday): void {
  state = next
  for (const l of listeners) l()
}

/** Fetches the latest (one request at a time; a second ask waits for the first). */
export function refreshSocial(): Promise<void> {
  asking ??= window.glofly.social
    .get()
    .then((r) => {
      if (r.ok) set(r.data)
    })
    .catch(() => undefined)
    .finally(() => {
      asking = null
    })
  return asking
}

/** Changes made here show right away (the server's copy follows). */
export function patchSocial(change: Partial<SocialToday>): void {
  set({ ...state, ...change })
}

export function useSocial(): SocialToday {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state
  )
}

/** Mounted once (MainScreen): keeps the social state fresh. */
export function useSocialSync(): void {
  useEffect(() => {
    void refreshSocial()
    const off = window.glofly.onEvent((e) => {
      if (e.type === 'social:changed') void refreshSocial()
    })
    const onFocus = (): void => void refreshSocial()
    window.addEventListener('focus', onFocus)
    const timer = setInterval(() => void refreshSocial(), 4 * 60 * 1000)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
      clearInterval(timer)
      set(EMPTY_SOCIAL)
    }
  }, [])
}

import { useEffect } from 'react'
import { friendLinkCodeFrom } from '@glofly/shared/friendLinks'
import type { DeepLink, PublicUser } from '../../../preload/api-types'

// 0.8.0: where Glofly was opened from, waiting for whoever handles it.
//   - The desktop app: a glofly:// link ("Open in Glofly" on glofly.app/i/<code> or /c/<code>),
//     taken from the main process (`links.take()`) at startup and on each `deep-link` event.
//   - Glofly in a browser: chat.glofly.app/?friend=<code> ("use Glofly in your browser").
// App.tsx takes them (signed out, a friend link opens sign-up); MainScreen asks "Add Chip as a
// friend?" (or shows the constellation invite) once signed in.

let pending: DeepLink | null = null
/** Signed up from a friend's link: who you're friends with now (MainScreen says so once). */
let joinedWith: PublicUser | null = null
const listeners = new Set<() => void>()
const changed = (): void => listeners.forEach((l) => l())

export function pushDeepLink(link: DeepLink): void {
  pending = link
  changed()
}

/** The waiting link (left waiting unless `take`). */
export const peekDeepLink = (): DeepLink | null => pending

export function takeDeepLink(): DeepLink | null {
  const link = pending
  pending = null
  if (link) changed()
  return link
}

export function noteJoinedWith(user: PublicUser | null): void {
  joinedWith = user
  changed()
}

export function takeJoinedWith(): PublicUser | null {
  const user = joinedWith
  joinedWith = null
  return user
}

/** Calls `onChange` whenever a link arrives (and once now). */
export function useDeepLinks(onChange: () => void): void {
  useEffect(() => {
    listeners.add(onChange)
    onChange()
    return () => {
      listeners.delete(onChange)
    }
  }, [onChange])
}

/** chat.glofly.app/?friend=<code>: the code, taken out of the address bar (once). */
function friendFromAddress(): string | null {
  try {
    const url = new URL(window.location.href)
    const raw = url.searchParams.get('friend')
    if (!raw) return null
    url.searchParams.delete('friend')
    window.history.replaceState(null, '', url.toString())
    return friendLinkCodeFrom(raw)
  } catch {
    return null
  }
}

/** Starts listening for links (App.tsx, once). */
export function startDeepLinks(): () => void {
  const code = friendFromAddress()
  if (code) pushDeepLink({ kind: 'friend', code })
  const take = (): void =>
    void window.glofly.links
      .take()
      .then((link) => link && pushDeepLink(link))
      .catch(() => {})
  take()
  return window.glofly.onEvent((event) => {
    if (event.type === 'deep-link') take()
  })
}

import { useCallback, useRef, useState } from 'react'
import type { ConstellationDetail, Message, Nebula } from '../../../preload/api-types'
import { isFirstNew, type NewSince } from './newSince'
import { NewSinceLine } from './NewSinceParts'

// 0.7.5 "New since you left": what was new when you opened a nebula, and its line.

/** Scrolls the chat to the "New since you left" line (true if it's drawn). */
export function scrollToNewLine(): boolean {
  const el = document.querySelector('.cx-main .cx-newline')
  if (!el) return false
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })
  return true
}

/** The nebula the screen shows for this id (the same choice as ConstellationView). */
function openNebula(c: ConstellationDetail, nebulaId: string | null): Nebula | null {
  return (
    c.nebulas.find((n) => n.id === nebulaId) ??
    c.nebulas.find((n) => n.kind === 'text') ??
    c.nebulas[0] ??
    null
  )
}

function snapshot(n: Nebula | null): NewSince | null {
  if (!n || n.kind !== 'text' || !n.lastReadAt || n.unreadCount <= 0) return null
  return { nebulaId: n.id, since: n.lastReadAt, count: n.unreadCount }
}

/**
 * What was new when you opened the nebula, kept while you're in it (reading it there doesn't
 * make the line go away; Mark as read or leaving does). If the screen first showed a remembered
 * copy of the constellation, the first fresh one gets a second look.
 */
export function useNewSince(
  c: ConstellationDetail,
  nebulaId: string | null,
  meId: string
): {
  info: NewSince | null
  clear: () => void
  lineBefore: ((m: Message, previous: Message | undefined) => React.ReactNode) | undefined
} {
  const [state, setState] = useState(() => ({
    key: `${c.id}:${openNebula(c, nebulaId)?.id}`,
    info: snapshot(openNebula(c, nebulaId)),
    detail: c,
    retried: false
  }))
  // Which message got the line (for this nebula and this look at it)
  const lineAt = useRef<{ key: string; id: string } | null>(null)
  // The nebula actually shown (no id yet means the first text one)
  const key = `${c.id}:${openNebula(c, nebulaId)?.id}`
  if (state.key !== key) {
    setState({ key, info: snapshot(openNebula(c, nebulaId)), detail: c, retried: false })
  } else if (!state.retried && state.detail !== c) {
    // The first fresh copy since opening: take another look if nothing was found.
    setState({
      ...state,
      detail: c,
      retried: true,
      info: state.info ?? snapshot(openNebula(c, nebulaId))
    })
  }
  const info = state.key === key ? state.info : null
  const clear = useCallback(() => {
    setState((s) => ({ ...s, info: null, retried: true }))
  }, [])
  const lineBefore = info
    ? (m: Message, previous: Message | undefined): React.ReactNode => {
        const look = `${key}:${info.since}`
        const at = lineAt.current?.key === look ? lineAt.current.id : null
        if (at) return at === m.id ? <NewSinceLine since={info.since} /> : null
        if (!isFirstNew(m, previous, info.since, meId)) return null
        lineAt.current = { key: look, id: m.id }
        return <NewSinceLine since={info.since} />
      }
    : undefined
  return { info, clear, lineBefore }
}

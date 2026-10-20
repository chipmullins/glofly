import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

// 0.7.5 "Life in the chat list" (ChatListLife.dc.html): when a chat jumps to the top of the
// sidebar (a new message), it glides there (320 ms, the approved spring) and the rows it passes
// slide down to make room; the bumped row glows softly once. Calm on purpose:
// - only one glow at a time,
// - nothing moves or glows while you're scrolling the list (or just did),
// - nothing at all with Reduce Motion (the row just appears at the top).

export const GLIDE_MS = 320
export const GLIDE_EASE = 'cubic-bezier(.2,.9,.3,1.15)'
const GLOW_CLASS = 'dm-row-wrap--glow'
const GLOW_MS = 1600
/** Scrolling the list this recently: no glide or glow. */
const SCROLL_QUIET_MS = 600

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Which row was bumped to the top: the new first id, when it was already in the list lower
 * down (a brand-new chat appearing isn't a bump). Null when nothing moved to the top.
 */
export function bumpedToTop(before: string[] | null, after: string[]): string | null {
  if (!before || after.length < 2) return null
  const top = after[0]
  if (top === before[0]) return null
  const was = before.indexOf(top)
  return was > 0 ? top : null
}

/**
 * Glides the rows (elements with data-glide="<id>") inside `container` when `ids` changes
 * order. `skipGlow` is the id that never glows (the chat you have open).
 */
export function useListGlide(
  container: RefObject<HTMLElement | null>,
  ids: string[],
  skipGlow: string | null
): void {
  const tops = useRef(new Map<string, number>())
  const lastIds = useRef<string[] | null>(null)
  const scrolledAt = useRef(0)
  const glowing = useRef<{ el: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(null)

  // Notice scrolling of whatever holds the list (the sidebar scrolls, not the list itself).
  useEffect(() => {
    const onScroll = (e: Event): void => {
      const root = container.current
      const target = e.target as Node | null
      if (root && target && target instanceof Node && target.contains(root)) {
        scrolledAt.current = Date.now()
      }
    }
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('scroll', onScroll, true)
      if (glowing.current) clearTimeout(glowing.current.timer)
    }
  }, [container])

  const key = ids.join(',')
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const rows = new Map<string, HTMLElement>()
    root.querySelectorAll<HTMLElement>('[data-glide]').forEach((el) => {
      if (el.dataset.glide) rows.set(el.dataset.glide, el)
    })
    const next = new Map<string, number>()
    for (const [id, el] of rows) next.set(id, el.offsetTop)

    const bumped = bumpedToTop(lastIds.current, ids)
    const calm = Date.now() - scrolledAt.current > SCROLL_QUIET_MS
    if (bumped && calm && !reduced()) {
      for (const [id, el] of rows) {
        const was = tops.current.get(id)
        const now = next.get(id)
        if (was === undefined || now === undefined || typeof el.animate !== 'function') continue
        const dy = was - now
        if (Math.abs(dy) < 1) continue
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
          duration: GLIDE_MS,
          easing: id === bumped ? GLIDE_EASE : 'ease-out'
        })
      }
      const el = rows.get(bumped)
      if (el && bumped !== skipGlow) {
        // One glow at a time: a new one replaces the old.
        if (glowing.current) {
          clearTimeout(glowing.current.timer)
          glowing.current.el.classList.remove(GLOW_CLASS)
        }
        el.classList.remove(GLOW_CLASS)
        void el.offsetWidth // restart the animation
        el.classList.add(GLOW_CLASS)
        const timer = setTimeout(() => {
          el.classList.remove(GLOW_CLASS)
          if (glowing.current?.el === el) glowing.current = null
        }, GLOW_MS)
        glowing.current = { el, timer }
      }
    }
    tops.current = next
    lastIds.current = ids
    // Only when the order changes (re-measuring on every render would be wasted work).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

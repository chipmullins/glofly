import { useLayoutEffect, useRef, type RefObject } from 'react'

// Tiles that slide into place when people join or leave a call (0.7.5, CallScreen.dc.html):
// "FLIP" (first, last, invert, play). Every element inside the container with a data-flip id is
// measured after each render; when the set of ids changes, the ones that moved glide from their
// old box to the new one and new ones grow in. People leaving just go (the rest close the gap).
// Reduce Motion: nothing moves.

/** The approved motion: opening 240 ms with a tiny overshoot. */
export const OPEN_MS = 240
export const OPEN_EASE = 'cubic-bezier(.2,.9,.3,1.15)'

/** What changes the layout on purpose (ids joined + the layout name). */
export function flipKey(ids: string[], layout: string): string {
  return `${layout}|${ids.join(',')}`
}

/** True when the old and new key list the same layout but different people. */
export function shouldFlip(before: string | null, after: string): boolean {
  if (before === null || before === after) return false
  return before.split('|')[0] === after.split('|')[0]
}

const reduced = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function useFlip(container: RefObject<HTMLElement | null>, key: string): void {
  const boxes = useRef(new Map<string, DOMRect>())
  const lastKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const animate = shouldFlip(lastKey.current, key) && !reduced()
    const next = new Map<string, DOMRect>()
    root.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
      const id = el.dataset.flip
      if (!id) return
      const box = el.getBoundingClientRect()
      next.set(id, box)
      if (!animate || typeof el.animate !== 'function') return
      const was = boxes.current.get(id)
      if (!was) {
        el.animate(
          [
            { opacity: 0, transform: 'scale(.94)' },
            { opacity: 1, transform: 'none' }
          ],
          { duration: OPEN_MS, easing: OPEN_EASE }
        )
        return
      }
      const dx = was.left - box.left
      const dy = was.top - box.top
      const sx = box.width ? was.width / box.width : 1
      const sy = box.height ? was.height / box.height : 1
      if (
        Math.abs(dx) < 1 &&
        Math.abs(dy) < 1 &&
        Math.abs(sx - 1) < 0.01 &&
        Math.abs(sy - 1) < 0.01
      )
        return
      el.animate(
        [
          {
            transformOrigin: 'top left',
            transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
          },
          { transformOrigin: 'top left', transform: 'none' }
        ],
        { duration: OPEN_MS, easing: OPEN_EASE }
      )
    })
    boxes.current = next
    lastKey.current = key
  })
}

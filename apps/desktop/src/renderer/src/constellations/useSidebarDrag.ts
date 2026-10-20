import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './skyData'
import { moveCategory, moveNebula, sameRows, type Row } from './sidebarOrder'

// 0.7.5 smooth reordering (canvas board 10, approved): grab a nebula (or a category) in the
// sidebar and move it. The row lifts with a soft shadow, a glowing line shows where it lands, and
// on drop the others glide into place with the approved spring. Everyone else sees the new order
// arrive the same smooth way (rowsKey changes → the rows slide).

const SPRING = 'transform 280ms cubic-bezier(.2,.9,.3,1.15)'
/** How far the pointer moves before a press becomes a drag */
const SLOP = 5

type Drag = {
  row: Row
  pointerId: number
  y0: number
  active: boolean
  dy: number
  /** Index in rows the dragged row would land before (rows.length = the end) */
  dropIndex: number | null
  /** Where the glowing line sits, in the list's own coordinates */
  lineTop: number | null
}

export function useSidebarDrag({
  enabled,
  rows,
  onCommit
}: {
  enabled: boolean
  rows: Row[]
  onCommit: (rows: Row[]) => void
}): {
  listRef: React.RefObject<HTMLDivElement | null>
  /** The row being dragged (lifted), its offset, and where the line goes */
  drag: { key: string; dy: number; lineTop: number | null } | null
  onPointerDown: (e: React.PointerEvent, row: Row) => void
  /** True once, right after a drag (the click that ends it shouldn't open the nebula) */
  takeClick: () => boolean
} {
  const listRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<{ key: string; dy: number; lineTop: number | null } | null>(null)
  const swallowClick = useRef(false)
  const rowsRef = useRef(rows)
  const commitRef = useRef(onCommit)
  useLayoutEffect(() => {
    rowsRef.current = rows
    commitRef.current = onCommit
  })

  /** Where the dragged row would land for this pointer position. */
  const target = useCallback((d: Drag, y: number): { index: number; top: number } | null => {
    const list = listRef.current
    if (!list) return null
    const listRect = list.getBoundingClientRect()
    const els = [...list.querySelectorAll<HTMLElement>('[data-row]')]
    const all = rowsRef.current
    const gaps: { index: number; y: number }[] = []
    const keyOf = (r: Row): string => `${r.kind}:${r.id}`
    const myKey = keyOf(d.row)
    const rectOf = (r: Row): DOMRect | null =>
      els.find((el) => el.dataset.row === keyOf(r))?.getBoundingClientRect() ?? null
    all.forEach((r, i) => {
      if (keyOf(r) === myKey) return
      if (d.row.kind === 'cat' && r.kind !== 'cat') return
      const rect = rectOf(r)
      if (rect && rect.height > 0) gaps.push({ index: i, y: rect.top })
    })
    // The very end
    const lastRect = all.length ? rectOf(all[all.length - 1]) : null
    if (lastRect) gaps.push({ index: all.length, y: lastRect.bottom })
    if (!gaps.length) return null
    let best = gaps[0]
    for (const g of gaps) if (Math.abs(g.y - y) < Math.abs(best.y - y)) best = g
    return { index: best.index, top: best.y - listRect.top + list.scrollTop - 2 }
  }, [])

  const end = useCallback((commit: boolean) => {
    const d = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!d?.active) return
    swallowClick.current = true
    setTimeout(() => {
      swallowClick.current = false
    }, 0)
    if (!commit || d.dropIndex === null) return
    const all = rowsRef.current
    let next: Row[]
    if (d.row.kind === 'neb') next = moveNebula(all, d.row.id, d.dropIndex)
    else {
      const before = all.slice(d.dropIndex).find((r) => r.kind === 'cat')
      next = moveCategory(all, d.row.id, before ? before.id : null)
    }
    if (!sameRows(next, all)) commitRef.current(next)
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current
      if (!d || e.pointerId !== d.pointerId) return
      const dy = e.clientY - d.y0
      if (!d.active && Math.abs(dy) < SLOP) return
      d.active = true
      d.dy = dy
      const t = target(d, e.clientY)
      d.dropIndex = t?.index ?? null
      d.lineTop = t?.top ?? null
      setDrag({ key: `${d.row.kind}:${d.row.id}`, dy, lineTop: d.lineTop })
    }
    const onUp = (e: PointerEvent): void => {
      if (dragRef.current && e.pointerId === dragRef.current.pointerId) end(true)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && dragRef.current?.active) {
        e.preventDefault()
        end(false)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [target, end])

  const onPointerDown = useCallback(
    (e: React.PointerEvent, row: Row) => {
      if (!enabled || e.button !== 0 || e.pointerType === 'touch') return
      dragRef.current = {
        row,
        pointerId: e.pointerId,
        y0: e.clientY,
        active: false,
        dy: 0,
        dropIndex: null,
        lineTop: null
      }
    },
    [enabled]
  )

  const takeClick = useCallback(() => swallowClick.current, [])

  return { listRef, drag, onPointerDown, takeClick }
}

/**
 * FLIP: when the rows' order changes (yours or someone else's), each row slides from where it
 * was to where it is now with the approved spring. Nothing moves with Reduce Motion.
 */
export function useRowsGlide(
  listRef: React.RefObject<HTMLDivElement | null>,
  rowsKey: string
): void {
  const last = useRef<{ key: string; tops: Map<string, number> } | null>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const els = [...list.querySelectorAll<HTMLElement>('[data-row]')]
    const tops = new Map(els.map((el) => [el.dataset.row!, el.getBoundingClientRect().top]))
    const before = last.current
    last.current = { key: rowsKey, tops }
    if (!before || before.key === rowsKey || prefersReducedMotion()) return
    for (const el of els) {
      const was = before.tops.get(el.dataset.row!)
      const now = tops.get(el.dataset.row!)
      if (was === undefined || now === undefined || Math.abs(was - now) < 1) continue
      el.style.transition = 'none'
      el.style.transform = `translateY(${was - now}px)`
      void el.offsetHeight
      el.style.transition = SPRING
      el.style.transform = ''
      const clear = (): void => {
        el.style.transition = ''
        el.removeEventListener('transitionend', clear)
      }
      el.addEventListener('transitionend', clear)
    }
  })
}

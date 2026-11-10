import { useRef } from 'react'
import type { Token } from '@glofly/shared/campfire/types'
import { cf } from './api'
import { useCf } from './ctx'
import { snapToken } from './geometry'

// Placing tokens (Add to the map, the monster stat block).

/**
 * Puts a token on the map at the free spot nearest the middle of the view (so new tokens don't
 * land on each other); `hidden` puts it on the GM layer. Selects it and returns it.
 */
export function usePlace(): (
  body: Record<string, unknown>,
  opts?: { cells?: number; hidden?: boolean; select?: boolean }
) => Promise<Token | null> {
  const { t, say, mapCenter, ctl, setSelectedId } = useCf()
  const scene = t.scene
  // Tokens placed a moment ago (the table's list may not have them yet).
  const recent = useRef<{ x: number; y: number; w: number; h: number }[]>([])
  return async (body, opts = {}) => {
    if (!scene) {
      say('Make a scene first.')
      return null
    }
    const cells = opts.cells ?? 1
    const [cx, cy] = mapCenter()
    const [x, y] = freeSpot(cx, cy, cells)
    const r = await cf.post<Token>(`/campfire/scenes/${scene.id}/tokens`, {
      x,
      y,
      ...((opts.hidden ?? false) ? { layer: 'gm' } : {}),
      ...body
    })
    if (!r.ok) {
      say(r.message)
      return null
    }
    recent.current = [
      ...recent.current.slice(-20),
      { x: r.data.x, y: r.data.y, w: r.data.w, h: r.data.h }
    ]
    ctl.upsertToken(r.data)
    if (opts.select !== false) setSelectedId(r.data.id)
    return r.data
  }

  function freeSpot(cx: number, cy: number, cells: number): [number, number] {
    const g = scene!.grid
    const size = cells * g.size
    const taken = [...t.tokens, ...recent.current].map((k) => ({
      x: k.x,
      y: k.y,
      w: k.w * g.size,
      h: k.h * g.size
    }))
    const free = (x: number, y: number): boolean =>
      !taken.some(
        (k) => x < k.x + k.w - 2 && x + size > k.x + 2 && y < k.y + k.h - 2 && y + size > k.y + 2
      )
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const [x, y] = snapToken(
            cx - size / 2 + dx * g.size,
            cy - size / 2 + dy * g.size,
            cells,
            cells,
            g
          )
          if (free(x, y)) return [x, y]
        }
      }
    }
    return snapToken(cx - size / 2, cy - size / 2, cells, cells, g)
  }
}

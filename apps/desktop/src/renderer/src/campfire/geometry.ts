import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { GridSettings, MapTheme, Point } from '@glofly/shared/campfire/types'

// Map math: snapping to the grid (squares or hexes), distances in feet, the hex pattern, and the
// pan/zoom every map view uses (wheel, drag, pinch).

const SQRT3 = Math.sqrt(3)

/** Hexes are pointy-top: `size` is a hex's width, rows overlap by a quarter. */
export const hexHeight = (size: number): number => (size * 2) / SQRT3

export function hexCenter(col: number, row: number, g: GridSettings): Point {
  const w = g.size
  const h = hexHeight(w)
  return [
    g.offsetX + col * w + w / 2 + (row % 2 !== 0 ? w / 2 : 0),
    g.offsetY + row * 0.75 * h + h / 2
  ]
}

/** The hex center nearest a point. */
export function nearestHexCenter(x: number, y: number, g: GridSettings): Point {
  const h = hexHeight(g.size)
  const row0 = Math.round((y - g.offsetY - h / 2) / (0.75 * h))
  let best: Point = [x, y]
  let bestD = Infinity
  for (let row = row0 - 1; row <= row0 + 1; row++) {
    const shift = row % 2 !== 0 ? g.size / 2 : 0
    const col0 = Math.round((x - g.offsetX - g.size / 2 - shift) / g.size)
    for (let col = col0 - 1; col <= col0 + 1; col++) {
      const c = hexCenter(col, row, g)
      const d = (c[0] - x) ** 2 + (c[1] - y) ** 2
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
  }
  return best
}

/** Where a token (w × h cells) lands when dropped with its top-left at x, y. */
export function snapToken(
  x: number,
  y: number,
  wCells: number,
  hCells: number,
  g: GridSettings
): Point {
  const pw = wCells * g.size
  const ph = hCells * g.size
  if (g.type === 'hex') {
    const [cx, cy] = nearestHexCenter(x + pw / 2, y + ph / 2, g)
    return [Math.round(cx - pw / 2), Math.round(cy - ph / 2)]
  }
  return [
    Math.round(Math.round((x - g.offsetX) / g.size) * g.size + g.offsetX),
    Math.round(Math.round((y - g.offsetY) / g.size) * g.size + g.offsetY)
  ]
}

/** A point snapped to the grid's corners (map builder: rooms and walls). */
export function snapCorner(x: number, y: number, g: GridSettings, free = false): Point {
  if (free) return [Math.round(x), Math.round(y)]
  if (g.type === 'hex') return nearestHexCenter(x, y, g).map(Math.round) as Point
  const half = g.size / 2
  // Half cells, so walls can run through the middle of a square too.
  return [
    Math.round(Math.round((x - g.offsetX) / half) * half + g.offsetX),
    Math.round(Math.round((y - g.offsetY) / half) * half + g.offsetY)
  ]
}

/** Feet between two points: 5e counts a diagonal square as one (hexes: as the crow flies). */
export function feetBetween(a: Point, b: Point, g: GridSettings): number {
  const dx = Math.abs(b[0] - a[0]) / g.size
  const dy = Math.abs(b[1] - a[1]) / g.size
  const cells = g.type === 'hex' ? Math.round(Math.hypot(dx, dy)) : Math.round(Math.max(dx, dy))
  return cells * g.feet
}

/** One tile of the hex pattern (two rows), as an SVG path. */
export function hexPattern(size: number): { w: number; h: number; d: string } {
  const w = size
  const h = hexHeight(size)
  const hex = (cx: number, cy: number): string => {
    const pts = [
      [cx, cy - h / 2],
      [cx + w / 2, cy - h / 4],
      [cx + w / 2, cy + h / 4],
      [cx, cy + h / 2],
      [cx - w / 2, cy + h / 4],
      [cx - w / 2, cy - h / 4]
    ]
    return `M${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L')}Z`
  }
  const d = [
    hex(w / 2, h / 2),
    hex(0, 1.25 * h),
    hex(w, 1.25 * h),
    hex(0, -0.25 * h),
    hex(w, -0.25 * h)
  ].join('')
  return { w, h: 1.5 * h, d }
}

// ───────────── Looks ─────────────

/** The built map's layers that can be shown or hidden (map builder). */
export type BuiltLayers = { floor: boolean; walls: boolean; objects: boolean; notes: boolean }
export const ALL_LAYERS: BuiltLayers = { floor: true, walls: true, objects: true, notes: true }

/** Map themes: what's around the rooms, and the walls' color. */
export const THEMES: Record<
  MapTheme,
  { label: string; bg: string; wall: string; swatch: string[] }
> = {
  stone: {
    label: 'Stone',
    bg: '#0b0807',
    wall: '#2b221d',
    swatch: ['#5b4f46', '#3f4a4c', '#6e4a2f']
  },
  wood: {
    label: 'Wood',
    bg: '#120c08',
    wall: '#3a2414',
    swatch: ['#6e4a2f', '#8a5d3b', '#4a301d']
  },
  grass: {
    label: 'Grass',
    bg: '#18210f',
    wall: '#2c2418',
    swatch: ['#4f7a3a', '#6a8f4a', '#3a5a2a']
  },
  cave: {
    label: 'Cave',
    bg: '#090707',
    wall: '#1d1817',
    swatch: ['#3f3936', '#4c4542', '#2b2624']
  },
  snow: {
    label: 'Snow',
    bg: '#1b232a',
    wall: '#56636d',
    swatch: ['#dfe6ea', '#b9c6cf', '#8e9ea9']
  },
  sand: {
    label: 'Sand',
    bg: '#2a2013',
    wall: '#5a4425',
    swatch: ['#c8a76a', '#b08d52', '#8a6a3c']
  },
  night: {
    label: 'Night',
    bg: '#06080f',
    wall: '#1a1f2e',
    swatch: ['#2b3350', '#3b4466', '#1b2036']
  }
}

/** Floor materials for built rooms. */
export const MATERIALS: { id: string; label: string; fill: string; line: string }[] = [
  { id: 'stone', label: 'Stone', fill: '#5b4f46', line: 'rgba(0,0,0,0.22)' },
  { id: 'wood', label: 'Wood', fill: '#6e4a2f', line: 'rgba(0,0,0,0.3)' },
  { id: 'grass', label: 'Grass', fill: '#4f7a3a', line: 'rgba(0,0,0,0.18)' },
  { id: 'water', label: 'Water', fill: '#2f6a8a', line: 'rgba(255,255,255,0.12)' },
  { id: 'sand', label: 'Sand', fill: '#c8a76a', line: 'rgba(0,0,0,0.15)' },
  { id: 'cave', label: 'Cave', fill: '#3f3936', line: 'rgba(0,0,0,0.25)' },
  { id: 'snow', label: 'Snow', fill: '#dfe6ea', line: 'rgba(0,0,0,0.12)' },
  { id: 'dirt', label: 'Dirt', fill: '#6b5236', line: 'rgba(0,0,0,0.2)' },
  { id: 'tile', label: 'Tiles', fill: '#4c4139', line: 'rgba(0,0,0,0.3)' },
  { id: 'lava', label: 'Lava', fill: '#a8401c', line: 'rgba(255,200,80,0.25)' }
]
export const materialOf = (id: string): (typeof MATERIALS)[number] =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]

/** Objects the map builder can place (drawn by BuiltLayer). Sizes in cells. */
export const OBJECTS: { kind: string; label: string; w: number; h: number }[] = [
  { kind: 'door', label: 'Door', w: 0.4, h: 1 },
  { kind: 'table', label: 'Table', w: 3, h: 1 },
  { kind: 'pillar', label: 'Pillar', w: 0.6, h: 0.6 },
  { kind: 'chest', label: 'Chest', w: 1, h: 0.7 },
  { kind: 'stairs', label: 'Stairs', w: 2, h: 1 },
  { kind: 'tree', label: 'Tree', w: 1.4, h: 1.4 },
  { kind: 'campfire', label: 'Campfire', w: 1, h: 1 },
  { kind: 'trap', label: 'Trap', w: 1, h: 1 },
  { kind: 'bed', label: 'Bed', w: 1, h: 2 },
  { kind: 'barrel', label: 'Barrel', w: 0.7, h: 0.7 },
  { kind: 'rock', label: 'Rock', w: 1, h: 1 },
  { kind: 'statue', label: 'Statue', w: 1, h: 1 }
]

/** Token ring colors for the party (by id), red for monsters. */
const PARTY = [
  '#4f8cff',
  '#b57cff',
  '#f0b429',
  '#57c27a',
  '#ff8fb1',
  '#4fd1c5',
  '#ff9f43',
  '#9ad14f'
]
const PARTY_FILL = [
  '#2f5aa8',
  '#6b3fa8',
  '#a8761c',
  '#2f7a4a',
  '#a8456a',
  '#2a8a80',
  '#a8621c',
  '#5a8a2a'
]
export function ringFor(id: string, party: boolean): { ring: string; fill: string } {
  if (!party) return { ring: '#ef5a4a', fill: '#7a2a22' }
  let n = 0
  for (const ch of id) n = (n * 31 + ch.charCodeAt(0)) >>> 0
  return { ring: PARTY[n % PARTY.length], fill: PARTY_FILL[n % PARTY.length] }
}

export const hpColor = (pct: number): string =>
  pct > 50 ? '#57c27a' : pct > 25 ? '#f0b429' : '#ef5a4a'

// ───────────── Pan and zoom ─────────────

export type View = { x: number; y: number; z: number }

export type PanZoom = {
  box: React.RefObject<HTMLDivElement | null>
  view: View
  setView: React.Dispatch<React.SetStateAction<View>>
  fit: () => void
  zoomAt: (factor: number, cx?: number, cy?: number) => void
  toWorld: (clientX: number, clientY: number) => Point
  panBy: (dx: number, dy: number) => void
  center: () => Point
}

export function usePanZoom(worldW: number, worldH: number, key: string): PanZoom {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, z: 1 })
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  }, [view])

  const fit = useCallback(() => {
    const el = box.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return
    const z = Math.min(
      2,
      Math.max(0.1, Math.min((r.width - 40) / worldW, (r.height - 40) / worldH))
    )
    setView({ z, x: (r.width - worldW * z) / 2, y: (r.height - worldH * z) / 2 })
  }, [worldW, worldH])

  // Fit when the scene changes (and when the box first gets its size).
  useEffect(() => {
    fit()
    const el = box.current
    if (!el) return
    let fitted = false
    const ro = new ResizeObserver(() => {
      if (!fitted) {
        fitted = true
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = box.current
    const r = el?.getBoundingClientRect()
    const px = cx ?? (r ? r.width / 2 : 0)
    const py = cy ?? (r ? r.height / 2 : 0)
    setView((v) => {
      const z = Math.min(4, Math.max(0.08, v.z * factor))
      const k = z / v.z
      return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k }
    })
  }, [])

  // The wheel zooms around the pointer (Ctrl/pinch on a touchpad too); Shift+wheel pans.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      if (e.shiftKey && !e.ctrlKey) {
        setView((v) => ({ ...v, x: v.x - e.deltaY, y: v.y - e.deltaX }))
        return
      }
      zoomAt(
        Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
        e.clientX - r.left,
        e.clientY - r.top
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  /** Screen (client) point → map point. */
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const r = box.current?.getBoundingClientRect()
    const v = viewRef.current
    if (!r) return [0, 0]
    return [(clientX - r.left - v.x) / v.z, (clientY - r.top - v.y) / v.z]
  }, [])

  const panBy = useCallback(
    (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy })),
    []
  )

  /** The middle of what's showing, in map points (new tokens go there). */
  const center = useCallback((): Point => {
    const r = box.current?.getBoundingClientRect()
    const v = viewRef.current
    if (!r) return [0, 0]
    return [(r.width / 2 - v.x) / v.z, (r.height / 2 - v.y) / v.z]
  }, [])

  return { box, view, setView, fit, zoomAt, toWorld, panBy, center }
}

/** Two-finger pinch on touch screens: call from pointer handlers. */
export class Pinch {
  private pts = new Map<number, Point>()
  private last: { d: number; c: Point } | null = null
  down(e: React.PointerEvent): void {
    this.pts.set(e.pointerId, [e.clientX, e.clientY])
    this.last = null
  }
  up(e: React.PointerEvent): void {
    this.pts.delete(e.pointerId)
    this.last = null
  }
  get active(): boolean {
    return this.pts.size >= 2
  }
  /** Returns the zoom factor and pan since the last move (or null). */
  move(e: React.PointerEvent): { factor: number; c: Point; dx: number; dy: number } | null {
    if (!this.pts.has(e.pointerId)) return null
    this.pts.set(e.pointerId, [e.clientX, e.clientY])
    if (this.pts.size < 2) return null
    const [a, b] = [...this.pts.values()]
    const d = Math.hypot(a[0] - b[0], a[1] - b[1])
    const c: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const prev = this.last
    this.last = { d, c }
    if (!prev || !prev.d) return null
    return { factor: d / prev.d, c, dx: c[0] - prev.c[0], dy: c[1] - prev.c[1] }
  }
}

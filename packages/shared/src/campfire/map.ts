// Campfire maps: fog of war geometry and cleaning up scene data (grid, built map, fog). The server
// uses this to decide what players may receive; the apps use it to draw the same fog.

import { CAMPFIRE_LIMITS, MAP_THEMES, type BuiltMap, type FogShape, type FogState, type GridSettings, type MapTheme, type Point } from './types'

export const DEFAULT_GRID: GridSettings = { type: 'square', size: 70, feet: 5, color: '#000000', opacity: 0.25, offsetX: 0, offsetY: 0 }
export const EMPTY_BUILT: BuiltMap = { floors: [], walls: [], objects: [], notes: [] }
export const EMPTY_FOG: FogState = { enabled: false, revealed: [] }

// ───────────── Geometry ─────────────

export function pointInPolygon([x, y]: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A rectangle is its two opposite corners; edges count as inside. */
export function pointInShape(p: Point, shape: FogShape): boolean {
  if (shape.kind === 'rect') {
    const [[x1, y1], [x2, y2]] = shape.points
    return p[0] >= Math.min(x1, x2) && p[0] <= Math.max(x1, x2) && p[1] >= Math.min(y1, y2) && p[1] <= Math.max(y1, y2)
  }
  return pointInPolygon(p, shape.points)
}

// Each shape's bounding box, worked out once (most points are outside most shapes).
const boxes = new WeakMap<FogShape, [number, number, number, number]>()
function boxOf(s: FogShape): [number, number, number, number] {
  let b = boxes.get(s)
  if (!b) {
    const xs = s.points.map((q) => q[0])
    const ys = s.points.map((q) => q[1])
    b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    boxes.set(s, b)
  }
  return b
}

/** Counts the work fog checks do, so one scene can't keep the server busy (see builtForPlayer). */
type Work = { left: number }

/** Is this point under fog? (The latest shape covering it decides; nothing covering it = fogged.) */
export function isFogged(fog: FogState, p: Point, work?: Work): boolean {
  if (!fog.enabled) return false
  for (let i = fog.revealed.length - 1; i >= 0; i--) {
    const s = fog.revealed[i]
    const [x0, y0, x1, y1] = boxOf(s)
    if (work) work.left--
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue
    if (work) work.left -= s.points.length
    if (pointInShape(p, s)) return s.mode === 'hide'
  }
  return true
}

/** A token's center, in px. */
export const tokenCenter = (t: { x: number; y: number; w: number; h: number }, grid: Pick<GridSettings, 'size'>): Point => [
  t.x + (t.w * grid.size) / 2,
  t.y + (t.h * grid.size) / 2
]

const MAX_SAMPLES = 600

/** Points along a path (every `step` px), its corners included. */
function samplePath(points: Point[], closed: boolean, step: number): Point[] {
  const out: Point[] = [...points]
  const n = closed ? points.length : points.length - 1
  for (let i = 0; i < n && out.length < MAX_SAMPLES; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % points.length]
    const len = Math.hypot(bx - ax, by - ay)
    const parts = Math.min(100, Math.floor(len / step))
    for (let k = 1; k <= parts; k++) out.push([ax + ((bx - ax) * k) / (parts + 1), ay + ((by - ay) * k) / (parts + 1)])
  }
  return out
}

/**
 * Can any part of this piece be seen through the fog? Checked at sample points (its corners,
 * along its edges, inside it, and the fog's own corners inside it), so a piece that is only
 * barely uncovered may still count as fogged: the safe side (players get less, never more).
 */
export function pieceVisible(fog: FogState, points: Point[], closed: boolean, step = 35, work?: Work): boolean {
  if (!fog.enabled) return true
  if (!points.length) return false
  // Out of work for this map: the rest counts as fogged (the safe side).
  if (work && work.left <= 0) return false
  const samples = samplePath(points, closed, Math.max(5, step))
  if (closed && points.length >= 3) {
    const xs = points.map((p) => p[0])
    const ys = points.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
      const p: Point = [x0 + ((x1 - x0) * i) / 12, y0 + ((y1 - y0) * j) / 12]
      if (pointInPolygon(p, points)) samples.push(p)
    }
    for (const s of fog.revealed) {
      if (s.mode === 'hide') continue
      const corners: Point[] = s.kind === 'rect' ? [s.points[0], [s.points[1][0], s.points[0][1]], s.points[1], [s.points[0][0], s.points[1][1]]] : s.points
      for (const c of corners) if (pointInPolygon(c, points)) samples.push(c)
    }
  }
  if (work) work.left -= samples.length
  return samples.some((p) => (work ? work.left > 0 : true) && !isFogged(fog, p, work))
}

const rectPoints = (x: number, y: number, w: number, h: number): Point[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h]
]

/** How much checking one built map may take for a player (a real map needs far less). */
export const BUILT_FOG_WORK = 10_000_000

/**
 * What a player may see of a built map: no GM notes, and nothing fully under fog. The work is
 * capped (a huge map under a huge fog could otherwise keep the server busy for minutes): pieces
 * left when it runs out count as fogged.
 */
export function builtForPlayer(built: BuiltMap, fog: FogState, step = 35, budget = BUILT_FOG_WORK): BuiltMap {
  const work: Work = { left: budget }
  return {
    floors: built.floors.filter((f) => pieceVisible(fog, f.points, true, step, work)),
    walls: built.walls.filter((w) => pieceVisible(fog, w.points, false, step, work)),
    objects: built.objects.filter((o) => pieceVisible(fog, rectPoints(o.x, o.y, o.w, o.h), true, step, work)),
    notes: []
  }
}

/** All the corners of a fog's shapes together (at most CAMPFIRE_LIMITS.fogPoints are kept). */
export const fogPointCount = (fog: FogState): number => fog.revealed.reduce((n, s) => n + s.points.length, 0)

// ───────────── Cleaning up what apps send ─────────────

const COORD = 100_000
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {})
const coord = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.min(COORD, Math.max(-COORD, Math.round(x * 10) / 10)) : null)
const point = (x: unknown): Point | null => {
  if (!Array.isArray(x) || x.length !== 2) return null
  const a = coord(x[0])
  const b = coord(x[1])
  return a === null || b === null ? null : [a, b]
}
const points = (x: unknown, min: number, max: number): Point[] | null => {
  if (!Array.isArray(x) || x.length < min || x.length > max) return null
  const out = x.map(point)
  return out.every((p) => p) ? (out as Point[]) : null
}
const id = (x: unknown): string | null => (typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x) ? x : null)
const word = (x: unknown, max = 30): string | null => (typeof x === 'string' && /^[a-z0-9-]{1,30}$/i.test(x) ? x.slice(0, max) : null)
export const isColor = (x: unknown): x is string => typeof x === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x)
export const isMapTheme = (x: unknown): x is MapTheme => typeof x === 'string' && (MAP_THEMES as readonly string[]).includes(x)

/** A valid fog shape, or null. */
export function cleanFogShape(raw: unknown, fallbackId: string): FogShape | null {
  const o = obj(raw)
  const kind = o.kind === 'poly' ? 'poly' : o.kind === 'rect' ? 'rect' : null
  if (!kind) return null
  const pts = kind === 'rect' ? points(o.points, 2, 2) : points(o.points, 3, 200)
  if (!pts) return null
  return { id: id(o.id) ?? fallbackId, kind, points: pts, ...(o.mode === 'hide' ? { mode: 'hide' as const } : {}) }
}

export function normalizeFog(raw: unknown): FogState {
  const o = obj(raw)
  const shapes = Array.isArray(o.revealed) ? o.revealed.slice(-CAMPFIRE_LIMITS.fogShapes) : []
  const clean = shapes.map((s, i) => cleanFogShape(s, `f${i}`)).filter((s): s is FogShape => !!s)
  // The newest shapes are kept while their corners fit (older ones matter least).
  let room: number = CAMPFIRE_LIMITS.fogPoints
  let from = clean.length
  while (from > 0 && room - clean[from - 1].points.length >= 0) room -= clean[--from].points.length
  return { enabled: o.enabled === true, revealed: clean.slice(from) }
}

export function normalizeGrid(raw: unknown): GridSettings {
  const o = obj(raw)
  const n = (x: unknown, lo: number, hi: number, def: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def)
  return {
    type: o.type === 'hex' ? 'hex' : 'square',
    size: Math.round(n(o.size, 10, 500, DEFAULT_GRID.size)),
    feet: n(o.feet, 1, 100, DEFAULT_GRID.feet),
    color: isColor(o.color) ? o.color : DEFAULT_GRID.color,
    opacity: n(o.opacity, 0, 1, DEFAULT_GRID.opacity),
    offsetX: Math.round(n(o.offsetX, -500, 500, 0)),
    offsetY: Math.round(n(o.offsetY, -500, 500, 0))
  }
}

/** The map builder's data, cleaned up (at most 2,000 pieces in all). Null if it isn't usable. */
export function normalizeBuilt(raw: unknown): BuiltMap {
  const o = obj(raw)
  let room: number = CAMPFIRE_LIMITS.builtPieces
  const take = <T>(x: unknown, each: (v: Record<string, unknown>, i: number) => T | null): T[] => {
    if (!Array.isArray(x)) return []
    const out: T[] = []
    for (const [i, v] of x.entries()) {
      if (room <= 0) break
      const c = each(obj(v), i)
      if (c) {
        out.push(c)
        room--
      }
    }
    return out
  }
  return {
    floors: take(o.floors, (v, i) => {
      const pts = points(v.points, 3, 200)
      return pts ? { id: id(v.id) ?? `fl${i}`, points: pts, material: word(v.material) ?? 'stone' } : null
    }),
    walls: take(o.walls, (v, i) => {
      const pts = points(v.points, 2, 200)
      if (!pts) return null
      const door = obj(v.door)
      const state = door.state === 'open' || door.state === 'closed' || door.state === 'locked' ? door.state : null
      return { id: id(v.id) ?? `w${i}`, points: pts, ...(v.door && state ? { door: { state } } : {}) }
    }),
    objects: take(o.objects, (v, i) => {
      const x = coord(v.x)
      const y = coord(v.y)
      const w = coord(v.w)
      const h = coord(v.h)
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null
      return { id: id(v.id) ?? `o${i}`, kind: word(v.kind) ?? 'crate', x, y, w, h, rotation: ((Math.round(coord(v.rotation) ?? 0) % 360) + 360) % 360 }
    }),
    notes: take(o.notes, (v, i) => {
      const x = coord(v.x)
      const y = coord(v.y)
      const text = typeof v.text === 'string' ? v.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, CAMPFIRE_LIMITS.noteText) : ''
      return x === null || y === null || !text.trim() ? null : { id: id(v.id) ?? `n${i}`, x, y, text }
    })
  }
}

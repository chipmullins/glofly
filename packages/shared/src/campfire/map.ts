// Campfire maps: fog of war geometry and cleaning up scene data (grid, built map, fog). The server
// uses this to decide what players may receive; the apps use it to draw the same fog.

import { CAMPFIRE_LIMITS, MAP_THEMES, type BuiltMap, type FogShape, type FogState, type GridSettings, type MapLayer, type MapTheme, type PieceShown, type Point } from './types'

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
export function builtForPlayer(raw: BuiltMap, fog: FogState, step = 35, budget = BUILT_FOG_WORK): BuiltMap {
  const work: Work = { left: budget }
  const built = shownToPlayers(raw)
  return {
    floors: built.floors.filter((f) => pieceVisible(fog, f.points, true, step, work)),
    walls: built.walls.filter((w) => pieceVisible(fog, w.points, false, step, work)),
    objects: built.objects.filter((o) => pieceVisible(fog, rectPoints(o.x, o.y, o.w, o.h), true, step, work)),
    notes: [],
    ...(built.terrain?.length ? { terrain: built.terrain.filter((t) => pieceVisible(fog, t.points, true, step, work)) } : {})
  }
}

/** 0.11.2: is this piece hidden from players (by itself, or by being on a hidden layer)? */
export function pieceHidden(piece: PieceShown, layers: readonly MapLayer[] | undefined): boolean {
  if (piece.hidden) return true
  if (!piece.layer || !layers?.length) return false
  return layers.some((l) => l.id === piece.layer && l.hidden)
}

/**
 * 0.11.2: the built map without anything the game master hid (pieces, or pieces on hidden layers),
 * without the layer list and without the hidden/layer marks. What a player may know of it, before fog.
 */
export function shownToPlayers(built: BuiltMap): BuiltMap {
  const keep = <T extends PieceShown>(list: T[]): T[] =>
    list
      .filter((x) => !pieceHidden(x, built.layers))
      .map((x) => {
        if (!('hidden' in x) && !('layer' in x)) return x
        const { hidden: _h, layer: _l, ...rest } = x
        return rest as T
      })
  return {
    floors: keep(built.floors),
    walls: keep(built.walls),
    objects: keep(built.objects),
    notes: [],
    ...(built.terrain?.length ? { terrain: keep(built.terrain) } : {})
  }
}

/**
 * 0.11.2: an app from before hidden pieces and layers saves a map without them. Keep what the game
 * master had: each piece (by id) keeps its hidden mark and layer, and the layer list stays.
 */
export function carryHidden(before: BuiltMap, after: BuiltMap): BuiltMap {
  const marks = new Map<string, PieceShown>()
  for (const list of [before.floors, before.walls, before.objects, before.notes, before.terrain ?? []] as PieceShown[][])
    for (const x of list as (PieceShown & { id: string })[]) if (x.hidden || x.layer) marks.set(x.id, { ...(x.hidden ? { hidden: true } : {}), ...(x.layer ? { layer: x.layer } : {}) })
  if (!marks.size && !before.layers?.length) return after
  const put = <T extends { id: string } & PieceShown>(list: T[]): T[] => list.map((x) => (marks.has(x.id) ? { ...x, ...marks.get(x.id) } : x))
  return {
    ...after,
    floors: put(after.floors),
    walls: put(after.walls),
    objects: put(after.objects),
    notes: put(after.notes),
    ...(after.terrain ? { terrain: put(after.terrain) } : {}),
    ...(before.layers?.length ? { layers: before.layers } : {})
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
  // 0.11.2: named map layers (at most 20) and each piece's hidden mark and layer
  const layers: MapLayer[] = []
  if (Array.isArray(o.layers))
    for (const v of o.layers.map(obj)) {
      const lid = id(v.id)
      const name = typeof v.name === 'string' ? v.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CAMPFIRE_LIMITS.mapLayerName) : ''
      if (!lid || !name || layers.some((l) => l.id === lid)) continue
      layers.push({ id: lid, name, ...(v.hidden === true ? { hidden: true as const } : {}) })
      if (layers.length >= CAMPFIRE_LIMITS.mapLayers) break
    }
  const shown = (v: Record<string, unknown>): PieceShown => {
    const layer = id(v.layer)
    return { ...(v.hidden === true ? { hidden: true as const } : {}), ...(layer && layers.some((l) => l.id === layer) ? { layer } : {}) }
  }
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
      return pts ? { id: id(v.id) ?? `fl${i}`, points: pts, material: word(v.material) ?? 'stone', ...shown(v) } : null
    }),
    walls: take(o.walls, (v, i) => {
      const pts = points(v.points, 2, 200)
      if (!pts) return null
      const door = obj(v.door)
      const state = door.state === 'open' || door.state === 'closed' || door.state === 'locked' ? door.state : null
      return { id: id(v.id) ?? `w${i}`, points: pts, ...(v.door && state ? { door: { state } } : {}), ...shown(v) }
    }),
    objects: take(o.objects, (v, i) => {
      const x = coord(v.x)
      const y = coord(v.y)
      const w = coord(v.w)
      const h = coord(v.h)
      if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) return null
      return { id: id(v.id) ?? `o${i}`, kind: word(v.kind) ?? 'crate', x, y, w, h, rotation: ((Math.round(coord(v.rotation) ?? 0) % 360) + 360) % 360, ...shown(v) }
    }),
    notes: take(o.notes, (v, i) => {
      const x = coord(v.x)
      const y = coord(v.y)
      const text = typeof v.text === 'string' ? v.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, CAMPFIRE_LIMITS.noteText) : ''
      return x === null || y === null || !text.trim() ? null : { id: id(v.id) ?? `n${i}`, x, y, text, ...shown(v) }
    }),
    // Round B: painted terrain (only sent when there is some, so older apps' maps don't change)
    ...(Array.isArray(o.terrain) && o.terrain.length
      ? {
          terrain: take(o.terrain, (v, i) => {
            const pts = points(v.points, 3, 200)
            const kind = v.kind === 'water' ? 'water' : v.kind === 'difficult' ? 'difficult' : null
            return pts && kind ? { id: id(v.id) ?? `t${i}`, kind, points: pts, ...shown(v) } : null
          })
        }
      : {}),
    ...(layers.length ? { layers } : {})
  }
}

// ───────────── Grid math (every app measures the same way) ─────────────

const SQRT3 = Math.sqrt(3)

/** Hexes are pointy-top: `size` is a hex's width, rows overlap by a quarter; odd rows shift right by half a hex. */
export const hexHeight = (size: number): number => (size * 2) / SQRT3

export function hexCenter(col: number, row: number, g: GridSettings): Point {
  const w = g.size
  const h = hexHeight(w)
  return [g.offsetX + col * w + w / 2 + (row % 2 !== 0 ? w / 2 : 0), g.offsetY + row * 0.75 * h + h / 2]
}

/** The hex (column, row) whose center is nearest a point. */
export function hexAt(x: number, y: number, g: GridSettings): [number, number] {
  const h = hexHeight(g.size)
  const row0 = Math.round((y - g.offsetY - h / 2) / (0.75 * h))
  let best: [number, number] = [0, row0]
  let bestD = Infinity
  for (let row = row0 - 1; row <= row0 + 1; row++) {
    const shift = row % 2 !== 0 ? g.size / 2 : 0
    const col0 = Math.round((x - g.offsetX - g.size / 2 - shift) / g.size)
    for (let col = col0 - 1; col <= col0 + 1; col++) {
      const c = hexCenter(col, row, g)
      const d = (c[0] - x) ** 2 + (c[1] - y) ** 2
      if (d < bestD) {
        bestD = d
        best = [col, row]
      }
    }
  }
  return best
}

export const nearestHexCenter = (x: number, y: number, g: GridSettings): Point => {
  const [c, r] = hexAt(x, y, g)
  return hexCenter(c, r, g)
}

/** Steps between two hexes (offset rows → cube coordinates). */
export function hexSteps(a: [number, number], b: [number, number]): number {
  const cube = ([col, row]: [number, number]): [number, number, number] => {
    const x = col - (row - (row & 1)) / 2
    return [x, row, -x - row]
  }
  const [ax, ay, az] = cube(a)
  const [bx, by, bz] = cube(b)
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz))
}

/**
 * How diagonals count on a square grid: '5' = every diagonal is one square (the 5e default),
 * '5-10' = every second diagonal counts double (the optional rule).
 */
export type DiagonalRule = '5' | '5-10'

/** Squares or hexes moved between two points (by the cells they fall in). */
export function cellsBetween(a: Point, b: Point, g: GridSettings, diagonal: DiagonalRule = '5'): number {
  if (g.type === 'hex') return hexSteps(hexAt(a[0], a[1], g), hexAt(b[0], b[1], g))
  const dx = Math.abs(Math.round((b[0] - a[0]) / g.size))
  const dy = Math.abs(Math.round((b[1] - a[1]) / g.size))
  if (diagonal === '5-10') {
    const diag = Math.min(dx, dy)
    return Math.max(dx, dy) - diag + diag + Math.floor(diag / 2)
  }
  return Math.max(dx, dy)
}

/** Feet between two points on this grid. */
export const gridFeet = (a: Point, b: Point, g: GridSettings, diagonal: DiagonalRule = '5'): number =>
  cellsBetween(a, b, g, diagonal) * g.feet

/**
 * A freehand line made into a fog shape: drops points closer than `minGap` px and evens it out
 * until it fits `max` points (the server keeps at most 200 per shape and 5,000 per scene). Null when it's too small.
 */
export function simplifyLasso(points: Point[], max = 64, minGap = 6): Point[] | null {
  let pts: Point[] = []
  for (const p of points) {
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minGap) pts.push([Math.round(p[0]), Math.round(p[1])])
  }
  if (pts.length > max) {
    const step = pts.length / max
    pts = Array.from({ length: max }, (_, i) => pts[Math.floor(i * step)])
  }
  if (pts.length < 3) return null
  // A sliver (no area to speak of) isn't a shape.
  let area = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1])
  return Math.abs(area) / 2 < 100 ? null : pts
}

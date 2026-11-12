// 0.11.2: working with built-map pieces in the map builder: selecting several, moving any piece
// (floors, walls and terrain too), resizing with handles, copy / paste, and hiding pieces from
// players. Pure helpers; Builder.tsx holds the state.

import type {
  BuiltMap,
  GridSettings,
  MapLayer,
  PieceShown,
  Point
} from '@glofly/shared/campfire/types'
import { pieceId } from './api'
import { snapCorner } from './geometry'

export type PieceKind = 'floors' | 'walls' | 'objects' | 'notes' | 'terrain'
export type PieceRef = { kind: PieceKind; id: string }
export type AnyPiece = {
  id: string
  points?: Point[]
  x?: number
  y?: number
  w?: number
  h?: number
} & PieceShown
export type Box = { x: number; y: number; w: number; h: number }
export type Handle = 'nw' | 'ne' | 'se' | 'sw'

export const PIECE_KINDS: readonly PieceKind[] = ['floors', 'walls', 'objects', 'notes', 'terrain']
const PREFIX: Record<PieceKind, string> = {
  floors: 'f',
  walls: 'w',
  objects: 'o',
  notes: 'n',
  terrain: 't'
}

export const listOf = (b: BuiltMap, k: PieceKind): AnyPiece[] => (b[k] ?? []) as AnyPiece[]
export const sameRef = (a: PieceRef, b: PieceRef): boolean => a.kind === b.kind && a.id === b.id
export const hasRef = (list: readonly PieceRef[], r: PieceRef): boolean =>
  list.some((x) => sameRef(x, r))
export const findPiece = (b: BuiltMap, r: PieceRef): AnyPiece | undefined =>
  listOf(b, r.kind).find((x) => x.id === r.id)

/** Only the pieces that still exist (after an undo, a delete…). */
export const existing = (b: BuiltMap, refs: readonly PieceRef[]): PieceRef[] =>
  refs.filter((r) => findPiece(b, r))

export function boxOf(p: AnyPiece, kind: PieceKind): Box {
  if (p.points?.length) {
    const xs = p.points.map((q) => q[0])
    const ys = p.points.map((q) => q[1])
    const x = Math.min(...xs)
    const y = Math.min(...ys)
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
  }
  if (kind === 'notes') return { x: (p.x ?? 0) - 14, y: (p.y ?? 0) - 14, w: 28, h: 28 }
  return { x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 0, h: p.h ?? 0 }
}

/** Where a piece's snapping is measured from: a room's or wall's first corner, an object's corner. */
const anchorOf = (p: AnyPiece): Point => (p.points?.length ? p.points[0] : [p.x ?? 0, p.y ?? 0])

export function translate(p: AnyPiece, dx: number, dy: number): AnyPiece {
  if (p.points)
    return {
      ...p,
      points: p.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as Point)
    }
  return { ...p, x: Math.round((p.x ?? 0) + dx), y: Math.round((p.y ?? 0) + dy) }
}

/** Moves the pieces by (dx, dy), snapped so the first one lands on the grid (unless free). */
export function moveDelta(
  b: BuiltMap,
  refs: readonly PieceRef[],
  dx: number,
  dy: number,
  g: GridSettings,
  free: boolean
): Point {
  const first = refs.map((r) => findPiece(b, r)).find(Boolean)
  if (!first || free) return [Math.round(dx), Math.round(dy)]
  const [ax, ay] = anchorOf(first)
  const [sx, sy] = snapCorner(ax + dx, ay + dy, g)
  return [sx - ax, sy - ay]
}

export function mapPieces(
  b: BuiltMap,
  refs: readonly PieceRef[],
  fn: (p: AnyPiece, kind: PieceKind) => AnyPiece | null
): BuiltMap {
  const out: BuiltMap = { ...b }
  for (const k of PIECE_KINDS) {
    if (!refs.some((r) => r.kind === k)) continue
    const list = listOf(b, k).flatMap((p) => {
      if (!hasRef(refs, { kind: k, id: p.id })) return [p]
      const next = fn(p, k)
      return next ? [next] : []
    })
    ;(out as Record<string, unknown>)[k] = list
  }
  return out
}

/** The new box when a corner handle is dragged to `to` (the opposite corner stays put). */
export function resizedBox(
  box: Box,
  handle: Handle,
  to: Point,
  g: GridSettings,
  free: boolean,
  min = 10
): Box {
  const [px, py] = free ? [Math.round(to[0]), Math.round(to[1])] : snapCorner(to[0], to[1], g)
  const fixX = handle === 'nw' || handle === 'sw' ? box.x + box.w : box.x
  const fixY = handle === 'nw' || handle === 'ne' ? box.y + box.h : box.y
  let x0 = Math.min(px, fixX)
  let x1 = Math.max(px, fixX)
  let y0 = Math.min(py, fixY)
  let y1 = Math.max(py, fixY)
  // A wall drawn straight across or down has no width (or height): only its length changes.
  if (box.w === 0) [x0, x1] = [box.x, box.x]
  else if (x1 - x0 < min) [x0, x1] = px < fixX ? [fixX - min, fixX] : [fixX, fixX + min]
  if (box.h === 0) [y0, y1] = [box.y, box.y]
  else if (y1 - y0 < min) [y0, y1] = py < fixY ? [fixY - min, fixY] : [fixY, fixY + min]
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** A piece stretched from its old box to a new one (objects get the box itself). */
export function resizePiece(p: AnyPiece, from: Box, to: Box): AnyPiece {
  if (p.points) {
    const sx = from.w ? to.w / from.w : 1
    const sy = from.h ? to.h / from.h : 1
    return {
      ...p,
      points: p.points.map(
        ([x, y]) =>
          [Math.round(to.x + (x - from.x) * sx), Math.round(to.y + (y - from.y) * sy)] as Point
      )
    }
  }
  return { ...p, x: to.x, y: to.y, w: Math.max(1, to.w), h: Math.max(1, to.h) }
}

/** Pieces whose box lies inside the rectangle a–b. */
export function piecesIn(b: BuiltMap, a: Point, c: Point, notes: boolean): PieceRef[] {
  const x0 = Math.min(a[0], c[0])
  const x1 = Math.max(a[0], c[0])
  const y0 = Math.min(a[1], c[1])
  const y1 = Math.max(a[1], c[1])
  const out: PieceRef[] = []
  for (const k of PIECE_KINDS) {
    if (k === 'notes' && !notes) continue
    for (const p of listOf(b, k)) {
      const box = boxOf(p, k)
      if (box.x >= x0 && box.y >= y0 && box.x + box.w <= x1 && box.y + box.h <= y1)
        out.push({ kind: k, id: p.id })
    }
  }
  return out
}

// ───── Copy and paste (kept for this session, so pieces can go to another scene too) ─────

let clipboard: { kind: PieceKind; piece: AnyPiece }[] = []
let pastes = 0

export function copyPieces(b: BuiltMap, refs: readonly PieceRef[]): number {
  clipboard = refs.flatMap((r) => {
    const p = findPiece(b, r)
    return p ? [{ kind: r.kind, piece: structuredClone(p) }] : []
  })
  pastes = 0
  return clipboard.length
}

export const clipboardSize = (): number => clipboard.length

/**
 * Adds the copied pieces again, one grid cell further along each time (down and right), with new
 * ids. A layer that isn't on this map is dropped (the piece goes on the base map).
 */
export function pastePieces(
  b: BuiltMap,
  g: GridSettings
): { built: BuiltMap; added: PieceRef[] } | null {
  if (!clipboard.length) return null
  pastes++
  const step = g.size * pastes
  const layers: readonly MapLayer[] = b.layers ?? []
  const out: BuiltMap = { ...b }
  const added: PieceRef[] = []
  for (const { kind, piece } of clipboard) {
    const moved = translate(structuredClone(piece), step, step)
    const id = pieceId(PREFIX[kind])
    const next: AnyPiece = { ...moved, id }
    if (next.layer && !layers.some((l) => l.id === next.layer)) delete next.layer
    ;(out as Record<string, unknown>)[kind] = [...listOf(out, kind), next]
    added.push({ kind, id })
  }
  return { built: out, added }
}

/** Every piece hidden from players, with a name for the list ("Chest", "Stone room", "Door"). */
export function describe(p: AnyPiece, kind: PieceKind, label: (k: string) => string): string {
  const any = p as AnyPiece & { kind?: string; material?: string; door?: unknown }
  if (kind === 'objects') return label(any.kind ?? 'Object')
  if (kind === 'floors') return `${label(any.material ?? 'stone')} room`
  if (kind === 'walls') return any.door ? 'Door' : 'Wall'
  if (kind === 'terrain') return any.kind === 'water' ? 'Water' : 'Difficult terrain'
  return 'Note'
}

/** A copy without some keys (a piece without its hidden mark, a layer without `hidden`…). */
export function omit<T extends object, K extends keyof T>(x: T, ...keys: K[]): Omit<T, K> {
  const out = { ...x }
  for (const k of keys) delete out[k]
  return out
}

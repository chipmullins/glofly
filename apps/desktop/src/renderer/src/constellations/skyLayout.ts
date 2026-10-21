import type { ConstellationDetail, Nebula, NebulaStar } from '../../../preload/api-types'

// 0.7.5 living sky (canvas board 4, approved): each nebula is a star in its constellation's sky, in
// the sidebar's order, so every constellation's sky has its own shape. Pure helpers (no React).

/** The most stars a sky draws (more nebulas than this: the rest aren't drawn). */
export const SKY_MAX = 14

export type SkyPoint = { x: number; y: number }

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A small seeded random number source (0 ≤ x < 1). */
function seeded(seed: number): () => number {
  let a = seed || 1
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Where each star sits, in percent of the sky (x 8–90, y 18–68): spread left to right in order,
 * zig-zagging up and down like the board (10/24, 24/58, 42/34, 58/64, 72/26, 86/62 for six).
 */
export function skyPoints(id: string, count: number): SkyPoint[] {
  const n = Math.min(count, SKY_MAX)
  if (n <= 0) return []
  const rnd = seeded(hash(id))
  const out: SkyPoint[] = []
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    const x = 10 + t * 76 + (rnd() - 0.5) * (n > 8 ? 3 : 6)
    const high = i % 2 === 0
    const y = high ? 22 + rnd() * 14 : 52 + rnd() * 14
    out.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
  }
  return out
}

/** The lines joining the stars: one after another, plus a branch or two (seeded by its id). */
export function skyLines(id: string, count: number): [number, number][] {
  const n = Math.min(count, SKY_MAX)
  const lines: [number, number][] = []
  for (let i = 0; i + 1 < n; i++) lines.push([i, i + 1])
  if (n >= 4) {
    const rnd = seeded(hash(`${id}:lines`))
    const a = Math.floor(rnd() * (n - 2))
    lines.push([a, a + 2])
    if (n >= 7) {
      const b = Math.floor(rnd() * (n - 3))
      if (b !== a) lines.push([b, b + 3])
    }
  }
  return lines
}

/** A few stars are a warmer gold (like the board's game-night-plans and looking-for-group). */
export const isGoldStar = (id: string, i: number): boolean => hash(`${id}:${i}`) % 3 === 0

/** The nebulas in the sidebar's order: ones outside a category first, then each category's. */
export function sidebarOrder(c: Pick<ConstellationDetail, 'categories' | 'nebulas'>): Nebula[] {
  const cats = [...c.categories].sort((a, b) => a.position - b.position)
  const known = new Set(cats.map((x) => x.id))
  const byPos = (a: Nebula, b: Nebula): number => a.position - b.position
  return [
    ...c.nebulas.filter((n) => !n.categoryId || !known.has(n.categoryId)).sort(byPos),
    ...cats.flatMap((cat) => c.nebulas.filter((n) => n.categoryId === cat.id).sort(byPos))
  ]
}

/** A star as the sky draws it. */
export type SkyStar = NebulaStar & { key: string; label: string }

/** The open constellation's stars (the current nebula never shows news: you're reading it). */
export function starsOf(
  c: Pick<ConstellationDetail, 'categories' | 'nebulas' | 'voice' | 'me'>,
  currentId: string | null
): SkyStar[] {
  return sidebarOrder(c).map((n) => {
    const level = n.notify ?? c.me.notify
    const news =
      n.kind === 'text' &&
      n.id !== currentId &&
      (n.mentionCount > 0 || (n.unreadCount > 0 && level !== 'none'))
    return {
      key: n.id,
      label: n.name,
      kind: n.kind,
      news,
      chatting: n.kind === 'text' && (n.chatting ?? 0) >= 2,
      voice: c.voice.find((v) => v.nebulaId === n.id)?.userIds.length ?? 0
    }
  })
}

/** Calm by design: at most one shooting star every this long per constellation. */
export const SHOOTING_STAR_GAP_MS = 30_000

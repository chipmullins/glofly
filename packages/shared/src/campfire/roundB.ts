// Campfire Round B (Nov 2026): movement (speed, Dash, difficult terrain, undo, height), the game
// master's screen (encounter difficulty, legendary actions, timed conditions) and the sound board.
// Pure helpers: the server enforces movement with the same math the apps show.

import type { BuiltTerrain, GridSettings, MonsterInfo, Point, Sheet5e } from './types'
import { hexAt, hexSteps, pointInPolygon, type DiagonalRule } from './map'

// ───────────── Movement ─────────────

/** Conditions that leave a creature unable to move (5e). */
export const NO_MOVE_CONDITIONS = ['grappled', 'restrained', 'paralyzed', 'petrified', 'stunned', 'unconscious'] as const

/** A creature's walking speed this turn (0 when a condition holds it in place). */
export function speedFor(sheet: Pick<Sheet5e, 'speed'> | null, conditions: readonly string[] = []): number {
  const lower = conditions.map((c) => c.toLowerCase())
  if (NO_MOVE_CONDITIONS.some((c) => lower.includes(c))) return 0
  const s = sheet?.speed
  return typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.min(500, Math.round(s))) : 30
}

/** How far it may move this turn: its speed, twice with Dash. */
export const moveBudget = (speed: number, dashed: boolean): number => speed * (dashed ? 2 : 1)

const terrainAt = (p: Point, terrain: readonly BuiltTerrain[]): boolean => terrain.some((t) => pointInPolygon(p, t.points))

/**
 * Feet a path costs: square by square (5e: a diagonal square costs the same as a straight one,
 * or 5/10/5 with the variant rule), hex by hex on hex grids. A square inside painted terrain
 * (difficult or water) costs double. `points` are the start, any turns, and the end.
 */
export function pathCost(points: readonly Point[], g: GridSettings, terrain: readonly BuiltTerrain[] = [], diagonal: DiagonalRule = '5'): number {
  if (points.length < 2) return 0
  let feet = 0
  let diagonals = 0
  const per = g.feet > 0 ? g.feet : 5
  for (let s = 1; s < points.length; s++) {
    const a = points[s - 1]
    const b = points[s]
    if (g.type === 'hex') {
      const ha = hexAt(a[0], a[1], g)
      const hb = hexAt(b[0], b[1], g)
      const n = hexSteps(ha, hb)
      for (let k = 1; k <= n; k++) {
        const p: Point = [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]
        feet += per * (terrainAt(p, terrain) ? 2 : 1)
      }
      continue
    }
    const cell = (v: number, off: number) => Math.floor((v - off) / g.size)
    let cx = cell(a[0], g.offsetX)
    let cy = cell(a[1], g.offsetY)
    const tx = cell(b[0], g.offsetX)
    const ty = cell(b[1], g.offsetY)
    // Guard: a huge jump is priced without walking every square.
    const steps = Math.max(Math.abs(tx - cx), Math.abs(ty - cy))
    if (steps > 2000) return Number.MAX_SAFE_INTEGER
    while (cx !== tx || cy !== ty) {
      const sx = Math.sign(tx - cx)
      const sy = Math.sign(ty - cy)
      const diag = sx !== 0 && sy !== 0
      cx += sx
      cy += sy
      const centre: Point = [g.offsetX + (cx + 0.5) * g.size, g.offsetY + (cy + 0.5) * g.size]
      let step = per
      if (diag && diagonal === '5-10') {
        diagonals++
        if (diagonals % 2 === 0) step = per * 2
      }
      feet += step * (terrainAt(centre, terrain) ? 2 : 1)
    }
  }
  return feet
}

/** Distance with height (5e on a grid: the longer of across and up). */
export const withHeight = (flatFt: number, heightFt: number): number => Math.max(flatFt, Math.abs(heightFt))

/** A creature's reach in feet from its sheet's melee attacks ("reach 10 ft"), 5 by default. */
export function reachOf(sheet: Pick<Sheet5e, 'attacks' | 'monster'> | null): number {
  let best = 5
  for (const a of sheet?.attacks ?? []) {
    const m = /reach\s+(\d+)\s*f/i.exec(`${a.range} ${a.notes}`)
    if (m) best = Math.max(best, Number(m[1]))
  }
  for (const a of sheet?.monster?.actions ?? []) {
    const m = /reach\s+(\d+)\s*f/i.exec(a.text)
    if (m) best = Math.max(best, Number(m[1]))
  }
  return Math.min(best, 30)
}

// ───────────── Timed conditions ─────────────

/**
 * Start of a creature's turn: every timed condition loses a round; ones that reach 0 come off.
 * Conditions without a timer stay as they are.
 */
export function tickConditions(conditions: readonly string[], timers: Readonly<Record<string, number>>): { conditions: string[]; timers: Record<string, number>; ended: string[] } {
  const next: Record<string, number> = {}
  const ended: string[] = []
  for (const [c, n] of Object.entries(timers)) {
    if (!conditions.includes(c)) continue
    if (n <= 1) ended.push(c)
    else next[c] = n - 1
  }
  return { conditions: conditions.filter((c) => !ended.includes(c)), timers: next, ended }
}

export function normalizeTimers(raw: unknown, conditions: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!conditions.includes(k)) continue
    const n = typeof v === 'number' ? Math.round(v) : NaN
    if (n >= 1 && n <= 100) out[k] = n
  }
  return out
}

// ───────────── Legendary actions ─────────────

export type LegendaryInfo = { perRound: number; options: { name: string; cost: number }[] }

/** "The dragon can take 3 legendary actions…" and each option's cost ("Wing Attack (Costs 2 Actions)"). */
export function legendaryInfo(monster: Pick<MonsterInfo, 'legendary' | 'traits'> | null | undefined): LegendaryInfo | null {
  const list = monster?.legendary ?? []
  if (!list.length) return null
  const all = [...list, ...(monster?.traits ?? [])].map((f) => `${f.name} ${f.text}`).join(' ')
  const per = /can take (\d+) legendary actions?/i.exec(all)
  const options = list
    .filter((f) => !/legendary actions?$/i.test(f.name.trim()) || !/can take/i.test(f.text))
    .map((f) => {
      const c = /\(costs? (\d+) actions?\)/i.exec(f.name) ?? /\(costs? (\d+) actions?\)/i.exec(f.text)
      return { name: f.name.replace(/\s*\(costs? \d+ actions?\)/i, '').trim(), cost: c ? Number(c[1]) : 1 }
    })
    .filter((o) => o.name)
  return { perRound: per ? Number(per[1]) : 3, options }
}

// ───────────── Encounter difficulty ─────────────

/** XP budget per character level (low, moderate, high), System Reference Document 5.2. */
export const XP_BUDGET_2024: readonly [number, number, number][] = [
  [50, 75, 100], [100, 150, 200], [150, 225, 400], [250, 375, 500], [500, 750, 1100],
  [600, 1000, 1400], [750, 1300, 1700], [1000, 1700, 2100], [1300, 2000, 2600], [1600, 2300, 3100],
  [1900, 2900, 4100], [2200, 3700, 4700], [2600, 4200, 5400], [2900, 4900, 6200], [3300, 5400, 7800],
  [3800, 6100, 9800], [4500, 7200, 11700], [5000, 8700, 14200], [5500, 10700, 17200], [6400, 13200, 22000]
]

export type EncounterDifficulty = {
  /** The monsters' XP added up */
  xp: number
  label: string
  /** The party's thresholds in order, with labels */
  thresholds: { label: string; xp: number }[]
}

/**
 * How hard a fight is for the party, by the System Reference Document 5.2's XP budget (used for
 * both rule sets: monsters' XP by challenge rating is the same in each).
 */
export function encounterDifficulty(levels: readonly number[], monsterXp: readonly number[]): EncounterDifficulty {
  const lv = levels.map((l) => Math.max(1, Math.min(20, Math.round(l))))
  const xp = monsterXp.reduce((n, x) => n + Math.max(0, x), 0)
  const t = [0, 1, 2].map((k) => lv.reduce((n, l) => n + XP_BUDGET_2024[l - 1][k], 0))
  const thresholds = [
    { label: 'Low', xp: t[0] },
    { label: 'Moderate', xp: t[1] },
    { label: 'High', xp: t[2] }
  ]
  const label = xp === 0 ? 'Nothing yet' : xp > t[2] ? 'Beyond high' : xp > t[1] ? 'High' : xp > t[0] ? 'Moderate' : 'Low'
  return { xp, label, thresholds }
}

// ───────────── Sound board ─────────────

/** Built-in sounds (made by Glofly: tools/sounds/campfire.mjs), played from each app's own files. */
export const BUILTIN_SOUNDS = [
  { id: 'bell', name: 'Bell toll' },
  { id: 'chime', name: 'Magic chime' },
  { id: 'thunder', name: 'Thunder' },
  { id: 'heartbeat', name: 'Heartbeat' },
  { id: 'coins', name: 'Coins' },
  { id: 'drum', name: 'War drum' },
  { id: 'gong', name: 'Gong' },
  { id: 'whoosh', name: 'Whoosh' },
  { id: 'door', name: 'Door knock' }
] as const
export type BuiltinSound = (typeof BUILTIN_SOUNDS)[number]['id']
export const isBuiltinSound = (x: unknown): x is BuiltinSound => typeof x === 'string' && BUILTIN_SOUNDS.some((s) => s.id === x)

/** Common condition durations GMs pick from. */
export const CONDITION_ROUNDS = [1, 2, 3, 5, 10, 100] as const

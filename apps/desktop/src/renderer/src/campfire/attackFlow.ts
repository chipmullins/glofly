import type { GridSettings, SheetAttack, Token } from '@glofly/shared/campfire/types'

// 0.11.3 (Chip: "click the weapon you want to use, then the token you want to attack, and then it
// does the roll, if it's in range"): an attack picked on a sheet, a stat block or a token card
// waits ("armed") for a click on its target; the table checks the distance before rolling.

export type ArmedAttack = {
  attackerId: string
  name: string
  reach: AttackReach
  /** Rolls it against the target (dis: past normal range, so disadvantage) */
  fire: (target: Token, dis: boolean) => Promise<void>
}

/** In feet: melee reach, and the normal / long range of a ranged (or thrown) attack. */
export type AttackReach = { melee: number | null; normal: number | null; long: number | null }

export function reachOfAttack(a: Pick<SheetAttack, 'kind' | 'range'>): AttackReach {
  const text = (a.range || '').toLowerCase()
  const pair = /(\d+)\s*\/\s*(\d+)/.exec(text)
  const reach = /reach\s*(\d+)/.exec(text)
  const one = /(\d+)/.exec(text)
  if (a.kind === 'melee') {
    const melee = reach ? Number(reach[1]) : pair ? 5 : one ? Number(one[1]) : 5
    return { melee, normal: pair ? Number(pair[1]) : null, long: pair ? Number(pair[2]) : null }
  }
  if (/touch/.test(text)) return { melee: 5, normal: null, long: null }
  if (pair) return { melee: null, normal: Number(pair[1]), long: Number(pair[2]) }
  if (one) return { melee: null, normal: Number(one[1]), long: Number(one[1]) }
  // No range written (a spell attack, a custom one): anywhere on the map.
  return { melee: null, normal: Infinity, long: Infinity }
}

/** 5e distance between two tokens: squares between their nearest edges (adjacent = 5 ft). */
export function tokenDistanceFt(
  a: Token,
  b: Token,
  g: Pick<GridSettings, 'size' | 'feet'>
): number {
  const size = g.size || 70
  const gapX = Math.max(0, b.x - (a.x + a.w * size), a.x - (b.x + b.w * size)) / size
  const gapY = Math.max(0, b.y - (a.y + a.h * size), a.y - (b.y + b.h * size)) / size
  return (Math.round(Math.max(gapX, gapY)) + 1) * (g.feet || 5)
}

export type RangeCheck = { ok: true; dis: boolean } | { ok: false; why: string }

export function checkRange(
  reach: AttackReach,
  attacker: Token,
  target: Token,
  g: Pick<GridSettings, 'size' | 'feet'>,
  name: string
): RangeCheck {
  const ft = tokenDistanceFt(attacker, target, g)
  if (reach.melee !== null && ft <= reach.melee) return { ok: true, dis: false }
  if (reach.normal !== null && ft <= reach.normal) return { ok: true, dis: false }
  if (reach.long !== null && ft <= reach.long) return { ok: true, dis: true }
  return {
    ok: false,
    why: `Out of range: ${target.name || 'that token'} is ${ft} ft away (${name}: ${reachText(reach)}).`
  }
}

export function reachText(r: AttackReach): string {
  const parts: string[] = []
  if (r.melee !== null) parts.push(`reach ${r.melee} ft`)
  if (r.normal !== null && Number.isFinite(r.normal))
    parts.push(
      r.long !== null && r.long !== r.normal
        ? `range ${r.normal}/${r.long} ft`
        : `range ${r.normal} ft`
    )
  return parts.join(', ') || 'any distance'
}

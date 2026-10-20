import type { ConstellationDetail } from '../../../preload/api-types'

// 0.7.5 smooth reordering (canvas board 10, approved): drag nebulas and categories right in the
// sidebar. Pure helpers: the sidebar as one list, moving a row in it, and what to save.

/** The sidebar's rows top to bottom: categories and nebulas (nebulas before any category are loose). */
export type Row =
  { kind: 'cat'; id: string } | { kind: 'neb'; id: string; categoryId: string | null }

export type Layout = {
  /** Every category, in order (ones with no nebulas too) */
  categories: string[]
  /** Every nebula in order, with its category */
  nebulas: { id: string; categoryId: string | null }[]
}

export function layoutOf(c: Pick<ConstellationDetail, 'categories' | 'nebulas'>): Layout {
  const cats = [...c.categories].sort((a, b) => a.position - b.position).map((x) => x.id)
  const known = new Set(cats)
  const byPos = <T extends { position: number }>(a: T, b: T): number => a.position - b.position
  const loose = c.nebulas
    .filter((n) => !n.categoryId || !known.has(n.categoryId))
    .sort(byPos)
    .map((n) => ({ id: n.id, categoryId: null }))
  const inCats = cats.flatMap((cat) =>
    c.nebulas
      .filter((n) => n.categoryId === cat)
      .sort(byPos)
      .map((n) => ({ id: n.id, categoryId: cat }))
  )
  return { categories: cats, nebulas: [...loose, ...inCats] }
}

/** The rows the sidebar draws (categories with no nebulas aren't drawn, as in 0.7.1). */
export function rowsOf(layout: Layout): Row[] {
  const rows: Row[] = layout.nebulas
    .filter((n) => n.categoryId === null)
    .map((n) => ({ kind: 'neb' as const, id: n.id, categoryId: null }))
  for (const cat of layout.categories) {
    const inIt = layout.nebulas.filter((n) => n.categoryId === cat)
    if (!inIt.length) continue
    rows.push({ kind: 'cat', id: cat })
    for (const n of inIt) rows.push({ kind: 'neb', id: n.id, categoryId: cat })
  }
  return rows
}

/** Rows back into a layout (empty categories keep their place after the drawn ones). */
export function layoutFromRows(rows: Row[], before: Layout): Layout {
  const drawnCats = rows.filter((r) => r.kind === 'cat').map((r) => r.id)
  const hiddenCats = before.categories.filter((id) => !drawnCats.includes(id))
  let cat: string | null = null
  const nebulas: Layout['nebulas'] = []
  for (const r of rows) {
    if (r.kind === 'cat') cat = r.id
    else nebulas.push({ id: r.id, categoryId: cat })
  }
  // Nebulas the rows didn't include (none expected) keep theirs, at the end.
  for (const n of before.nebulas) if (!nebulas.some((x) => x.id === n.id)) nebulas.push(n)
  return { categories: [...drawnCats, ...hiddenCats], nebulas }
}

/**
 * Moves a nebula so it lands before row `beforeIndex` of `rows` (rows.length = the very end). It
 * joins the category of the nearest category row above where it lands (none: loose at the top).
 */
export function moveNebula(rows: Row[], nebulaId: string, beforeIndex: number): Row[] {
  const from = rows.findIndex((r) => r.kind === 'neb' && r.id === nebulaId)
  if (from < 0) return rows
  const without = rows.filter((_, i) => i !== from)
  const at = Math.max(
    0,
    Math.min(without.length, beforeIndex > from ? beforeIndex - 1 : beforeIndex)
  )
  const out = [
    ...without.slice(0, at),
    { kind: 'neb' as const, id: nebulaId, categoryId: null },
    ...without.slice(at)
  ]
  let cat: string | null = null
  return out.map((r) => {
    if (r.kind === 'cat') {
      cat = r.id
      return r
    }
    return { ...r, categoryId: cat }
  })
}

/**
 * Moves a category (with its nebulas) so it lands before the category at `beforeCat` (null = the
 * end). Loose nebulas always stay at the top.
 */
export function moveCategory(rows: Row[], catId: string, beforeCat: string | null): Row[] {
  const groups: { id: string | null; rows: Row[] }[] = []
  for (const r of rows) {
    if (r.kind === 'cat') groups.push({ id: r.id, rows: [r] })
    else if (!groups.length || groups[groups.length - 1].id === null) {
      if (!groups.length) groups.push({ id: null, rows: [] })
      groups[groups.length - 1].rows.push(r)
    } else groups[groups.length - 1].rows.push(r)
  }
  const moving = groups.find((g) => g.id === catId)
  if (!moving || beforeCat === catId) return rows
  const rest = groups.filter((g) => g !== moving)
  const at = beforeCat === null ? rest.length : rest.findIndex((g) => g.id === beforeCat)
  if (at < 0) return rows
  // Never above the loose nebulas.
  const firstCat = rest.findIndex((g) => g.id !== null)
  const where = firstCat >= 0 ? Math.max(at, firstCat) : at
  rest.splice(where, 0, moving)
  return rest.flatMap((g) => g.rows)
}

/** One step up or down for the keyboard (Alt+Shift+↑/↓ on a focused nebula). */
export function stepNebula(rows: Row[], nebulaId: string, dir: -1 | 1): Row[] {
  const i = rows.findIndex((r) => r.kind === 'neb' && r.id === nebulaId)
  if (i < 0) return rows
  // Up: land before the row above (past a category header, into the category above). Down:
  // land after the row below.
  const target = dir < 0 ? i - 1 : i + 2
  if (target < 0 || target > rows.length) return rows
  return moveNebula(rows, nebulaId, target)
}

export const sameRows = (a: Row[], b: Row[]): boolean =>
  a.length === b.length &&
  a.every(
    (r, i) =>
      r.kind === b[i].kind &&
      r.id === b[i].id &&
      (r.kind === 'cat' || (b[i] as { categoryId: string | null }).categoryId === r.categoryId)
  )

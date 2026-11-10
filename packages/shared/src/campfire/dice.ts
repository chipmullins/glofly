// Campfire dice: Roll20-style roll expressions, parsed and rolled the same way everywhere.
// The server rolls every roll that counts (with crypto randomness); apps use this to check what
// someone typed and to show results. The random source is passed in, so tests can use a seeded one.
//
// Grammar (case-insensitive, spaces ignored):
//   terms joined by + and -, with * and / (rounded down) binding tighter, and ( … ) groups
//   NdS (N 1–100, default 1; S 2–1000), d% (= d100), dF (Fudge: −1, 0, +1), plain numbers
//   after a dice term, in any order: khN klN (keep highest/lowest), dhN dlN (drop), ! (explode on
//     max) or !>=N / !>N / !=N, rN r<N r>N r<=N r>=N (reroll while it matches), roN … (once),
//     >=N >N <N <=N (count successes), minN maxN (clamp each die)
//   adv = 2d20kh1, dis = 2d20kl1, and [[…]] around the whole roll (inline rolls in chat text)
//   labels: [Stealth] after a term, and anything after # for the whole roll

import type { RollDie, RollResult, RollTerm } from './types'

export const DICE_MAX_LENGTH = 200
export const DICE_MAX_DICE = 100
export const DICE_MAX_TERMS = 20
export const DICE_MAX_REROLLS = 100
export const DICE_MAX_EXPLOSIONS = 100
const LABEL_MAX = 100
const NUMBER_MAX = 1_000_000
const TOTAL_MAX = 1_000_000_000

type Compare = { op: '>=' | '>' | '<=' | '<' | '='; n: number }
type DiceMods = {
  keep?: { high: boolean; n: number }
  drop?: { high: boolean; n: number }
  explode?: Compare
  reroll?: Compare & { once: boolean }
  success?: Compare
  min?: number
  max?: number
}

export type DiceNode =
  | { t: 'num'; v: number; label: string | null }
  | { t: 'dice'; count: number; sides: number | 'F'; mods: DiceMods; notation: string; label: string | null }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: DiceNode; b: DiceNode }
  | { t: 'neg'; a: DiceNode }
  | { t: 'group'; a: DiceNode; label: string | null }

/** A roll that parsed: roll it with rollDice. */
export type DiceExpr = {
  /** Cleaned up ("1d20+7") */
  expression: string
  label: string | null
  root: DiceNode
  dice: number
  terms: number
}

export type DiceParse = { ok: true; expr: DiceExpr } | { ok: false; error: string }

/** A random number in [0, 1), like Math.random. */
export type DiceRng = () => number

class DiceError extends Error {}
const fail = (message: string): never => {
  throw new DiceError(message)
}

const cleanLabel = (s: string): string | null => {
  const t = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, LABEL_MAX) : null
}

/** Reads a roll expression. Errors are friendly sentences the apps can show as they are. */
export function parseDice(text: string): DiceParse {
  if (typeof text !== 'string') return { ok: false, error: 'Type a roll, like 1d20+5.' }
  if (text.length > DICE_MAX_LENGTH) return { ok: false, error: `Rolls can be up to ${DICE_MAX_LENGTH} characters.` }
  let src = text.trim()
  const inline = /^\[\[([\s\S]*)\]\]$/.exec(src)
  if (inline) src = inline[1].trim()
  // "#sneaky": the rest is the roll's label (outside any [brackets]).
  let label: string | null = null
  let depth = 0
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '[') depth++
    else if (c === ']') depth = Math.max(0, depth - 1)
    else if (c === '#' && depth === 0) {
      label = cleanLabel(src.slice(i + 1))
      src = src.slice(0, i)
      break
    }
  }
  if (!src.trim()) return { ok: false, error: 'Type a roll, like 1d20+5.' }
  try {
    const p = new Parser(src)
    const root = p.expr()
    p.end()
    if (p.terms > DICE_MAX_TERMS) fail(`Rolls can have up to ${DICE_MAX_TERMS} parts.`)
    if (p.dice > DICE_MAX_DICE) fail(`That's more than ${DICE_MAX_DICE} dice. Try fewer.`)
    if (bound(root) > TOTAL_MAX) fail('That roll could get too big. Try smaller numbers.')
    // With no "#label", a single [label] names the whole roll.
    if (!label && p.labels.length === 1) label = p.labels[0]
    return { ok: true, expr: { expression: show(root), label, root, dice: p.dice, terms: p.terms } }
  } catch (err) {
    if (err instanceof DiceError) return { ok: false, error: err.message }
    throw err
  }
}

class Parser {
  i = 0
  dice = 0
  terms = 0
  labels: string[] = []
  constructor(private readonly s: string) {}

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++
  }
  private peek(n = 1): string {
    this.ws()
    return this.s.slice(this.i, this.i + n).toLowerCase()
  }
  private take(word: string): boolean {
    if (this.peek(word.length) === word) {
      this.i += word.length
      return true
    }
    return false
  }
  private int(): number | null {
    this.ws()
    const m = /^\d+/.exec(this.s.slice(this.i))
    if (!m) return null
    this.i += m[0].length
    if (m[0].length > 7) fail('That number is too big for a roll.')
    return Number(m[0])
  }
  private needInt(what: string): number {
    const n = this.int()
    if (n === null) fail(`${what} needs a number after it.`)
    return n as number
  }

  end(): void {
    this.ws()
    if (this.i < this.s.length) fail(`I couldn't read “${this.s.slice(this.i, this.i + 12).trim()}” in that roll.`)
  }

  expr(): DiceNode {
    let a = this.term()
    for (;;) {
      const c = this.peek()
      if (c !== '+' && c !== '-') return a
      this.i++
      a = { t: 'bin', op: c, a, b: this.term() }
    }
  }

  private term(): DiceNode {
    let a = this.factor()
    for (;;) {
      const c = this.peek()
      if (c !== '*' && c !== '/') return a
      this.i++
      const b = this.factor()
      if (c === '/' && b.t === 'num' && b.v === 0) fail("You can't divide by zero.")
      a = { t: 'bin', op: c, a, b }
    }
  }

  private factor(): DiceNode {
    const c = this.peek()
    if (c === '-') {
      this.i++
      return { t: 'neg', a: this.factor() }
    }
    if (c === '+') {
      this.i++
      return this.factor()
    }
    if (c === '(') {
      this.i++
      const a = this.expr()
      if (this.peek() !== ')') fail('A bracket ( is missing its ).')
      this.i++
      return { t: 'group', a, label: this.label() }
    }
    if (c === '') fail('That roll ends too soon. Add a number or dice after the + or −.')
    if (this.take('adv') || this.take('dis')) {
      const high = this.s.slice(this.i - 3, this.i).toLowerCase() === 'adv'
      return this.diceNode(2, 20, { keep: { high, n: 1 } })
    }
    const n = this.int()
    if (this.peek() === 'd' && !/^d[hl]/.test(this.peek(2))) {
      this.i++
      return this.diceTerm(n)
    }
    if (n === null) fail(`I couldn't read “${this.s.slice(this.i, this.i + 12).trim()}” in that roll.`)
    if ((n as number) > NUMBER_MAX) fail('That number is too big for a roll.')
    this.terms++
    return { t: 'num', v: n as number, label: this.label() }
  }

  private label(): string | null {
    if (this.peek() !== '[') return null
    const close = this.s.indexOf(']', this.i)
    if (close < 0) fail('A label [ is missing its ].')
    const label = cleanLabel(this.s.slice(this.i + 1, close))
    this.i = close + 1
    if (label) this.labels.push(label)
    return label
  }

  private compare(): Compare | null {
    for (const op of ['>=', '<=', '>', '<', '='] as const) {
      if (this.take(op)) return { op, n: this.needInt(`“${op}”`) }
    }
    const n = this.int()
    return n === null ? null : { op: '=', n }
  }

  private diceTerm(countRaw: number | null): DiceNode {
    const count = countRaw ?? 1
    let sides: number | 'F'
    if (this.take('%')) sides = 100
    else if (this.take('f')) sides = 'F'
    else {
      const s = this.int()
      if (s === null) fail('Dice need a number of sides, like d20.')
      sides = s as number
    }
    if (count < 1 || count > DICE_MAX_DICE) fail(`You can roll 1 to ${DICE_MAX_DICE} dice at once.`)
    if (sides !== 'F' && (sides < 2 || sides > 1000)) fail('Dice can have 2 to 1000 sides.')
    const mods: DiceMods = {}
    const once = (key: keyof DiceMods) => {
      if (mods[key] !== undefined) fail('Use each modifier once per dice roll.')
    }
    for (;;) {
      const two = this.peek(2)
      if (two === 'kh' || two === 'kl' || two === 'dh' || two === 'dl') {
        this.i += 2
        const key = two[0] === 'k' ? 'keep' : 'drop'
        once('keep')
        once('drop')
        mods[key] = { high: two[1] === 'h', n: this.int() ?? 1 }
      } else if (two === 'mi' && this.take('min')) {
        once('min')
        mods.min = this.needInt('“min”')
      } else if (two === 'ma' && this.take('max')) {
        once('max')
        mods.max = this.needInt('“max”')
      } else if (two[0] === 'k') {
        this.i++
        once('keep')
        mods.keep = { high: true, n: this.int() ?? 1 }
      } else if (two[0] === 'd' && /^\d/.test(this.s.slice(this.i + 1))) {
        // 4d6d1: drop the lowest
        this.i++
        once('drop')
        once('keep')
        mods.drop = { high: false, n: this.needInt('“d”') }
      } else if (two[0] === '!') {
        this.i++
        once('explode')
        mods.explode = this.compare() ?? { op: '=', n: sides === 'F' ? 1 : sides }
      } else if (two === 'ro') {
        this.i += 2
        once('reroll')
        const c = this.compare()
        if (!c) fail('“ro” needs a number after it, like ro1.')
        mods.reroll = { ...(c as Compare), once: true }
      } else if (two[0] === 'r') {
        this.i++
        once('reroll')
        const c = this.compare()
        if (!c) fail('“r” needs a number after it, like r1.')
        mods.reroll = { ...(c as Compare), once: false }
      } else if (two[0] === '>' || two[0] === '<' || two[0] === '=') {
        once('success')
        mods.success = this.compare() as Compare
      } else break
    }
    const faces = facesOf(sides)
    const lo = faces[0]
    const hi = faces[faces.length - 1]
    if (mods.min !== undefined && mods.max !== undefined && mods.min > mods.max) fail('“min” must be smaller than “max”.')
    if ((mods.min !== undefined && (mods.min < lo || mods.min > hi)) || (mods.max !== undefined && (mods.max < lo || mods.max > hi)))
      fail('“min” and “max” must be numbers the dice can roll.')
    // What a die can show after clamping (comparisons are one-sided, so the ends are enough).
    const left = sides === 'F' ? faces.filter((f) => f >= (mods.min ?? lo) && f <= (mods.max ?? hi)) : [mods.min ?? lo, mods.max ?? hi]
    if (mods.reroll && !mods.reroll.once && faces.every((f) => matches(f, mods.reroll!))) fail('That reroll would never stop.')
    if (mods.explode && left.every((f) => matches(f, mods.explode!))) fail('Those dice would explode forever.')
    const k = mods.keep ?? mods.drop
    if (k && k.n > count) fail(mods.keep ? "You can't keep more dice than you roll." : "You can't drop more dice than you roll.")
    return this.diceNode(count, sides, mods)
  }

  private diceNode(count: number, sides: number | 'F', mods: DiceMods): DiceNode {
    this.dice += count
    this.terms++
    return { t: 'dice', count, sides, mods, notation: notationOf(count, sides, mods), label: this.label() }
  }
}

const cmpText = (c: Compare) => (c.op === '=' ? String(c.n) : `${c.op}${c.n}`)
function notationOf(count: number, sides: number | 'F', m: DiceMods): string {
  let s = `${count}d${sides === 'F' ? 'F' : sides}`
  if (m.reroll) s += (m.reroll.once ? 'ro' : 'r') + cmpText(m.reroll)
  if (m.explode) s += '!' + (sides !== 'F' && m.explode.op === '=' && m.explode.n === sides ? '' : m.explode.op === '=' ? `=${m.explode.n}` : cmpText(m.explode))
  if (m.min !== undefined) s += `min${m.min}`
  if (m.max !== undefined) s += `max${m.max}`
  if (m.keep) s += `k${m.keep.high ? 'h' : 'l'}${m.keep.n}`
  if (m.drop) s += `d${m.drop.high ? 'h' : 'l'}${m.drop.n}`
  if (m.success) s += `${m.success.op === '=' ? '=' : m.success.op}${m.success.n}`
  return s
}

/** A die's faces; for numbered dice just the two ends (every comparison here is one-sided or exact). */
const facesOf = (sides: number | 'F'): number[] => (sides === 'F' ? [-1, 0, 1] : [1, sides])
function matches(v: number, c: Compare): boolean {
  switch (c.op) {
    case '>=':
      return v >= c.n
    case '>':
      return v > c.n
    case '<=':
      return v <= c.n
    case '<':
      return v < c.n
    default:
      return v === c.n
  }
}

/** The largest a roll could ever come to (to refuse rolls that would overflow). */
function bound(n: DiceNode): number {
  switch (n.t) {
    case 'num':
      return Math.abs(n.v)
    case 'dice': {
      const dice = n.count + (n.mods.explode ? DICE_MAX_EXPLOSIONS : 0)
      return n.mods.success ? dice : dice * (n.sides === 'F' ? 1 : Math.max(n.sides, n.mods.max ?? 0))
    }
    case 'neg':
    case 'group':
      return bound(n.a)
    case 'bin':
      return n.op === '*' ? bound(n.a) * bound(n.b) : n.op === '/' ? bound(n.a) : bound(n.a) + bound(n.b)
  }
}

function show(n: DiceNode): string {
  switch (n.t) {
    case 'num':
      return String(n.v)
    case 'dice':
      return n.notation
    case 'neg':
      return '-' + show(n.a)
    case 'group':
      return '(' + show(n.a) + ')'
    case 'bin':
      return show(n.a) + n.op + show(n.b)
  }
}

// ───────────── Rolling ─────────────

type Ctx = { rng: DiceRng; rolled: number; capped: boolean; terms: RollTerm[] }
type Out = { value: number; text: string; short: string }

function face(sides: number | 'F', rng: DiceRng): number {
  const r = rng()
  const x = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999999999) : 0
  return sides === 'F' ? Math.floor(x * 3) - 1 : Math.floor(x * sides) + 1
}

function rollTerm(n: Extract<DiceNode, { t: 'dice' }>, ctx: Ctx): Out {
  const m = n.mods
  const clamp = (v: number) => Math.min(Math.max(v, m.min ?? -Infinity), m.max ?? Infinity)
  let rerolls = 0
  const one = (extra: boolean): RollDie => {
    let v = face(n.sides, ctx.rng)
    const before: number[] = []
    if (m.reroll) {
      while (matches(v, m.reroll) && rerolls < DICE_MAX_REROLLS) {
        before.push(v)
        rerolls++
        v = face(n.sides, ctx.rng)
        if (m.reroll.once) break
      }
    }
    ctx.rolled++
    const die: RollDie = { value: clamp(v), kept: true }
    if (before.length) die.rerolled = before
    if (extra) die.extra = true
    return die
  }
  const dice: RollDie[] = []
  let explosions = 0
  for (let i = 0; i < n.count; i++) {
    let die = one(false)
    dice.push(die)
    while (m.explode && matches(die.value, m.explode)) {
      if (explosions >= DICE_MAX_EXPLOSIONS || ctx.rolled >= DICE_MAX_DICE) {
        ctx.capped = true
        break
      }
      die.exploded = true
      explosions++
      die = one(true)
      dice.push(die)
    }
  }
  const k = m.keep ?? m.drop
  if (k) {
    // Which dice to keep, by value (ties: the earlier die counts as higher).
    const order = dice.map((d, i) => ({ v: d.value, i })).sort((a, b) => b.v - a.v || a.i - b.i)
    const keepN = m.keep ? k.n : dice.length - k.n
    const highFirst = m.keep ? k.high : !k.high
    const chosen = new Set((highFirst ? order : order.slice().reverse()).slice(0, Math.max(0, keepN)).map((x) => x.i))
    dice.forEach((d, i) => (d.kept = chosen.has(i)))
  }
  if (n.sides === 20) {
    for (const d of dice) {
      if (d.value === 20) d.crit = true
      if (d.value === 1) d.fumble = true
    }
  }
  let total = 0
  for (const d of dice) {
    if (!d.kept) continue
    if (m.success) {
      if (matches(d.value, m.success)) {
        d.success = true
        total++
      }
    } else total += d.value
  }
  ctx.terms.push({ kind: 'dice', notation: n.notation, count: n.count, sides: n.sides, dice, total, successes: !!m.success, label: n.label })
  const shown = dice.map((d) => {
    const v = d.kept ? String(d.value) : `~${d.value}~`
    return v + (d.exploded ? '!' : '') + (d.success ? '✓' : '')
  })
  const text = `(${shown.join(', ')})`
  const plain = dice.length === 1 && dice[0].kept && !dice[0].exploded && !m.success
  return { value: total, text, short: plain ? String(total) : text }
}

function evalNode(n: DiceNode, ctx: Ctx): Out {
  switch (n.t) {
    case 'num':
      ctx.terms.push({ kind: 'number', value: n.v, label: n.label })
      return { value: n.v, text: String(n.v), short: String(n.v) }
    case 'dice':
      return rollTerm(n, ctx)
    case 'neg': {
      const a = evalNode(n.a, ctx)
      return { value: -a.value, text: '-' + a.text, short: '-' + a.short }
    }
    case 'group': {
      const a = evalNode(n.a, ctx)
      return { value: a.value, text: `(${a.text})`, short: `(${a.short})` }
    }
    case 'bin': {
      const a = evalNode(n.a, ctx)
      const b = evalNode(n.b, ctx)
      const value =
        n.op === '+' ? a.value + b.value : n.op === '-' ? a.value - b.value : n.op === '*' ? a.value * b.value : b.value === 0 ? 0 : Math.floor(a.value / b.value)
      const op = n.op === '-' ? '−' : n.op === '*' ? '×' : n.op
      return { value, text: `${a.text} ${op} ${b.text}`, short: `${a.short} ${op} ${b.short}` }
    }
  }
}

/** The short form of the last roll's working ("14 + 3"), kept for rollShort. */
const shortOf = new WeakMap<RollResult, string>()

/** Rolls a parsed expression. `rng` gives numbers in [0, 1) (the server's comes from crypto). */
export function rollDice(expr: DiceExpr, rng: DiceRng): RollResult {
  const ctx: Ctx = { rng, rolled: 0, capped: false, terms: [] }
  const out = evalNode(expr.root, ctx)
  const total = Math.trunc(out.value) || 0
  const firstD20 = ctx.terms.find((t) => t.kind === 'dice' && t.sides === 20)
  const natural = firstD20 && firstD20.kind === 'dice' ? (firstD20.dice.find((d) => d.kept)?.value ?? null) : null
  const result: RollResult = {
    expression: expr.expression,
    label: expr.label,
    total,
    terms: ctx.terms,
    breakdown: `${expr.expression} → ${out.text} = ${total}`,
    natural,
    crit: natural === 20,
    fumble: natural === 1,
    capped: ctx.capped
  }
  shortOf.set(result, out.short)
  return result
}

/** Parses and rolls in one go. */
export function roll(text: string, rng: DiceRng): { ok: true; result: RollResult } | { ok: false; error: string } {
  const p = parseDice(text)
  return p.ok ? { ok: true, result: rollDice(p.expr, rng) } : p
}

/** The working without the expression: "14 + 3" (from a result's breakdown when not just rolled). */
export function rollShort(result: RollResult): string {
  const known = shortOf.get(result)
  if (known !== undefined) return known
  const arrow = result.breakdown.indexOf(' → ')
  const eq = result.breakdown.lastIndexOf(' = ')
  return arrow >= 0 && eq > arrow ? result.breakdown.slice(arrow + 3, eq) : String(result.total)
}

/** Every die in a result, in order (for the roll card's dice). */
export const rollDiceList = (result: RollResult): RollDie[] => result.terms.flatMap((t) => (t.kind === 'dice' ? t.dice : []))

/**
 * The plain text older apps show for a roll in a chat:
 * "🎲 Chip rolled 1d20+3: 17 (14 + 3)", or "🎲 Chip rolled 1d20 (Stealth): 14".
 */
export function chatRollText(name: string, result: RollResult): string {
  const short = rollShort(result)
  const label = result.label ? ` (${result.label})` : ''
  const working = short === String(result.total) ? '' : ` (${short})`
  return `🎲 ${name} rolled ${result.expression}${label}: ${result.total}${working}`
}

/** `/roll 1d20+5` (or `/r …`) in a chat: the roll part, or null if it isn't a roll command. */
export function rollCommand(text: string): string | null {
  const m = /^\/(?:roll|r)\s+([\s\S]+)$/i.exec(text.trim())
  return m ? m[1].trim() : null
}

/** Inline [[…]] rolls in some text (at most 10), with where they are. */
export function inlineRolls(text: string): { start: number; end: number; expression: string }[] {
  const out: { start: number; end: number; expression: string }[] = []
  const re = /\[\[([^[\]]{1,200})\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) && out.length < 10) out.push({ start: m.index, end: m.index + m[0].length, expression: m[1].trim() })
  return out
}

/** Doubles the dice of a damage expression (a critical hit): "1d8+4" → "2d8+4". */
export function critDice(expression: string): string {
  return expression.replace(/(^|[^0-9a-z])(\d*)d(\d+|%)/gi, (_m, pre: string, n: string, s: string) => `${pre}${(n ? Number(n) : 1) * 2}d${s}`)
}

/**
 * Is this a fair attack roll? Its d20s may be rolled with advantage (2d20kh1, up to 3d20) or
 * rerolled once (ro1, like a halfling's luck), but never clamped (min/max), exploded, counted as
 * successes or rerolled until they show something: those would let a player always roll a natural
 * 20, or roll a chosen number to work out a target's AC. Null when it's fine, else why not.
 */
export function unfairToHit(expr: DiceExpr): string | null {
  const walk = (n: DiceNode): string | null => {
    switch (n.t) {
      case 'num':
        return null
      case 'dice': {
        if (n.sides !== 20) return null
        const m = n.mods
        if (n.count > 3) return 'An attack can roll up to 3d20.'
        // ro1 / ro<2 / ro<=2 only: rerolling anything higher once is better than advantage.
        const lowOnce = !m.reroll || (m.reroll.once && (m.reroll.op === '=' || m.reroll.op === '<' || m.reroll.op === '<=') && m.reroll.n <= 2)
        if (m.min !== undefined || m.max !== undefined || m.explode || m.success || !lowOnce)
          return 'Attack rolls can use advantage (kh1/kl1) or ro1, nothing else on the d20.'
        return null
      }
      case 'neg':
      case 'group':
        return walk(n.a)
      case 'bin':
        return walk(n.a) ?? walk(n.b)
    }
  }
  return walk(expr.root)
}

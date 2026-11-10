import { useReducedMotion } from 'react-native-reanimated'
import { isFullCharacter, type Character, type CharacterView, type TableState, type Token, type TokenBar } from '@glofly/shared'
import { useReduceMotion } from '@/constellations/motion'
import { campfire, campfireHigh, useHighContrast, type CampfireColors } from '@/ui/theme'

// Small helpers every Campfire piece shares.

/** The Campfire palette (High contrast lays brighter text and lines over it). */
export function useFire(): CampfireColors {
  return useHighContrast() ? campfireHigh : campfire
}

/** Reduce Motion: the phone's setting (reanimated reads it) or the browser preview's. */
export function useStill(): boolean {
  const a = useReducedMotion()
  const b = useReduceMotion((s) => s.on)
  return a || b
}

/** Does this person control the token (listed, or it's their own PC's)? Same rule as the server. */
export function controls(t: Pick<Token, 'controlledBy' | 'characterId'>, userId: string, characters: CharacterView[]): boolean {
  if (t.controlledBy.includes(userId)) return true
  return !!t.characterId && characters.some((c) => c.id === t.characterId && c.ownerId === userId)
}

/** My character at this table (the first PC I own), with its full sheet when the server sent it. */
export function myCharacter(t: TableState, meId: string): Character | null {
  const mine = t.characters.filter((c) => c.ownerId === meId && c.kind === 'pc' && isFullCharacter(c)) as Character[]
  return mine[0] ?? null
}

/** My token on the map: one linked to my character, else any I control. */
export function myToken(t: TableState, meId: string): Token | null {
  const ch = myCharacter(t, meId)
  return (ch && t.tokens.find((x) => x.characterId === ch.id)) || t.tokens.find((x) => x.layer !== 'gm' && controls(x, meId, t.characters)) || null
}

/** Health color like the boards: green above half, yellow above a quarter, red below. */
export function hpColor(fire: CampfireColors, value: number, max: number): string {
  const pct = max > 0 ? value / max : 0
  return pct > 0.5 ? fire.green : pct > 0.25 ? fire.yellow : fire.red
}

/** A bar's fill (0–1), also for monsters shown only as healthy/bloodied/defeated. */
export function barFraction(bar: TokenBar | null | undefined): number | null {
  if (!bar) return null
  if (bar.value !== null && bar.max !== null && bar.max > 0) return Math.max(0, Math.min(1, bar.value / bar.max))
  if (bar.state === 'healthy') return 1
  if (bar.state === 'bloodied') return 0.4
  if (bar.state === 'defeated') return 0
  return null
}

/** The ring color of a token: party green/blue/… by id, monsters red. */
const PARTY = [
  ['#57C27A', '#2F7A4A'],
  ['#4F8CFF', '#2F5AA8'],
  ['#F0B429', '#A8761C'],
  ['#B57CFF', '#6B3FA8'],
  ['#5BC8D6', '#2B7F8A'],
  ['#FF8FB1', '#A84868'],
]
export function tokenColors(t: Token, characters: CharacterView[], own = false): { ring: string; fill: string; party: boolean } {
  const pc = !!t.characterId && characters.some((c) => c.id === t.characterId && c.kind === 'pc')
  const party = pc || t.controlledBy.length > 0
  if (!party) return { ring: '#EF5A4A', fill: '#7A2A22', party: false }
  // Yours is green (like the Phone board's Lyra); everyone else's color comes from the token.
  if (own) return { ring: PARTY[0][0], fill: PARTY[0][1], party: true }
  let h = 0
  for (const ch of t.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const [ring, fill] = PARTY[1 + (h % (PARTY.length - 1))]
  return { ring, fill, party: true }
}

/** "+7", "−1" (a real minus sign, like the boards). */
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

/** The center of a token in map pixels. */
export const centerOf = (t: Pick<Token, 'x' | 'y' | 'w' | 'h'>, cell: number): [number, number] => [t.x + (t.w * cell) / 2, t.y + (t.h * cell) / 2]

/** A name for a token in the turn order / hit pop-ups. */
export const tokenName = (t: Token | undefined): string => (t?.name?.trim() ? t.name : 'Someone')

export const initialOf = (name: string): string => (name.trim()[0] ?? '?').toUpperCase()

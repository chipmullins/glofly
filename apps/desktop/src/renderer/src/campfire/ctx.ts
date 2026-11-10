import { createContext, useContext } from 'react'
import type { SignedInUser } from '../../../preload/api-types'
import type { Point, RollVisibility, TableState, Token } from '@glofly/shared/campfire/types'
import type { TableCtl } from './useTable'

// What every part of the table needs: the state, who I am, and the shared bits of the screen
// (selected token, target, how rolls are shared, a short message line).

export type RollShare = { mode: RollVisibility; to: string[] }

export type Cf = {
  ctl: TableCtl
  t: TableState
  me: SignedInUser
  isGm: boolean
  nameOf: (userId: string | null) => string
  say: (message: string) => void
  /** The short message line (shown over the map) */
  message: string | null
  selectedId: string | null
  setSelectedId: (id: string | null) => void
  targetId: string | null
  setTargetId: (id: string | null) => void
  share: RollShare
  setShare: (s: RollShare) => void
  /** Rolls an expression at the table (shared as the dice tray says) */
  roll: (
    expression: string,
    opts?: { label?: string; characterId?: string | null }
  ) => Promise<boolean>
  /** The middle of the map that's showing (new tokens go there) */
  mapCenter: () => Point
  /** The token linked to a character on the scene that's showing */
  tokenOf: (characterId: string) => Token | null
  openTab: (tab: Tab) => void
  openBuilder: (sceneId?: string | null) => void
  /** The character sheet as a window over the table */
  openSheet: (characterId: string) => void
  /** GMs: a monster's stat block (an NPC at the table, or one from the compendium) */
  openStatBlock: (what: StatBlockFor) => void
}

export type StatBlockFor = { characterId: string } | { slug: string }

export type Tab = 'turn' | 'rolls' | 'sheet' | 'handouts' | 'music' | 'add'

export const CfContext = createContext<Cf | null>(null)

export function useCf(): Cf {
  const v = useContext(CfContext)
  if (!v) throw new Error('Campfire context missing')
  return v
}

/** +3, −1 */
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`)

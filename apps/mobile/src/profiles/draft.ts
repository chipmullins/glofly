import { create } from 'zustand'
import type { BoardTile } from '@glofly/shared'

// 0.9.1: the board being edited in Edit profile, shared with the "Add to your board" screen.
// Nothing is saved until Edit profile's Save.
export const useBoardDraft = create<{ board: BoardTile[] }>(() => ({ board: [] }))

export const setDraftBoard = (board: BoardTile[]) => useBoardDraft.setState({ board })

/** Puts a tile in (replacing the one at `index`, or added at the end). */
export function putTile(tile: BoardTile, index: number | null) {
  const board = useBoardDraft.getState().board
  setDraftBoard(index !== null && index < board.length ? board.map((t, i) => (i === index ? tile : t)) : [...board, tile])
}

export const TILE_NAMES: Record<BoardTile['kind'], string> = {
  games: 'Favorite games',
  constellation: 'A constellation I love',
  note: 'Note',
  into: 'I’m into',
  playing: 'Currently playing',
}

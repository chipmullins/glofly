import type { GameLinkGame } from '@glofly/shared'

/** Linked game servers: each game's badge (same as desktop's oauth/GameLinks.tsx). */
export const GAME_LOOK: Record<GameLinkGame, { badge: string; color: string }> = {
  fivem: { badge: 'FiveM', color: '#c2410c' },
  redm: { badge: 'RedM', color: '#9f1239' },
  minecraft: { badge: 'MC', color: '#15803d' },
}

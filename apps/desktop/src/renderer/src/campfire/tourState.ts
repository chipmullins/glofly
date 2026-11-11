// Whether this computer has seen Campfire's coach marks (one for game masters, one for players).

const key = (gm: boolean): string => `campfire.tour.${gm ? 'gm' : 'player'}`
export const tourSeen = (gm: boolean): boolean => {
  try {
    return localStorage.getItem(key(gm)) === 'done'
  } catch {
    return true
  }
}
export const markSeen = (gm: boolean): void => {
  try {
    localStorage.setItem(key(gm), 'done')
  } catch {
    /* private window: shows again next time */
  }
}

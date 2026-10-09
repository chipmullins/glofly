// Reading what Windows' own tools print, for games.ts. Kept separate (no Electron) so the
// parsing can be tested on its own.

/** Lowercase program names from `tasklist /fo csv /nh` ("name.exe","pid",…). */
export function parseTasklist(out: string): Set<string> {
  const names = new Set<string>()
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)"/.exec(line)
    if (m) names.add(m[1].toLowerCase())
  }
  return names
}

/** Steam's running game id from `reg query …\Valve\Steam /v RunningAppID` (0 = none). */
export function parseSteamAppId(out: string): number {
  const m = /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out)
  return m ? parseInt(m[1], 16) : 0
}

/** A game's name from `reg query …\Valve\Steam\Apps\<id> /v Name`. */
export function parseRegName(out: string): string | null {
  const m = /^\s*Name\s+REG_SZ\s+(.+?)\s*$/im.exec(out)
  return m ? m[1] : null
}

/** Which game is being played: your own games first, then known games. Null if neither. */
export function matchGame(
  exes: Set<string>,
  custom: { exe: string; name: string }[],
  known: Record<string, string>,
  hidden: string[]
): string | null {
  const hide = new Set(hidden.map((n) => n.toLowerCase()))
  const ok = (name: string | undefined): name is string => !!name && !hide.has(name.toLowerCase())
  for (const g of custom) if (exes.has(g.exe) && ok(g.name)) return g.name
  for (const exe of exes) {
    const name = Object.hasOwn(known, exe) ? known[exe] : undefined
    if (ok(name)) return name
  }
  return null
}

/** Whether a game name is one you hid. */
export const isHidden = (name: string, hidden: string[]): boolean =>
  hidden.some((n) => n.toLowerCase() === name.toLowerCase())

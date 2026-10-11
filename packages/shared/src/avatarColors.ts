// The colors behind someone's initials when they have no photo.

// Color pairs from the design canvas.
export const PALETTE: [string, string][] = [
  ['#FBDCC4', '#8A3005'],
  ['#D7E5F5', '#1E4E8C'],
  ['#DDEBD9', '#2F6B3A'],
  ['#EADCF5', '#5B3A8C'],
  ['#F5DCDC', '#8C2F2F'],
  ['#F3E7C5', '#6E5310'],
  ['#E2E8EC', '#3A4B57']
]

/** The same person always gets the same color. */
export function colorsFor(id: string): [string, string] {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

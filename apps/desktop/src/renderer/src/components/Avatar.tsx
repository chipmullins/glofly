import { initials } from '../lib/names'

// Round initials avatar. Photos come later; until then each person gets a steady color.

// Color pairs from the design canvas.
const PALETTE: [string, string][] = [
  ['#FBDCC4', '#8A3005'],
  ['#D7E5F5', '#1E4E8C'],
  ['#DDEBD9', '#2F6B3A'],
  ['#EADCF5', '#5B3A8C'],
  ['#F5DCDC', '#8C2F2F'],
  ['#F3E7C5', '#6E5310'],
  ['#E2E8EC', '#3A4B57']
]

/** The same person always gets the same color. */
function colorsFor(id: string): [string, string] {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

type AvatarProps = {
  id: string
  name: string
  size?: number
}

export default function Avatar({ id, name, size = 44 }: AvatarProps): React.JSX.Element {
  const [bg, fg] = colorsFor(id)
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.34)
      }}
    >
      {initials(name)}
    </span>
  )
}

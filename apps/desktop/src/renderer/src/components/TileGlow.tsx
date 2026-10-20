import { useRef, useState } from 'react'
import { useFlip } from '../lib/flip'
import { avatarUrl } from '../lib/media'
import { colorsFor } from '../lib/avatarColors'
import './TileGlow.css'

// Cameras off, still full of life (0.7.5, CallScreen.dc.html, approved): the tile fills with a
// soft, blurred glow of the person's photo, or of their colors when they have none, with a dark
// vignette so the round photo and the name stay readable. It's still (only the talking ring
// pulses), and it sits on its own layer so that pulse never re-blurs it.

/** The glow behind someone without a photo: their two avatar colors, deepening to the call's brown. */
function glowGradient(id: string, mine = false): string {
  const [light, deep] = mine ? ['#ffcf8a', '#f47a1f'] : colorsFor(id)
  return `radial-gradient(circle at 42% 40%, ${light}, ${deep} 48%, #1c1210)`
}

export default function TileGlow({
  id,
  avatarVersion,
  mine
}: {
  id: string
  avatarVersion?: string | null
  mine?: boolean
}): React.JSX.Element {
  const url = avatarVersion ? avatarUrl(id, avatarVersion) : null
  const [failed, setFailed] = useState<string | null>(null)
  const photo = url && url !== failed ? url : null
  return (
    <span className="tile-glow" aria-hidden="true">
      {photo ? (
        <img
          className="tile-glow-fill"
          src={photo}
          alt=""
          draggable={false}
          onError={() => setFailed(photo)}
        />
      ) : (
        <span className="tile-glow-fill" style={{ background: glowGradient(id, mine) }} />
      )}
      <span className="tile-glow-vignette" />
    </span>
  )
}

/** A box whose [data-flip] tiles glide into place when the people in it change (lib/flip.ts). */
export function FlipBox({
  flip,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { flip: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useFlip(ref, flip)
  return <div ref={ref} {...props} />
}

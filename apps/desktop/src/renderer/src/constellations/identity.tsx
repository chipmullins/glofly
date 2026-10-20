import { useState } from 'react'
import { accentOf } from '@glofly/shared/constellations'
import type { ConstellationAccent } from '@glofly/shared/constellations'
import { constellationBannerUrl } from '../lib/media'
import './identity.css'

// 0.7.5 Constellations polish, "identity" (the approved Identity board): each constellation can
// have its own accent color and banner photo. The accent tints only that constellation: the open
// nebula, badges, Join buttons, the chat's header icon and message box ring. No accent = the
// classic firefly gold, so nothing changes for constellations that never picked one.

type HasIdentity = {
  id: string
  accent?: ConstellationAccent | null
  bannerVersion?: string | null
}

/**
 * A banner: the photo when it has one, otherwise the drawn night sky with a little constellation
 * in its accent color (the approved board's art).
 */
export function BannerArt({
  c,
  width,
  height,
  className
}: {
  c: HasIdentity
  width: number
  height: number
  className?: string
}): React.JSX.Element {
  const url = c.bannerVersion ? constellationBannerUrl(c.id, c.bannerVersion) : null
  const [failed, setFailed] = useState<string | null>(null)
  const a = accentOf(c)
  if (url && url !== failed) {
    return (
      <span
        className={className}
        aria-hidden="true"
        style={{ display: 'block', width: '100%', height }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailed(url)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    )
  }
  const w = width
  const p = (x: number, y: number): string => `${Math.round(x * w)} ${Math.round(y * height)}`
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height,
        position: 'relative',
        background: `radial-gradient(circle at 70% 40%, rgba(${a.rgb},.35), transparent 45%), linear-gradient(160deg, #2b1a3a 0%, #1a1020 55%, #120c0a 100%)`
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0 }}
      >
        <path
          d={`M${p(0.13, 0.72)} L${p(0.34, 0.42)} L${p(0.53, 0.55)} L${p(0.73, 0.23)} L${p(0.89, 0.45)}`}
          stroke={a.color}
          strokeOpacity=".55"
          strokeWidth="1.4"
          fill="none"
        />
        <circle cx={0.13 * w} cy={0.72 * height} r="3" fill={a.color} />
        <circle cx={0.34 * w} cy={0.42 * height} r="2.5" fill="#f5ede6" />
        <circle cx={0.53 * w} cy={0.55 * height} r="3.5" fill={a.color} />
        <circle cx={0.73 * w} cy={0.23 * height} r="4" fill={a.color} />
        <circle cx={0.89 * w} cy={0.45 * height} r="2.5" fill="#f5ede6" />
        <circle cx={0.24 * w} cy={0.17 * height} r="1.2" fill="#e9d5c4" />
        <circle cx={0.65 * w} cy={0.81 * height} r="1.2" fill="#e9d5c4" />
        <circle cx={0.92 * w} cy={0.78 * height} r="1.5" fill="#f9b26b" />
      </svg>
    </span>
  )
}

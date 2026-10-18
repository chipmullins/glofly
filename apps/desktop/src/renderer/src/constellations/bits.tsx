import { useState } from 'react'
import {
  CONSTELLATION_THEME,
  constellationInitials,
  type ConstellationColor
} from '@glofly/shared/constellations'
import { constellationIconUrl } from '../lib/media'
import { hexA } from './colors'

// Small pieces every Constellations screen uses: the icon, banner stars, icons from the mockups.

/** A constellation's icon: its photo, or its initials on its color. */
export function ConstellationIcon({
  id,
  name,
  color,
  iconVersion,
  className,
  style
}: {
  id: string
  name: string
  color: ConstellationColor
  iconVersion: string | null
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const theme = CONSTELLATION_THEME[color]
  const url = iconVersion ? constellationIconUrl(id, iconVersion) : null
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{ background: theme.icon, color: theme.iconText, ...style }}
    >
      {url && url !== failed ? (
        <img
          className="cx-icon-img"
          src={url}
          alt=""
          draggable={false}
          onError={() => setFailed(url)}
        />
      ) : (
        constellationInitials(name)
      )}
    </span>
  )
}

/** A steady number from an id (banner stars sit in the same spots every time). */
function hash(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 33 + (ch.codePointAt(0) ?? 0)) >>> 0
  return h
}

/**
 * The stars on a banner, like the mockup's cards: a small orange one, a tiny cream one and a big
 * glowing one, nudged per constellation.
 */
export function BannerStars({
  id,
  color,
  width = 300
}: {
  id: string
  color: ConstellationColor
  width?: number
}): React.JSX.Element {
  const t = CONSTELLATION_THEME[color]
  const h = hash(id)
  const n = (k: number, span: number): number => ((h >> (k * 3)) % span) - span / 2
  return (
    <>
      <span
        className="cx-banner-star"
        aria-hidden="true"
        style={{ left: 30 + n(1, 20), top: 22 + n(2, 10), width: 3, height: 3, background: t.glow }}
      />
      <span
        className="cx-banner-star"
        aria-hidden="true"
        style={{
          left: Math.round(width * 0.46) + n(3, 40),
          top: 40 + n(4, 12),
          width: 2,
          height: 2,
          borderRadius: 1,
          background: t.star
        }}
      />
      <span
        className="cx-banner-star"
        aria-hidden="true"
        style={{
          right: 50 + n(5, 30),
          top: 18 + n(6, 10),
          width: 4,
          height: 4,
          background: t.glow,
          boxShadow: `0 0 10px 3px ${hexA(t.glow, 0.45)}`
        }}
      />
    </>
  )
}

/** The four-point star (text nebulas, notes). */
export function StarIcon({
  size = 16,
  color = 'currentColor'
}: {
  size?: number
  color?: string
}): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
    </svg>
  )
}

/** The speaker (voice nebulas). */
export function SpeakerIcon({
  size = 16,
  color = 'currentColor',
  waves = true
}: {
  size?: number
  color?: string
  waves?: boolean
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10v4h4l5 4V6L8 10H4z" />
      {waves && <path d="M16.5 9a4 4 0 0 1 0 6" />}
    </svg>
  )
}

export function ChevronDown({
  size = 12,
  strokeWidth = 2.4
}: {
  size?: number
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

export function PlusIcon({
  size = 18,
  strokeWidth = 2.4
}: {
  size?: number
  strokeWidth?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function CloseIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function MicIconLine({
  size = 18,
  muted = false
}: {
  size?: number
  muted?: boolean
}): React.JSX.Element {
  return muted ? (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 3l18 18M9 9v2a3 3 0 0 0 5 2.2M15 11V6a3 3 0 0 0-5.6-1.5" />
      <path d="M5 11a7 7 0 0 0 11.2 5.6M19 11a7 7 0 0 1-.6 2.8M12 18v3" />
    </svg>
  ) : (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

export function GearIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* 0.7.2: a real cog (toothed wheel, hole in the middle), the same one as the main app's
          Settings and the phones' banner; the old rays read as a sun. */}
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}

export function MembersIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.7 3.1 2.4 3.5 5.2" />
    </svg>
  )
}

export function SearchIconLine({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

export function LinkOutIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 14 21 3M15 3h6v6" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

/** Something that went wrong, shown for a few seconds at the bottom of the night sky. */
export function CxToast({ text }: { text: string | null }): React.JSX.Element | null {
  if (!text) return null
  return (
    <div className="cx-toast" role="status">
      {text}
    </div>
  )
}

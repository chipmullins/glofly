import type { JSX } from 'react'

// Icons drawn as thin strokes (from the Control mockup), and the Glofly firefly logo.

type IconProps = { d: string; size?: number; strokeWidth?: number }

export function Icon({ d, size = 19, strokeWidth = 1.9 }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  )
}

export const ICONS = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
  accounts:
    'M16 19c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19c0-1.9-1.3-3.4-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  signups:
    'M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4zM13 6v12',
  reports: 'M5 21V4M5 4h11l-2 4 2 4H5',
  announcements: 'M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1zM17 9a4 4 0 0 1 0 6',
  audit: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  lock: 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z',
  mail: 'M3 5h18v14H3zM3 7l9 6 9-6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5'
} as const

/** The Glofly firefly on the Twilight tile. */
export function Logo({ size = 36 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3d2775" />
          <stop offset="1" stopColor="#140c2c" />
        </linearGradient>
        <radialGradient id="logo-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffc24a" stopOpacity="0.66" />
          <stop offset="1" stopColor="#ff8a1f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect
        x="16"
        y="16"
        width="480"
        height="480"
        rx="112"
        fill="url(#logo-bg)"
        stroke="#5a4296"
        strokeWidth="10"
      />
      <circle cx="262" cy="250" r="196" fill="url(#logo-glow)" />
      <g transform="translate(258 254) scale(0.53) translate(-525 -545)">
        <ellipse cx="455" cy="528" rx="78" ry="52" transform="rotate(-38 455 528)" fill="#FFC21A" />
        <circle cx="540" cy="428" r="74" fill="#FFC21A" />
        <g fill="none" stroke="#FFA030" strokeWidth="40" strokeLinejoin="round">
          <path d="M490 490 C420 380 268 222 182 238 C124 250 136 330 200 382 C280 444 400 470 490 490 Z" />
          <path d="M490 490 C620 500 800 520 860 580 C905 626 870 690 780 680 C680 668 572 560 490 490 Z" />
          <path d="M490 490 C500 600 540 705 598 768 C632 804 694 796 676 736 C658 672 566 566 490 490 Z" />
        </g>
        <rect x="282" y="588" width="216" height="154" rx="50" fill="#FF9A10" />
      </g>
    </svg>
  )
}

import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg'

// Line icons from the mockups (24×24, round caps), and the gold-shield Control logo.

const PATHS = {
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
  reports: 'M5 21V4M5 4h11l-2 4 2 4H5',
  accounts:
    'M16 19c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 19c0-1.9-1.3-3.4-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  constellations: 'M12 3l1.6 3.8L17.5 7l-3 2.7.9 4L12 11.6 8.6 13.7l.9-4-3-2.7 3.9-.2zM5 18h.01M19 17h.01M12 20h.01',
  server: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  warning: 'M12 3l9.5 17h-19zM12 10v4M12 17h.01',
  back: 'M15 5l-7 7 7 7',
  chevron: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7',
  pause: 'M9 5v14M15 5v14',
  play: 'M7 5l12 7-12 7z',
  restart: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z',
  lockSmall: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  hangup: 'M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5c-2-.7-5-.7-7 0V16l-3 1.5z',
  faceId:
    'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3M9 9v1M15 9v1M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0',
  close: 'M6 6l12 12M18 6L6 18',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  ban: 'M5 5l14 14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
  teamMessage: 'M4 5h16v11H8l-4 4zM12 8.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z',
  addFriend: 'M15 19c0-2.2-1.8-4-4-4H7c-2.2 0-4 1.8-4 4M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  signOut: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  key: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  text: 'M4 6h16M4 12h16M4 18h10',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  inbox: 'M4 13l2.5-8h11L20 13M4 13v6h16v-6M4 13h5l1 2h4l1-2h5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2',
  send: 'M4 12l16-8-6 16-3-7z',
  snow: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  owner: 'M12 3l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.3 6.8 19l1-5.8L3.6 9.1l5.8-.8z',
  shieldOff: 'M12 3l8 3v6c0 5-3.5 8.7-8 10-4.5-1.3-8-5-8-10V6zM9 9l6 6M15 9l-6 6',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  megaphone: 'M3 10v4h4l6 4V6L7 10zM16 9a4 4 0 0 1 0 6',
  update: 'M12 4v10M8 10l4 4 4-4M5 20h14',
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-3.3 3.6-6 8-6s8 2.7 8 6',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 22, color = '#24170f', width = 2 }: { name: IconName; size?: number; color?: string; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      <Path d={PATHS[name]} />
    </Svg>
  )
}

/** The gold shield on its own (alert cards, the team bubble). */
export function Shield({ size = 22, check = false }: { size?: number; check?: boolean }) {
  return (
    <Svg width={size} height={(size * 27) / 24} viewBox="0 0 24 27">
      <Path d="M12 1l10 4v8c0 6.2-4.3 10.9-10 13-5.7-2.1-10-6.8-10-13V5z" fill="#ffc24a" stroke={check ? '#150d2e' : undefined} strokeWidth={check ? 2 : 0} />
      {check ? <Path d="M8 13.5l3 3 5.5-6" fill="none" stroke="#24174a" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  )
}

/** The Control logo: the Twilight firefly tile with the gold shield badge (Main.dc.html). */
export function Logo({ size = 84 }: { size?: number }) {
  const badge = (size * 34) / 84
  return (
    <Svg width={size + size * 0.1} height={size + size * 0.08} viewBox={`0 0 ${size + size * 0.1} ${size + size * 0.08}`}>
      <G>
        <Svg width={size} height={size} viewBox="0 0 512 512">
          <Defs>
            <LinearGradient id="mbg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#3d2775" />
              <Stop offset="1" stopColor="#140c2c" />
            </LinearGradient>
            <RadialGradient id="mgl" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#ffc24a" stopOpacity={0.66} />
              <Stop offset="1" stopColor="#ff8a1f" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="16" y="16" width="480" height="480" rx="112" fill="url(#mbg)" stroke="#5a4296" strokeWidth="10" />
          <Circle cx="262" cy="250" r="196" fill="url(#mgl)" />
          <G transform="translate(258 254) scale(0.53) translate(-525 -545)">
            <Ellipse cx="455" cy="528" rx="78" ry="52" transform="rotate(-38 455 528)" fill="#FFC21A" />
            <Circle cx="540" cy="428" r="74" fill="#FFC21A" />
            <G fill="none" stroke="#FFA030" strokeWidth="40" strokeLinejoin="round">
              <Path d="M490 490 C420 380 268 222 182 238 C124 250 136 330 200 382 C280 444 400 470 490 490 Z" />
              <Path d="M490 490 C620 500 800 520 860 580 C905 626 870 690 780 680 C680 668 572 560 490 490 Z" />
              <Path d="M490 490 C500 600 540 705 598 768 C632 804 694 796 676 736 C658 672 566 566 490 490 Z" />
            </G>
            <Rect x="282" y="588" width="216" height="154" rx="50" fill="#FF9A10" />
          </G>
        </Svg>
        <Svg x={size + size * 0.1 - badge} y={size + size * 0.08 - (badge * 38) / 34} width={badge} height={(badge * 38) / 34} viewBox="0 0 24 27">
          <Path d="M12 1l10 4v8c0 6.2-4.3 10.9-10 13-5.7-2.1-10-6.8-10-13V5z" fill="#ffc24a" stroke="#150d2e" strokeWidth={2} />
          <Path d="M8 13.5l3 3 5.5-6" fill="none" stroke="#24174a" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </G>
    </Svg>
  )
}

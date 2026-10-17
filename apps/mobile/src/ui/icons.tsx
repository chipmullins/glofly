import Svg, { Circle, Path, Rect } from 'react-native-svg'

// Stroke icons drawn like the design canvas (24-unit grid, round caps). `name` picks the drawing.

const strokes: Record<string, (fill: string) => React.ReactNode> = {
  back: () => <Path d="M20 12H5M11 5l-7 7 7 7" />,
  chevronLeft: () => <Path d="M15 5l-7 7 7 7" />,
  chevronRight: () => <Path d="M9 6l6 6-6 6" />,
  chevronDown: () => <Path d="M6 9l6 6 6-6" />,
  close: () => <Path d="M6 6l12 12M18 6L6 18" />,
  check: () => <Path d="M4 12l5 5L20 6" />,
  checkDouble: () => (
    <>
      <Path d="M2 12l5 5L17 7" />
      <Path d="M10 16.5l.5.5L22 7" />
    </>
  ),
  plus: () => <Path d="M12 5v14M5 12h14" />,
  minus: () => <Path d="M5 12h14" />,
  phone: () => (
    <Path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  hangup: () => (
    <Path d="M3.7 14.6l2-1.6a1.8 1.8 0 0 0 .6-2l-.5-1.7a14 14 0 0 1 12.4 0l-.5 1.7a1.8 1.8 0 0 0 .6 2l2 1.6a1.8 1.8 0 0 0 2.4-.2l.6-.7a1.9 1.9 0 0 0 0-2.5C17.9 5.7 6.1 5.7 2.7 11.2a1.9 1.9 0 0 0 0 2.5l.6.7a1.8 1.8 0 0 0 2.4.2z" />
  ),
  video: () => (
    <>
      <Rect x="2" y="6" width="14" height="12" rx="2" />
      <Path d="M16 10l6-3v10l-6-3z" />
    </>
  ),
  videoOff: () => (
    <>
      <Path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5 0h3a2 2 0 0 1 2 2v3.3l1 1 5-3.3v10" />
      <Path d="M2 2l20 20" />
    </>
  ),
  mic: () => (
    <>
      <Rect x="9" y="2" width="6" height="12" rx="3" />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8" />
    </>
  ),
  micOff: () => (
    <>
      <Path d="M15 9.3V5a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 5.1 2.1M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 11.6 5.3M12 18v4M8 22h8" />
      <Path d="M2 2l20 20" />
    </>
  ),
  speaker: () => (
    <>
      <Path d="M11 5L6 9H2v6h4l5 4z" />
      <Path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
    </>
  ),
  speakerOff: () => (
    <>
      <Path d="M11 5L6 9H2v6h4l5 4z" />
      <Path d="M22 9l-6 6M16 9l6 6" />
    </>
  ),
  earpiece: () => (
    <>
      <Rect x="6" y="2" width="12" height="20" rx="3" />
      <Path d="M10 5h4M11 18h2" />
    </>
  ),
  bluetooth: () => <Path d="M7 7l10 10-5 5V2l5 5L7 17" />,
  flip: () => (
    <>
      <Path d="M20 7h-3.2l-1.4-2H8.6L7.2 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
      <Path d="M15 11.5a3 3 0 0 0-5.4-.9M9 15a3 3 0 0 0 5.4.9M9.5 9.5v1.5H11M14.5 16.5V15H13" />
    </>
  ),
  camera: () => (
    <>
      <Path d="M20 7h-3.2l-1.4-2H8.6L7.2 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
      <Circle cx="12" cy="13" r="3.5" />
    </>
  ),
  screen: () => (
    <>
      <Rect x="2" y="4" width="20" height="13" rx="2" />
      <Path d="M8 21h8M12 17v4" />
    </>
  ),
  addPerson: () => (
    <>
      <Circle cx="9" cy="8" r="4" />
      <Path d="M2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6" />
    </>
  ),
  minimize: () => <Path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />,
  fullscreen: () => <Path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />,
  more: (f) => (
    <>
      <Circle cx="12" cy="5" r="1.9" fill={f} stroke="none" />
      <Circle cx="12" cy="12" r="1.9" fill={f} stroke="none" />
      <Circle cx="12" cy="19" r="1.9" fill={f} stroke="none" />
    </>
  ),
  moreH: (f) => (
    <>
      <Circle cx="5" cy="12" r="1.9" fill={f} stroke="none" />
      <Circle cx="12" cy="12" r="1.9" fill={f} stroke="none" />
      <Circle cx="19" cy="12" r="1.9" fill={f} stroke="none" />
    </>
  ),
  emoji: () => (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01" />
    </>
  ),
  emojiAdd: () => (
    <>
      <Path d="M20.9 11.2A9 9 0 1 1 12.8 3" />
      <Path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01M19 2v6M16 5h6" />
    </>
  ),
  send: () => (
    <>
      <Path d="M22 2L11 13" />
      <Path d="M22 2l-7 20-4-9-9-4z" />
    </>
  ),
  reply: () => (
    <>
      <Path d="M9 14L4 9l5-5" />
      <Path d="M4 9h10a6 6 0 0 1 6 6v5" />
    </>
  ),
  photo: () => (
    <>
      <Rect x="3" y="4" width="18" height="16" rx="3" />
      <Circle cx="9" cy="10" r="2" />
      <Path d="M21 16l-5-5-9 9" />
    </>
  ),
  file: () => (
    <>
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <Path d="M14 2v6h6" />
    </>
  ),
  attach: () => <Path d="M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" />,
  search: () => (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="M20 20l-3.5-3.5" />
    </>
  ),
  bell: () => (
    <>
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <Path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  bellOff: () => (
    <>
      <Path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17 17 0 0 1 18 8M6.3 6.3A6 6 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5" />
      <Path d="M2 2l20 20" />
    </>
  ),
  pin: () => <Path d="M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z" />,
  unpin: () => (
    <>
      <Path d="M12 17v5M15 9.3V4H9v1M9 10.8L6 14v2h10" />
      <Path d="M2 2l20 20" />
    </>
  ),
  chats: (f) => <Path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill={f} />,
  chatsLine: () => <Path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />,
  friends: () => (
    <>
      <Circle cx="9" cy="8" r="4" />
      <Path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
      <Circle cx="18" cy="8" r="2.5" />
      <Path d="M18 14c2.5 0 4 1.5 4 4" />
    </>
  ),
  groups: () => (
    <>
      <Circle cx="12" cy="7" r="3.2" />
      <Path d="M6 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <Circle cx="4.8" cy="9.5" r="2.2" />
      <Circle cx="19.2" cy="9.5" r="2.2" />
      <Path d="M1.5 18c0-2.2 1.4-3.6 3.5-3.9M22.5 18c0-2.2-1.4-3.6-3.5-3.9" />
    </>
  ),
  gear: () => (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  edit: () => (
    <>
      <Path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <Path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L12 14.8l-3.6.8.8-3.6z" />
    </>
  ),
  pencil: () => <Path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z" />,
  trash: () => <Path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />,
  copy: () => (
    <>
      <Rect x="9" y="9" width="13" height="13" rx="2" />
      <Path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  flag: () => <Path d="M4 22V4s1.5-1 5-1 5 2 8 2 3-1 3-1v11s-1 1-3 1-5-2-8-2-5 1-5 1" />,
  block: () => (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  lock: () => (
    <>
      <Rect x="4" y="11" width="16" height="10" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  eye: () => (
    <>
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: () => (
    <>
      <Path d="M17.9 17.9A10.1 10.1 0 0 1 12 19c-6.5 0-10-7-10-7a18 18 0 0 1 5.1-5.9M9.9 5.2A9.1 9.1 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2" />
      <Path d="M2 2l20 20" />
    </>
  ),
  play: (f) => <Path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" fill={f} />,
  pause: (f) => (
    <>
      <Rect x="6" y="4" width="4" height="16" rx="1.2" fill={f} />
      <Rect x="14" y="4" width="4" height="16" rx="1.2" fill={f} />
    </>
  ),
  shield: () => <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  logout: () => <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  at: () => (
    <>
      <Circle cx="12" cy="12" r="4" />
      <Path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.9 7.9" />
    </>
  ),
  download: () => <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  share: () => (
    <>
      <Circle cx="18" cy="5" r="3" />
      <Circle cx="6" cy="12" r="3" />
      <Circle cx="18" cy="19" r="3" />
      <Path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </>
  ),
  moon: () => <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  user: () => (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  mail: () => (
    <>
      <Rect x="2" y="4" width="20" height="16" rx="2" />
      <Path d="M22 6l-10 7L2 6" />
    </>
  ),
  key: () => (
    <>
      <Circle cx="7.5" cy="15.5" r="5.5" />
      <Path d="M11.4 11.6L21 2M16 7l3 3M18.5 4.5l2 2" />
    </>
  ),
  info: () => (
    <>
      <Circle cx="12" cy="12" r="10" />
      <Path d="M12 16v-4M12 8h.01" />
    </>
  ),
  alert: () => (
    <>
      <Path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <Path d="M12 9v4M12 17h.01" />
    </>
  ),
  palette: () => (
    <>
      <Circle cx="13.5" cy="6.5" r="1.2" />
      <Circle cx="17.5" cy="10.5" r="1.2" />
      <Circle cx="8.5" cy="7.5" r="1.2" />
      <Circle cx="6.5" cy="12.5" r="1.2" />
      <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16c3 0 5.6-2.5 5.6-5.6C22 6 17.5 2 12 2z" />
    </>
  ),
  link: () => <Path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />,
  refresh: () => <Path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5" />,
  arrowUp: () => <Path d="M12 19V5M5 12l7-7 7 7" />,
  arrowDown: () => <Path d="M12 5v14M19 12l-7 7-7-7" />,
  clock: () => (
    <>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </>
  ),
  door: () => <Path d="M13 4h5a2 2 0 0 1 2 2v14M4 20h16M13 4v16L4 18V6zM10 12h.01" />,
  // Watch Together (0.5.0)
  watch: (fill) => (
    <>
      <Rect x="3" y="5" width="18" height="12" rx="2" />
      <Path d="M8 21h8M12 17v4" />
      <Path d="M10 8.6v4.8l4-2.4z" fill={fill} stroke="none" />
    </>
  ),
  back10: () => (
    <>
      <Path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <Path d="M4 4v4h4" />
    </>
  ),
  forward10: () => (
    <>
      <Path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <Path d="M20 4v4h-4" />
    </>
  ),
  swapVideo: (fill) => (
    <>
      <Path d="M4 7h16M4 12h10M4 17h7" />
      <Path d="M17 14l4 3-4 3z" fill={fill} />
    </>
  ),
  gamepad: () => (
    <>
      <Rect x="2" y="7" width="20" height="11" rx="5" />
      <Path d="M7 10v4M5 12h4M15 11h.01M18 13h.01" />
    </>
  ),
  // 0.5.0 chat extras
  gif: () => (
    <>
      <Rect x="2.5" y="5" width="19" height="14" rx="3.5" />
      <Path d="M9.5 10.2a2 2 0 1 0 0 3.6v-1.6H8.6M12.5 10v4M15 14v-4h2.6M15 12h2" />
    </>
  ),
  poll: () => <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  lantern: () => (
    <>
      <Path d="M9 3h6M12 3v2M8 7h8l1 3v5l-1 3H8l-1-3v-5zM9 21h6M12 18v3" />
      <Path d="M12 10.5c1 .9 1.2 1.8.6 2.7-.4.5-1 .6-1.4.2-.5-.5-.3-1.4.8-2.9z" />
    </>
  ),
}

export type IconName = keyof typeof strokes

export function Icon({
  name,
  size = 22,
  color = '#000',
  strokeWidth = 2,
  fill,
}: {
  name: IconName
  size?: number
  color?: string
  strokeWidth?: number
  /** For the few solid icons (active tab, play/pause, dots): defaults to the color. */
  fill?: string
}) {
  const draw = strokes[name]
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {draw ? draw(fill ?? color) : null}
    </Svg>
  )
}

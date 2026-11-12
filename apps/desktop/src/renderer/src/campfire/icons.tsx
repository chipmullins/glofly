// The Campfire boards' line icons (24 × 24, 2 px strokes).

const PATHS: Record<string, React.ReactNode> = {
  // 0.11.2: Chats (raises the Glofly dock)
  chat: (
    <path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H10l-4 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
  ),
  select: <path d="M4 3l7 17 2.5-7.5L21 10z" />,
  measure: (
    <>
      <path d="M3 17L17 3l4 4L7 21z" />
      <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
    </>
  ),
  ping: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
    </>
  ),
  fog: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18" />
    </>
  ),
  draw: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  template: (
    <>
      <path d="M4 14h16M6 18h12M3 10h18" />
      <path d="M8 6h8" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 17l-5-5-9 8" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.1A10 10 0 0 1 22 12a17 17 0 0 1-3 3.6M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1" />
    </>
  ),
  next: (
    <>
      <path d="M5 4l10 8-10 8z" />
      <path d="M19 5v14" />
    </>
  ),
  dice: (
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M12 22V12M21 7l-9 5-9-5" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
    </>
  ),
  micOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M9 9v2a3 3 0 0 0 5 2.2M15 9.3V5a3 3 0 0 0-5.7-1.3M19 10v1a7 7 0 0 1-1.1 3.8M5 10v1a7 7 0 0 0 11 5.7M12 18v4" />
    </>
  ),
  leave: (
    <>
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h12a4 4 0 0 1 0 8" />
    </>
  ),
  room: <rect x="4" y="4" width="16" height="16" rx="1" />,
  wall: <path d="M4 20L20 4" />,
  pen: <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />,
  erase: (
    <>
      <path d="M20 20H9l-5-5 10-10 7 7-6 6" />
      <path d="M7 12l6 6" />
    </>
  ),
  note: (
    <>
      <path d="M4 4h16v12l-4 4H4z" />
      <path d="M16 20v-4h4" />
    </>
  ),
  undo: <path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />
}

export function Icon({ name, size = 20 }: { name: string; size?: number }): React.JSX.Element {
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
      {PATHS[name] ?? null}
    </svg>
  )
}

export function FlameIcon({ size = 20 }: { size?: number }): React.JSX.Element {
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
      <path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z" />
    </svg>
  )
}

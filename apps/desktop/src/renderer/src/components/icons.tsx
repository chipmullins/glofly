// Line icons used across Glofly, copied from the design canvas.

type IconProps = { size?: number; strokeWidth?: number }

function Svg({
  size = 20,
  strokeWidth = 1.8,
  children
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
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
    >
      {children}
    </svg>
  )
}

export function SearchIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={2} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Svg>
  )
}

export function SettingsIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </Svg>
  )
}

export function FriendsIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M18 14c2.5 0 4 1.5 4 4" />
    </Svg>
  )
}

export function PlusIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={2} {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function AddFriendIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={2.2} {...p}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
      <path d="M19 8v6M16 11h6" />
    </Svg>
  )
}

export function LogOutIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={1.9} {...p}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </Svg>
  )
}

export function ChatIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={19} strokeWidth={1.9} {...p}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </Svg>
  )
}

export function CloseIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={2.2} {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  )
}

export function MoreIcon({ size = 19 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  )
}

export function BlockIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={1.9} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </Svg>
  )
}

export function RemoveFriendIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={18} strokeWidth={1.9} {...p}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
      <path d="M16 11h6" />
    </Svg>
  )
}

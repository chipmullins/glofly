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

export function ProfileIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
    </Svg>
  )
}

export function CameraIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  )
}

export function CalendarIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Svg>
  )
}

export function DownloadIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </Svg>
  )
}

export function FileIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Svg>
  )
}

export function PhotoIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 16l-5-5-9 9" />
    </Svg>
  )
}

export function ChevronIcon({
  direction,
  ...p
}: IconProps & { direction: 'left' | 'right' }): React.JSX.Element {
  return (
    <Svg {...p}>
      {direction === 'left' ? <path d="M15 5l-7 7 7 7" /> : <path d="M9 5l7 7-7 7" />}
    </Svg>
  )
}

/** Group chats: three people */
export function GroupIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M6 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="5" cy="10" r="2.2" />
      <path d="M1.5 18.5c0-2.2 1.5-3.7 3.5-3.7" />
      <circle cx="19" cy="10" r="2.2" />
      <path d="M22.5 18.5c0-2.2-1.5-3.7-3.5-3.7" />
    </Svg>
  )
}

/** Leave group: a door with an arrow out */
export function LeaveIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="M15 8l4 4-4 4" />
      <path d="M19 12H9" />
    </Svg>
  )
}

export function PencilIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </Svg>
  )
}

// ---------- Calls (from Calling.dc.html, Incoming.dc.html and GroupCall.dc.html) ----------

const PHONE =
  'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'

export function PhoneIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <path d={PHONE} />
    </Svg>
  )
}

/** The phone tipped down: hang up / decline. */
export function HangUpIcon({ size = 24, strokeWidth = 2 }: IconProps): React.JSX.Element {
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
      style={{ transform: 'rotate(135deg)' }}
    >
      <path d={PHONE} />
    </svg>
  )
}

export function VideoIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3z" />
    </Svg>
  )
}

export function VideoOffIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <path d="M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1M10 6h4a2 2 0 0 1 2 2v3l6-4v10" />
      <path d="M3 3l18 18" />
    </Svg>
  )
}

export function MicIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </Svg>
  )
}

export function MicOffIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
      <path d="M3 3l18 18" />
    </Svg>
  )
}

export function ScreenShareIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M12 13V7M9 10l3-3 3 3" />
    </Svg>
  )
}

export function StopShareIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={1.9} {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M9.5 7.5l5 5M14.5 7.5l-5 5" />
    </Svg>
  )
}

/** Sound bars next to someone who's talking. */
export function SpeakingIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={14} strokeWidth={2.2} {...p}>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </Svg>
  )
}

export function MessageBubbleIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={16} strokeWidth={2} {...p}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </Svg>
  )
}

export function FullscreenIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  )
}

/** A game controller, next to "Playing …". */
export function GameIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
      <path d="M17.3 5H6.7a4 4 0 0 0-3.96 3.43L2 14.6A2.7 2.7 0 0 0 4.66 18c.98 0 1.86-.55 2.3-1.42L8 15h8l1.04 1.58A2.6 2.6 0 0 0 19.34 18 2.7 2.7 0 0 0 22 14.6l-.74-6.17A4 4 0 0 0 17.3 5z" />
    </Svg>
  )
}

export function ExitFullscreenIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Svg>
  )
}

/** Make the call bigger (arrows pointing out). */
export function ExpandIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </Svg>
  )
}

/** Make the call smaller (arrows pointing in). */
export function ShrinkIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7" />
    </Svg>
  )
}

/** The arrow on a call line in the chat ("Chip started a video call"). */
export function CallLineIcon({ missed = false }: { missed?: boolean }): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ transform: missed ? 'rotate(135deg)' : 'rotate(-45deg)' }}
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

// ---------- 0.2.0: groups page, mute, mentions, reports, call audio ----------

/** Mute: a bell with a line through it */
export function BellOffIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      <path d="M18 13V9a6 6 0 0 0-9.3-5" />
      <path d="M6.3 6.3A6 6 0 0 0 6 9c0 5-2 7-3 8h14" />
      <path d="M3 3l18 18" />
    </Svg>
  )
}

/** Unmute: a bell */
export function BellIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 7 3 8H3c1-1 3-3 3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </Svg>
  )
}

export function ArrowUpIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </Svg>
  )
}

export function ArrowDownIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </Svg>
  )
}

/** Drag handle: six dots */
export function GripIcon(p: IconProps): React.JSX.Element {
  return (
    <svg
      width={p.size ?? 16}
      height={p.size ?? 16}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

/** Report: a flag */
export function FlagIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" />
    </Svg>
  )
}

/** Call audio: a speaker with sound waves */
export function SpeakerIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19.5 5.5a9 9 0 0 1 0 13" />
    </Svg>
  )
}

/** A megaphone (announcements) */
export function MegaphoneIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M3 10v4a1 1 0 0 0 1 1h3l8 4V5L7 9H4a1 1 0 0 0-1 1z" />
      <path d="M19 9a4 4 0 0 1 0 6" />
    </Svg>
  )
}

/** Muted for you (a person's volume in a call): a speaker with a cross */
export function SpeakerOffIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg size={14} strokeWidth={2.2} {...p}>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M17 9l5 5M22 9l-5 5" />
    </Svg>
  )
}

/** Call layout: two people side by side. */
export function SideBySideIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="8" height="14" rx="2" />
      <rect x="13" y="5" width="8" height="14" rx="2" />
    </Svg>
  )
}

/** Call layout: them filling the frame, you small in the corner. */
export function FullFrameIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="13" y="12" width="6" height="5" rx="1" />
    </Svg>
  )
}

/** Call layout: back to everyone in a grid. */
export function GridIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </Svg>
  )
}

/** Shrink your own camera preview to a small chip. */
export function MinimizeIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg strokeWidth={2} {...p}>
      <path d="M5 12h14" />
    </Svg>
  )
}

// ---- Watch Together (0.5.0) ----

/** A screen with a play mark: the Watch button. */
export function WatchIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8M12 17v4" />
      <path d="M10 8.6v4.8l4-2.4z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function PlayIcon({ size = 20 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.6-6.8c.6-.4.6-1.3 0-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z" />
    </svg>
  )
}

export function PauseIcon({ size = 20 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  )
}

/** Back 10 seconds (a circle arrow with 10 in it). */
export function BackTenIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4h4" />
      <text
        x="12"
        y="15.2"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </Svg>
  )
}

/** Forward 10 seconds. */
export function ForwardTenIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4h-4" />
      <text
        x="12"
        y="15.2"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </Svg>
  )
}

/** Swap for another video. */
export function SwapVideoIcon(p: IconProps): React.JSX.Element {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h10M4 17h7" />
      <path d="M17 14l4 3-4 3z" fill="currentColor" />
    </Svg>
  )
}

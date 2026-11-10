import { useEffect, useRef } from 'react'
import type { CharacterView } from '@glofly/shared/campfire/types'
import { colorsFor } from '../lib/avatarColors'
import { fileUrl } from './api'

// Pieces the sheet window and the stat block share: the window itself (a dialog over the table
// that keeps focus inside, closes on Escape and gives focus back), the portrait, and icons.

export function CfWindow({
  label,
  onClose,
  className,
  children
}: {
  label: string
  onClose: () => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.focus()
    return () => before?.focus?.()
  }, [])
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    // Focus stays in the window.
    const all = [
      ...box.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ].filter((el) => el.offsetParent !== null)
    if (!all.length) return
    const first = all[0]
    const last = all[all.length - 1]
    if (
      e.shiftKey &&
      (document.activeElement === first || document.activeElement === box.current)
    ) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
  return (
    <div
      className="cfs-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={box}
        className={`cfs-window ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        {children}
      </div>
    </div>
  )
}

export function Portrait({
  ch,
  size = 64,
  ring
}: {
  ch: Pick<CharacterView, 'id' | 'name' | 'portraitFileId'>
  size?: number
  ring?: 'good' | 'danger'
}): React.JSX.Element {
  const [bg, fg] = colorsFor(ch.id)
  return (
    <span
      className={`cfs-portrait cfs-portrait--${ring ?? 'good'}`}
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.38)
      }}
      aria-hidden="true"
    >
      {ch.portraitFileId ? (
        <img src={fileUrl(ch.portraitFileId)} alt="" />
      ) : (
        (ch.name[0] ?? '?').toUpperCase()
      )}
    </span>
  )
}

const PATHS: Record<string, React.ReactNode> = {
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  die: (
    <>
      <path d="M12 2l9 5v10l-9 5-9-5V7z" />
      <path d="M12 22V12M21 7l-9 5-9-5" />
    </>
  ),
  boot: <path d="M7 3v9l-3 5v4h16v-3l-6-3V3z" />,
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z" />
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  picture: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M21 17l-5-5-9 8" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  )
}

export function SvgIcon({
  name,
  size = 16
}: {
  name: keyof typeof PATHS
  size?: number
}): React.JSX.Element {
  return (
    <svg
      className="cfs-icon"
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
      {PATHS[name]}
    </svg>
  )
}

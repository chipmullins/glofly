import { useEffect, useRef, useState } from 'react'
import type { PresenceStatus } from '../../../preload/api-types'
import { STATUS_LABEL } from '../lib/presence'

type StatusDotProps = {
  status: PresenceStatus
  /** "Active on mobile": a small phone in the status color instead of the dot. */
  mobile?: boolean
  /** Color of the ring around the dot: the background behind the avatar. */
  ring?: string
  size?: number
}

/**
 * The dot on an avatar, from the design: green (online), a yellow moon (away),
 * red with a dash (do not disturb), and a gray ring (offline).
 */
export default function StatusDot({
  status,
  ring = 'var(--glo-surface)',
  size = 12,
  mobile = false
}: StatusDotProps): React.JSX.Element {
  // 0.7.5: when someone's status changes, the new dot pops in gently (not on first show).
  const shown = useRef<string | null>(null)
  const key = `${status}${mobile ? '-m' : ''}`
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    const first = shown.current === null
    shown.current = key
    if (first) return
    setChanged(true)
    const t = setTimeout(() => setChanged(false), 450)
    return () => clearTimeout(t)
  }, [key])
  if (mobile && status !== 'offline') {
    const label = status === 'online' ? 'Active on mobile' : `${STATUS_LABEL[status]} · on mobile`
    return (
      <span
        key={key}
        className={`status-phone status-phone--${status}${changed ? ' status-changed' : ''}`}
        style={{
          width: Math.round(size * 0.78),
          height: Math.round(size * 1.18),
          ['--ring' as string]: ring
        }}
        role="img"
        aria-label={label}
        title={label}
      />
    )
  }
  return (
    <span
      key={key}
      className={`status-dot status-dot--${status}${changed ? ' status-changed' : ''}`}
      style={{ width: size, height: size, ['--ring' as string]: ring }}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    />
  )
}

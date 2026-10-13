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
  if (mobile && status !== 'offline') {
    const label = status === 'online' ? 'Active on mobile' : `${STATUS_LABEL[status]} · on mobile`
    return (
      <span
        className={`status-phone status-phone--${status}`}
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
      className={`status-dot status-dot--${status}`}
      style={{ width: size, height: size, ['--ring' as string]: ring }}
      role="img"
      aria-label={STATUS_LABEL[status]}
      title={STATUS_LABEL[status]}
    />
  )
}

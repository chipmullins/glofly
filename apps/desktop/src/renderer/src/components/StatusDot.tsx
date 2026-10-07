import type { PresenceStatus } from '../../../preload/api-types'
import { STATUS_LABEL } from '../lib/presence'

type StatusDotProps = {
  status: PresenceStatus
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
  size = 12
}: StatusDotProps): React.JSX.Element {
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

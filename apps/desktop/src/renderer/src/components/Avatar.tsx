import { useState } from 'react'
import type { PresenceStatus } from '../../../preload/api-types'
import { avatarUrl } from '../lib/media'
import { initials } from '../lib/names'
import StatusDot from './StatusDot'
import { colorsFor } from '../lib/avatarColors'

// Round avatar: the person's profile photo, or their initials in a steady color.

type AvatarProps = {
  id: string
  name: string
  /** Their current photo, if they have one. */
  avatarVersion?: string | null
  size?: number
  /** Shows a status dot when given. */
  status?: PresenceStatus
  /** Background behind the avatar, used as the ring around the dot. */
  ring?: string
  /** Your own avatar: orange, like the design. */
  mine?: boolean
  className?: string
}

/** The photo, falling back to initials if it can't be loaded. */
export function AvatarFace({
  id,
  name,
  avatarVersion
}: {
  id: string
  name: string
  avatarVersion?: string | null
}): React.JSX.Element {
  const url = avatarVersion ? avatarUrl(id, avatarVersion) : null
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  if (!url || url === failedUrl) return <>{initials(name)}</>
  return (
    <img
      className="avatar-photo"
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailedUrl(url)}
    />
  )
}

/** Dot sizes from the design: 30px on a profile card, 13px on list avatars. */
const dotSize = (size: number): number => (size >= 100 ? 30 : size >= 44 ? 13 : 12)

export default function Avatar({
  id,
  name,
  avatarVersion,
  size = 44,
  status,
  ring,
  mine,
  className
}: AvatarProps): React.JSX.Element {
  const [bg, fg] = mine ? ['var(--glo-orange)', '#2A1406'] : colorsFor(id)
  return (
    <span
      className={className ? `avatar ${className}` : 'avatar'}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.34)
      }}
    >
      <AvatarFace id={id} name={name} avatarVersion={avatarVersion} />
      {status && <StatusDot status={status} ring={ring} size={dotSize(size)} />}
    </span>
  )
}

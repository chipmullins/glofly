import { useState } from 'react'
import type { PublicUser } from '../../../preload/api-types'
import Avatar from './Avatar'
import { groupPhotoUrl } from '../lib/media'
import { GroupIcon } from './icons'

/**
 * A group's picture: its group photo (with a small three-people badge, so it can't be taken
 * for a person), or two members' avatars overlapping, like a little crowd.
 * `ring` is the background behind it, so the front avatar and the badge get a clean edge.
 */
export default function GroupAvatar({
  members,
  me,
  size = 40,
  ring = 'var(--glo-sidebar)',
  group
}: {
  /** Everyone else in the group */
  members: PublicUser[]
  /** Shown as the second face when you're the only other one left */
  me: PublicUser
  size?: number
  ring?: string
  /** The group, for its photo (0.2.1) */
  group?: { id: string; photoVersion?: string | null }
}): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  const version = group?.photoVersion ?? null
  if (group && version && failed !== version) {
    const badge = Math.max(14, Math.round(size * 0.4))
    return (
      <span className="group-photo" aria-hidden="true" style={{ width: size, height: size }}>
        <img
          className="group-photo-img"
          src={groupPhotoUrl(group.id, version)}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onError={() => setFailed(version)}
        />
        <span
          className="group-photo-badge"
          style={{ width: badge, height: badge, boxShadow: `0 0 0 2px ${ring}` }}
        >
          <GroupBadgeIcon size={Math.round(badge * 0.72)} />
        </span>
      </span>
    )
  }
  const faces = [members[0], members[1] ?? (members[0] ? me : undefined)].filter(
    (p): p is PublicUser => !!p
  )
  if (faces.length < 2) {
    return (
      <span
        className="avatar group-avatar--empty"
        aria-hidden="true"
        style={{ width: size, height: size }}
      >
        <GroupIcon size={Math.round(size * 0.55)} />
      </span>
    )
  }
  const small = Math.round(size * 0.66)
  return (
    <span className="group-avatar" aria-hidden="true" style={{ width: size, height: size }}>
      <span className="group-avatar-back">
        <Avatar
          id={faces[1].id}
          name={faces[1].displayName}
          avatarVersion={faces[1].avatarVersion}
          size={small}
        />
      </span>
      <span className="group-avatar-front" style={{ boxShadow: `0 0 0 2px ${ring}` }}>
        <Avatar
          id={faces[0].id}
          name={faces[0].displayName}
          avatarVersion={faces[0].avatarVersion}
          size={small}
        />
      </span>
    </span>
  )
}

/** Three people, filled (it stays readable at badge size). */
function GroupBadgeIcon({ size }: { size: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="7.5" r="3.6" />
      <path d="M5.6 20.5c0-3.9 2.9-6.6 6.4-6.6s6.4 2.7 6.4 6.6z" />
      <circle cx="4.6" cy="10" r="2.6" />
      <path d="M0 19.6c0-2.9 1.9-4.8 4.4-4.8 1 0 1.9.3 2.6.8-1.4 1.3-2.3 3.1-2.5 5.2H0z" />
      <circle cx="19.4" cy="10" r="2.6" />
      <path d="M24 19.6c0-2.9-1.9-4.8-4.4-4.8-1 0-1.9.3-2.6.8 1.4 1.3 2.3 3.1 2.5 5.2H24z" />
    </svg>
  )
}

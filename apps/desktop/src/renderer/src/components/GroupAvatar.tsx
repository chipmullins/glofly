import type { PublicUser } from '../../../preload/api-types'
import Avatar from './Avatar'
import { GroupIcon } from './icons'

/**
 * A group's picture: two members' avatars overlapping, like a little crowd.
 * `ring` is the background behind it, so the front avatar gets a clean edge.
 */
export default function GroupAvatar({
  members,
  me,
  size = 40,
  ring = 'var(--glo-sidebar)'
}: {
  /** Everyone else in the group */
  members: PublicUser[]
  /** Shown as the second face when you're the only other one left */
  me: PublicUser
  size?: number
  ring?: string
}): React.JSX.Element {
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

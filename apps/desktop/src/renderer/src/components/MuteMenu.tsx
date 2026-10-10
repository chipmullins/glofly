import { useState } from 'react'
import type { ConversationSummary, MuteDuration } from '../../../preload/api-types'
import { isMuted, MUTE_CHOICES, mutedLabel } from '../lib/mentions'
import { MenuItem } from './ContextMenu'
import { BellIcon, BellOffIcon } from './icons'

/**
 * "Mute chat" in a right-click menu. Clicking it shows how long for, in the same menu
 * (1 hour, 8 hours, 24 hours, until you turn it back on). A muted chat shows Unmute instead.
 */
export default function MuteMenuItems({
  conversation,
  onMute,
  onClose
}: {
  conversation: ConversationSummary
  /** null unmutes */
  onMute: (duration: MuteDuration | null) => void
  onClose: () => void
}): React.JSX.Element {
  const [choosing, setChoosing] = useState(false)
  const muted = isMuted(conversation)
  const noun = conversation.kind === 'group' ? 'group' : 'chat'

  if (muted && conversation.mutedUntil) {
    return (
      <MenuItem icon={<BellIcon size={18} />} onClose={onClose} onClick={() => onMute(null)}>
        <span className="menu-item-text">
          Unmute {noun}
          <span className="menu-item-sub">{mutedLabel(conversation.mutedUntil)}</span>
        </span>
      </MenuItem>
    )
  }
  if (!choosing) {
    return (
      <button
        type="button"
        role="menuitem"
        className="menu-item"
        aria-expanded={false}
        onClick={() => setChoosing(true)}
      >
        <BellOffIcon size={18} />
        Mute {noun}…
      </button>
    )
  }
  return (
    <div role="group" aria-label={`Mute ${noun}`} className="menu-subgroup">
      <span className="menu-subhead">Mute {noun}</span>
      {MUTE_CHOICES.map((c, i) => (
        <button
          key={c.duration}
          type="button"
          role="menuitem"
          className="menu-item menu-item--indent"
          autoFocus={i === 0}
          onClick={() => {
            onClose()
            onMute(c.duration)
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  )
}

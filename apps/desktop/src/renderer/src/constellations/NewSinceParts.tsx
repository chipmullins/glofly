import { sinceLabel, type NewSince } from './newSince'
import './Feel.css'

// 0.7.5 "New since you left" (canvas board 7, approved): the glowing line and the pill.

export function NewSinceLine({ since }: { since: string }): React.JSX.Element {
  const label = sinceLabel(since)
  return (
    <div
      className="cx-newline"
      role="separator"
      aria-label={`New messages since you left at ${label}`}
    >
      <span className="cx-newline-glow cx-newline-glow--in" />
      <span className="cx-newline-label">NEW · SINCE YOU LEFT AT {label.toUpperCase()}</span>
      <span className="cx-newline-glow cx-newline-glow--out" />
    </div>
  )
}

export function NewSincePill({
  info,
  onJump,
  onMarkRead
}: {
  info: NewSince
  onJump: () => void
  onMarkRead: () => void
}): React.JSX.Element {
  return (
    <div className="cx-newpill" role="status">
      <button type="button" className="cx-newpill-jump" onClick={onJump}>
        <span aria-hidden="true">↑</span> Jump to first unread
      </button>
      <span className="cx-newpill-text">
        {info.count > 99 ? '99+' : info.count} new since {sinceLabel(info.since)}
      </span>
      <button type="button" className="cx-newpill-read" onClick={onMarkRead}>
        Mark as read
      </button>
    </div>
  )
}

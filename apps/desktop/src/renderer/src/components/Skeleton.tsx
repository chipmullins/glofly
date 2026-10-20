import { useEffect, useState } from 'react'
import './Skeleton.css'

// 0.7.4: shaped placeholders while a list loads, instead of a spinner or an empty page. They
// only appear after a short wait (a quick load never flickers), shimmer softly (not at all with
// "reduce motion"), and use the theme's colours so they look right in light and dark.

const SHOW_AFTER_MS = 150

function useShowAfterDelay(): boolean {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), SHOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [])
  return show
}

// Varied line lengths so the rows don't look stamped out.
const NAME_WIDTHS = [62, 48, 70, 55, 40, 66, 52]
const LINE_WIDTHS = [84, 72, 90, 64, 78, 58, 80]

/** Rows of circle + two lines: the chat list and the friends list. */
export function ListSkeleton({
  rows = 6,
  label
}: {
  rows?: number
  /** Read out to screen readers, e.g. "Loading chats" */
  label: string
}): React.JSX.Element | null {
  const show = useShowAfterDelay()
  if (!show) return null
  return (
    <div className="skeleton-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skeleton-row" key={i} aria-hidden="true">
          <span className="skeleton skeleton-circle" />
          <span className="skeleton-lines">
            <span
              className="skeleton skeleton-line"
              style={{ width: `${NAME_WIDTHS[i % NAME_WIDTHS.length]}%` }}
            />
            <span
              className="skeleton skeleton-line skeleton-line--thin"
              style={{ width: `${LINE_WIDTHS[i % LINE_WIDTHS.length]}%` }}
            />
          </span>
        </div>
      ))}
    </div>
  )
}

// Like Glofly's real message rows: avatar, then a name line and one or two lines of text.
// Some rows are follow-ups from the same person (no avatar or name), like a real chat.
const MESSAGE_ROWS: { name: number; lines: number[] }[] = [
  { name: 22, lines: [58] },
  { name: 0, lines: [40] },
  { name: 18, lines: [72, 46] },
  { name: 26, lines: [34] },
  { name: 0, lines: [52] },
  { name: 20, lines: [64] },
  { name: 24, lines: [44, 28] }
]

/** Message rows: a chat opening for the first time. */
export function MessagesSkeleton(): React.JSX.Element | null {
  const show = useShowAfterDelay()
  if (!show) return null
  return (
    <div className="skeleton-messages" role="status" aria-label="Loading messages">
      {MESSAGE_ROWS.map((r, i) => (
        <div
          key={i}
          className={r.name ? 'skeleton-message' : 'skeleton-message skeleton-message--follow'}
          aria-hidden="true"
        >
          {r.name > 0 && <span className="skeleton skeleton-circle" />}
          <span className="skeleton-lines">
            {r.name > 0 && (
              <span className="skeleton skeleton-line" style={{ width: `${r.name}%` }} />
            )}
            {r.lines.map((w, j) => (
              <span
                key={j}
                className="skeleton skeleton-line skeleton-line--text"
                style={{ width: `${w}%` }}
              />
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

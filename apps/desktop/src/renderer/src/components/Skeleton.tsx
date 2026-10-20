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

// Theirs on the left, mine on the right, in a believable rhythm.
const BUBBLES: { mine: boolean; width: number; tall?: boolean }[] = [
  { mine: false, width: 46 },
  { mine: false, width: 30 },
  { mine: true, width: 38 },
  { mine: false, width: 56, tall: true },
  { mine: true, width: 26 },
  { mine: true, width: 44 },
  { mine: false, width: 34 }
]

/** Alternating message bubbles: a chat opening for the first time. */
export function MessagesSkeleton(): React.JSX.Element | null {
  const show = useShowAfterDelay()
  if (!show) return null
  return (
    <div className="skeleton-messages" role="status" aria-label="Loading messages">
      {BUBBLES.map((b, i) => (
        <div
          key={i}
          className={
            b.mine ? 'skeleton-bubble-row skeleton-bubble-row--mine' : 'skeleton-bubble-row'
          }
          aria-hidden="true"
        >
          {!b.mine && <span className="skeleton skeleton-circle skeleton-circle--small" />}
          <span
            className={
              b.tall ? 'skeleton skeleton-bubble skeleton-bubble--tall' : 'skeleton skeleton-bubble'
            }
            style={{ width: `${b.width}%` }}
          />
        </div>
      ))}
    </div>
  )
}

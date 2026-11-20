import { useEffect, useRef } from 'react'
import type { WhatsNewEntry } from '@glofly/shared/whatsNew'
import './dialogs.css'
import './WhatsNew.css'

// 0.11.3: a "What's new" window on the first launch after an update. Notes from shared
// whatsNew.ts; lib/whatsNew.ts decides when it shows.

export default function WhatsNew({
  notes,
  onClose
}: {
  notes: WhatsNewEntry[]
  onClose: () => void
}): React.JSX.Element | null {
  const okRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    okRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const top = notes[0]
  if (!top) return null
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="dialog whats-new"
      >
        <div className="whats-new-head">
          <span className="whats-new-kicker">What’s new in Glofly {top.version}</span>
          <h1 id="whats-new-title">{top.headline}</h1>
        </div>
        <div className="whats-new-body">
          {notes.map((n, ni) => (
            <section key={n.version} aria-label={`Glofly ${n.version}`}>
              {ni > 0 && (
                <h2 className="whats-new-older">
                  Also in {n.version}: {n.headline}
                </h2>
              )}
              <ul>
                {n.items.map((i) => (
                  <li key={i.title}>
                    <b>{i.title}</b>
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="whats-new-actions">
          <button
            ref={okRef}
            type="button"
            className="small-button small-button--primary"
            onClick={onClose}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}

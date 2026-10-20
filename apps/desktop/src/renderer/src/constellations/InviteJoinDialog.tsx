import { useEffect, useRef } from 'react'
import InviteCard from './InviteCard'

// 0.7.5: Glofly in a browser opened from an invite page's "use it in your browser"
// (chat.glofly.app/?join=<code>): the invite card in a small dialog, so joining is still your
// choice (nothing joins by itself).

export function InviteJoinDialog({
  code,
  onClose,
  onProblem
}: {
  code: string
  onClose: () => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div
      className="cx-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Constellation invite"
        className="cx-dialog cx-dialog--small cx-join-invite"
      >
        <div className="cx-dialog-body">
          <h1>You&apos;re invited</h1>
          <InviteCard code={code} compact onOpened={onClose} onProblem={onProblem} />
          <div className="cx-dialog-actions">
            <button type="button" className="cx-button" onClick={onClose}>
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

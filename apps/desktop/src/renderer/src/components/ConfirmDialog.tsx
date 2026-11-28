import { useEffect, useRef } from 'react'
import './dialogs.css'

type ConfirmDialogProps = {
  title: string
  message: string
  /** 0.12.0: a smaller second line under the message */
  note?: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** "Are you sure?" box for actions that are hard to undo. */
export default function ConfirmDialog({
  title,
  message,
  note,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Always call the latest onCancel, without re-running the effect (which would steal focus).
  const onCancelRef = useRef(onCancel)
  useEffect(() => {
    onCancelRef.current = onCancel
  })

  useEffect(() => {
    cancelRef.current?.focus() // the safe choice is focused, so Enter doesn't confirm by accident
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancelRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="dialog confirm"
      >
        <h1 id="confirm-title">{title}</h1>
        <p id="confirm-message">{message}</p>
        {note && <p className="confirm-note">{note}</p>}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="small-button small-button--quiet"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={
              danger ? 'small-button small-button--danger' : 'small-button small-button--primary'
            }
            disabled={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  STATUS_CLEAR_AFTER,
  STATUS_CLEAR_LABEL,
  statusClearChoiceFor,
  statusClearEndsAt,
  statusEndsLine,
  type StatusClearAfter
} from '@glofly/shared/statusClear'
import type { MyStatus, MyStatusChanges, MyStatusChoice } from '../../../preload/api-types'
import { dotFor, STATUS_LABEL } from '../lib/presence'
import StatusDot from './StatusDot'

type StatusMenuProps = {
  current: MyStatus
  onChange: (changes: MyStatusChanges) => Promise<boolean>
  onClose: () => void
}

const CHOICES: { id: MyStatusChoice; hint: string }[] = [
  { id: 'online', hint: '' },
  { id: 'away', hint: "Shows you're not at your computer" },
  { id: 'dnd', hint: "Glofly's sounds stay quiet" },
  { id: 'invisible', hint: 'Appear offline, but keep using Glofly' }
]

const CUSTOM_STATUS_MAX = 80

/** This device's time zone, sent so "Today" and "This week" end at your own midnight. */
function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export default function StatusMenu({
  current,
  onChange,
  onClose
}: StatusMenuProps): React.JSX.Element {
  const [text, setText] = useState(current.statusText ?? '')
  // 0.8.0 Clear after: the one in use if your status has an end, else Never.
  const startClear = current.statusText
    ? statusClearChoiceFor(current.statusTextEndsAt)
    : ('never' as StatusClearAfter)
  const [clear, setClear] = useState<StatusClearAfter>(startClear)
  const [now, setNow] = useState(() => new Date())
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // "(in 4 hours)" stays true while the menu is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // The menu is taller than the space below it in a small window: it scrolls instead of being cut off.
  useLayoutEffect(() => {
    const fit = (): void => {
      const el = menuRef.current
      if (!el) return
      const top = el.getBoundingClientRect().top
      el.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // Close when clicking elsewhere or pressing Escape. Uses the latest onClose without re-running.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (!menuRef.current?.contains(target) && !target.closest('.avatar--me')) closeRef.current()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  async function pick(choice: MyStatusChoice): Promise<void> {
    if (await onChange({ status: choice })) onClose()
  }

  async function saveText(value: string): Promise<void> {
    setSaving(true)
    const trimmed = value.trim()
    const ok = await onChange(
      trimmed
        ? { statusText: trimmed, statusClearAfter: clear, timeZone: localTimeZone() }
        : { statusText: '' }
    )
    setSaving(false)
    if (ok) onClose()
  }

  const textChanged = text.trim() !== (current.statusText ?? '')
  const clearChanged = clear !== startClear
  const canSave = textChanged || (clearChanged && !!text.trim())
  // What the line under the chips says: the real end while nothing changed, else a preview.
  const endsAt =
    !textChanged && !clearChanged && current.statusText
      ? (current.statusTextEndsAt ?? null)
      : statusClearEndsAt(clear, now, localTimeZone() ?? 'UTC')

  return (
    <div className="menu status-menu" ref={menuRef} role="dialog" aria-label="Set your status">
      <p className="status-menu-title">Set your status</p>
      {CHOICES.map((c) => (
        <button
          key={c.id}
          type="button"
          className={current.status === c.id ? 'status-choice status-choice--on' : 'status-choice'}
          aria-pressed={current.status === c.id}
          onClick={() => void pick(c.id)}
        >
          <span className="status-choice-dot">
            <StatusDot status={dotFor(c.id)} ring="var(--glo-surface)" />
          </span>
          <span className="status-choice-text">
            <span className="status-choice-label">{STATUS_LABEL[c.id]}</span>
            {c.hint && <span className="status-choice-hint">{c.hint}</span>}
          </span>
          {current.status === c.id && (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
        </button>
      ))}

      <div className="menu-divider" />

      <label className="custom-status">
        <span className="status-menu-title">Custom status</span>
        <span className="custom-status-row">
          <input
            type="text"
            placeholder="What's happening?"
            maxLength={CUSTOM_STATUS_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void saveText(text)
              }
            }}
          />
          {current.statusText && (
            <button
              type="button"
              className="custom-status-clear"
              aria-label="Clear custom status"
              title="Clear"
              onClick={() => {
                setText('')
                void saveText('')
              }}
            >
              ×
            </button>
          )}
        </span>
        <span className="custom-status-foot">
          <span>
            {text.length}/{CUSTOM_STATUS_MAX}
          </span>
        </span>
      </label>

      <div className="status-clear" role="group" aria-labelledby="status-clear-title">
        <span className="status-clear-title" id="status-clear-title">
          Clear after
        </span>
        <div className="status-clear-chips">
          {STATUS_CLEAR_AFTER.map((id) => (
            <button
              key={id}
              type="button"
              className={
                clear === id ? 'status-clear-chip status-clear-chip--on' : 'status-clear-chip'
              }
              aria-pressed={clear === id}
              onClick={() => setClear(id)}
            >
              {STATUS_CLEAR_LABEL[id]}
            </button>
          ))}
        </div>
        <p className="status-clear-ends" aria-live="polite">
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>{statusEndsLine(endsAt, now)}</span>
        </p>
      </div>
      <div className="status-menu-actions">
        <button
          type="button"
          className="custom-status-save"
          disabled={saving || !canSave}
          onClick={() => void saveText(text)}
        >
          Save
        </button>
      </div>
    </div>
  )
}

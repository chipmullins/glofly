import { useEffect, useRef, useState } from 'react'
import type { MyStatus, MyStatusChoice } from '../../../preload/api-types'
import { dotFor, STATUS_LABEL } from '../lib/presence'
import StatusDot from './StatusDot'

type StatusMenuProps = {
  current: MyStatus
  onChange: (changes: Partial<MyStatus>) => Promise<boolean>
  onClose: () => void
}

const CHOICES: { id: MyStatusChoice; hint: string }[] = [
  { id: 'online', hint: '' },
  { id: 'away', hint: "Shows you're not at your computer" },
  { id: 'dnd', hint: "Glofly's sounds stay quiet" },
  { id: 'invisible', hint: 'Appear offline, but keep using Glofly' }
]

const CUSTOM_STATUS_MAX = 80

export default function StatusMenu({
  current,
  onChange,
  onClose
}: StatusMenuProps): React.JSX.Element {
  const [text, setText] = useState(current.statusText ?? '')
  const [saving, setSaving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
    const ok = await onChange({ statusText: value.trim() })
    setSaving(false)
    if (ok) onClose()
  }

  const textChanged = text.trim() !== (current.statusText ?? '')

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
            <StatusDot status={dotFor(c.id)} ring="#FFFFFF" />
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
          {textChanged && (
            <button
              type="button"
              className="custom-status-save"
              disabled={saving}
              onClick={() => void saveText(text)}
            >
              Save
            </button>
          )}
        </span>
      </label>
    </div>
  )
}

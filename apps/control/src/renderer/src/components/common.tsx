import { useEffect, useId, useRef, type JSX, type ReactNode } from 'react'
import { avatarColor, initials } from '../lib/format'
import { useQuickNotes } from '../lib/quickNotes'

// Small pieces shared by every screen.

export function Avatar({
  id,
  name,
  big,
  invite
}: {
  id: string
  name: string
  big?: boolean
  invite?: boolean
}): JSX.Element {
  return (
    <span
      className={`avatar${big ? ' avatar--big' : ''}${invite ? ' avatar--invite' : ''}`}
      style={{ background: avatarColor(id) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

export type Tone = 'good' | 'warn' | 'bad' | 'purple' | 'plain'

export function Chip({
  tone = 'plain',
  children,
  small
}: {
  tone?: Tone
  children: ReactNode
  small?: boolean
}): JSX.Element {
  return <span className={`chip chip--${tone}${small ? ' chip--small' : ''}`}>{children}</span>
}

const STATUS: Record<string, [string, Tone]> = {
  confirmed: ['Confirmed', 'good'],
  unconfirmed: ['Email not confirmed', 'plain'],
  suspended: ['Suspended', 'bad'],
  deleting: ['Being deleted', 'bad'],
  invited: ['Invited', 'warn'],
  pending: ['Invited', 'warn'],
  invite_expired: ['Invite expired', 'plain'],
  expired: ['Invite expired', 'plain']
}

export function StatusChip({ status, admin }: { status: string; admin?: boolean }): JSX.Element {
  if (admin && (status === 'confirmed' || status === 'unconfirmed'))
    return <Chip tone="purple">Admin</Chip>
  const [label, tone] = STATUS[status] ?? [status, 'plain']
  return <Chip tone={tone}>{label}</Chip>
}

/** A modal dialog: Escape or the backdrop closes it, focus goes to its first field. */
export function Dialog({
  title,
  intro,
  children,
  onClose,
  narrow,
  busy
}: {
  title: string
  intro?: ReactNode
  children: ReactNode
  onClose: () => void
  narrow?: boolean
  busy?: boolean
}): JSX.Element {
  const titleId = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => {
    closeRef.current = onClose
    busyRef.current = busy
  })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    // A field first (quick-note chips sit above the note box), then any button.
    const first =
      ref.current?.querySelector<HTMLElement>(
        'input:not([type=hidden]):not([type=checkbox]), textarea, select'
      ) ?? ref.current?.querySelector<HTMLElement>('button')
    first?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busyRef.current) closeRef.current()
      if (e.key === 'Tab' && ref.current) {
        // Keep Tab inside the dialog.
        const items = [
          ...ref.current.querySelectorAll<HTMLElement>('input, textarea, select, button, a[href]')
        ].filter((el) => !el.hasAttribute('disabled'))
        if (!items.length) return
        const [firstItem, lastItem] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault()
          lastItem.focus()
        } else if (!e.shiftKey && document.activeElement === lastItem) {
          e.preventDefault()
          firstItem.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div
      className="backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busyRef.current) onClose()
      }}
    >
      <div
        ref={ref}
        className={`dialog${narrow ? ' dialog--narrow' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div>
          <h2 id={titleId}>{title}</h2>
          {intro && <p className="intro">{intro}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function NoteField({
  value,
  onChange,
  error,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  error?: string
  placeholder?: string
}): JSX.Element {
  const id = useId()
  // 0.9.0: the saved quick notes as one-tap chips (tap again to clear).
  const quick = useQuickNotes()
  const picked = value.trim()
  return (
    <div className="field">
      <label htmlFor={id}>Note for the audit log</label>
      {quick.length > 0 && (
        <div className="quick-notes" role="group" aria-label="Quick notes">
          {quick.map((n) => (
            <button
              key={n}
              type="button"
              className="quick-note"
              aria-pressed={picked === n}
              onClick={() => onChange(picked === n ? '' : n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={id}
        className="textarea"
        rows={2}
        maxLength={500}
        value={value}
        placeholder={placeholder ?? 'Why? A few words, e.g. "Locked out, asked by text"'}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-error`} className="hint hint--error">
          {error}
        </span>
      )}
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  autoComplete = 'off',
  maxLength,
  prefix
}: {
  label: string
  value: string
  onChange: (v: string) => void
  error?: string
  hint?: ReactNode
  type?: string
  autoComplete?: string
  maxLength?: number
  /** Shown inside the box before the text, e.g. "@" for a username */
  prefix?: string
}): JSX.Element {
  const id = useId()
  const input = (
    <input
      id={id}
      className={prefix ? undefined : 'input'}
      type={type}
      value={value}
      maxLength={maxLength}
      autoComplete={autoComplete}
      spellCheck={false}
      aria-invalid={error ? true : undefined}
      aria-describedby={error || hint ? `${id}-help` : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {prefix ? (
        <div className="input-wrap" data-state={error ? 'bad' : undefined}>
          <span className="prefix" aria-hidden="true">
            {prefix}
          </span>
          {input}
        </div>
      ) : (
        input
      )}
      {(error || hint) && (
        <span id={`${id}-help`} className={error ? 'hint hint--error' : 'hint'}>
          {error ?? hint}
        </span>
      )}
    </div>
  )
}

export function Toast({
  message,
  bad,
  onDone
}: {
  message: string
  bad?: boolean
  onDone: () => void
}): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(onDone, bad ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [message, bad, onDone])
  return (
    <div className={`toast${bad ? ' toast--bad' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  )
}

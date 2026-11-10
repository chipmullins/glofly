import { useState } from 'react'

// Small form pieces the table's panels share.

/** A number box that saves when you leave it (or press Enter), not on every key. */
export function NumBox({
  value,
  onChange,
  label,
  min,
  max,
  className,
  disabled
}: {
  value: number
  onChange: (n: number) => void
  label: string
  min?: number
  max?: number
  className?: string
  disabled?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  // A new value from outside (the server, another device) replaces what's shown.
  const [shownFor, setShownFor] = useState(value)
  if (shownFor !== value) {
    setShownFor(value)
    setText(String(value))
  }
  const commit = (): void => {
    const n = Number(text)
    if (!Number.isFinite(n)) return setText(String(value))
    const clamped = Math.round(Math.min(max ?? 1e9, Math.max(min ?? -1e9, n)))
    if (clamped !== value) onChange(clamped)
    setText(String(clamped))
  }
  return (
    <input
      className={`cf-num ${className ?? ''}`}
      inputMode="numeric"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** A text box that saves when you leave it. */
export function TextBox({
  value,
  onChange,
  label,
  placeholder,
  className,
  multiline,
  maxLength,
  disabled
}: {
  value: string
  onChange: (s: string) => void
  label: string
  placeholder?: string
  className?: string
  multiline?: boolean
  maxLength?: number
  disabled?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const [shownFor, setShownFor] = useState(value)
  if (shownFor !== value) {
    setShownFor(value)
    setText(value)
  }
  const commit = (): void => {
    if (text !== value) onChange(text)
  }
  return multiline ? (
    <textarea
      className={`cf-text ${className ?? ''}`}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
    />
  ) : (
    <input
      className={`cf-text ${className ?? ''}`}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      maxLength={maxLength}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

/** The hexagon die face from the boards (a number on orange). */
export function DieFace({
  value,
  size = 44,
  dim
}: {
  value: string | number
  size?: number
  dim?: boolean
}): React.JSX.Element {
  return (
    <span
      className={dim ? 'cf-die cf-die--dim' : 'cf-die'}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
      aria-hidden="true"
    >
      {value}
    </span>
  )
}

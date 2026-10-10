import { useEffect, useLayoutEffect, useRef, useState } from 'react'

// A right-click menu at the pointer (or by a row, from the keyboard's menu key). Kept inside the
// window; closes on Escape, a click elsewhere, or the window losing focus.

export default function ContextMenu({
  x,
  y,
  label,
  onClose,
  children
}: {
  x: number
  y: number
  label: string
  onClose: () => void
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    })
    el.querySelector<HTMLButtonElement>('button')?.focus()
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      // Up/down move between the items.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
        next?.focus()
        e.preventDefault()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      className="menu row-menu"
      style={{ left: pos.left, top: pos.top }}
    >
      {children}
    </div>
  )
}

/** One item in a ContextMenu: closes the menu, then does its thing. */
export function MenuItem({
  icon,
  danger,
  disabled,
  onClose,
  onClick,
  children
}: {
  icon: React.ReactNode
  danger?: boolean
  disabled?: boolean
  onClose: () => void
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      className={danger ? 'menu-item menu-item--danger' : 'menu-item'}
      disabled={disabled}
      onClick={() => {
        onClose()
        onClick()
      }}
    >
      {icon}
      {children}
    </button>
  )
}

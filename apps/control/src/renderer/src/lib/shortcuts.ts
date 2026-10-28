// 0.8.2: keyboard shortcuts. They never fire while typing in a field or while a dialog is open.

export const isMac = (): boolean => window.control.platform === 'darwin'

/** Something modal is showing (a dialog, the command bar, the shortcuts sheet). */
export const modalOpen = (): boolean => document.querySelector('[aria-modal="true"]') !== null

/** The key went to a text field (input, textarea, select or anything editable). */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(target.type)
  }
  return false
}

/** A plain-key shortcut (G, J, K, ?) may run for this key press. */
export const plainShortcut = (e: KeyboardEvent): boolean =>
  !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !typingIn(e.target) && !modalOpen()

/** G then a letter: which page. */
export const GO_KEYS = {
  d: 'dashboard',
  a: 'accounts',
  r: 'reports',
  i: 'inbox',
  c: 'constellations',
  s: 'server',
  l: 'audit',
  e: 'errors',
  n: 'insights'
} as const

/** "?": every shortcut. */
export const SHORTCUTS: { keys: string[]; what: string }[] = [
  { keys: ['Ctrl', 'K'], what: 'Open the command bar (⌘K on a Mac)' },
  { keys: ['G', 'D'], what: 'Dashboard' },
  { keys: ['G', 'N'], what: 'Insights' },
  { keys: ['G', 'A'], what: 'Accounts' },
  { keys: ['G', 'R'], what: 'Reports' },
  { keys: ['G', 'I'], what: 'Inbox' },
  { keys: ['G', 'C'], what: 'Constellations' },
  { keys: ['G', 'S'], what: 'Server' },
  { keys: ['G', 'L'], what: 'Audit log' },
  { keys: ['G', 'E'], what: 'Errors' },
  { keys: ['J'], what: 'Next report (on Reports)' },
  { keys: ['K'], what: 'Previous report (on Reports)' },
  { keys: ['?'], what: 'This list' },
  { keys: ['Esc'], what: 'Close a dialog or the command bar' }
]

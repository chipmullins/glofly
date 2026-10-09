// Small differences between Windows and Mac in what the window shows and listens for.

export const isMac = window.glofly.platform === 'darwin'

/**
 * The app's keyboard shortcuts (Ctrl+K, Ctrl+F) use ⌘ on a Mac. There, Control is left alone
 * because text boxes use it themselves (Control-F moves the cursor, Control-K deletes to the
 * end of the line). Windows accepts Ctrl (or the Windows key), as before.
 */
export const isShortcutKey = (e: KeyboardEvent): boolean =>
  isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey || e.metaKey

/** How a shortcut is written in tooltips: "⌘K" on a Mac, "Ctrl+K" on Windows. */
export const shortcutLabel = (key: string): string => (isMac ? `⌘${key}` : `Ctrl+${key}`)

/** Where the microphone / camera permission lives, for error messages. */
export const privacySettingsPath = (which: 'Microphone' | 'Camera'): string =>
  isMac
    ? `System Settings → Privacy & Security → ${which}`
    : `Windows Settings → Privacy & security → ${which}`

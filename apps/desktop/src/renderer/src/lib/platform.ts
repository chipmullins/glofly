// Small differences between Windows, Mac and the browser (chat.glofly.app) in what the window
// shows and listens for.

/** Glofly in a browser (apps/web), rather than the desktop app. */
export const isWeb = window.glofly.platform === 'web'

/** What this browser can do (only in a browser). */
export const web = window.glofly.web ?? null

/** A Mac (or, in a browser, any Apple device: iPads and Macs use ⌘ for shortcuts). */
export const isMac = window.glofly.platform === 'darwin' || (isWeb && !!web?.apple)

/** A touch screen without a mouse (an iPad in a browser). */
export const isTouch = !!web?.touch

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
  isWeb
    ? `your browser's site settings for Glofly (the icon left of the address) → ${which}`
    : isMac
      ? `System Settings → Privacy & Security → ${which}`
      : `Windows Settings → Privacy & security → ${which}`

/**
 * fetch() options for photos and voice messages: in a browser they come straight from the Glofly
 * server, with the session cookie (the desktop app fetches them in its main process instead).
 */
export const mediaFetchInit: RequestInit | undefined = isWeb
  ? { credentials: 'include' }
  : undefined

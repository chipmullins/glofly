import type { AccentChoice } from '../../../preload/api-types'

// Light or dark, and the accent color, as Settings → Appearance says (Match system is
// worked out in the main process, which follows Windows). The main process tells the
// window at startup and again whenever either changes.

const root = document.documentElement

export function applyAppearance({ accent, dark }: { accent: AccentChoice; dark: boolean }): void {
  root.dataset.theme = dark ? 'dark' : 'light'
  // Glow Orange is the default colors; the others are set with data-accent (main.css).
  if (accent === 'orange') delete root.dataset.accent
  else root.dataset.accent = accent
}

/** Runs once at startup, before anything is drawn, and keeps following changes. */
export function startAppearance(): void {
  applyAppearance(window.glofly.app.initialAppearance)
  startContrast()
  window.glofly.onEvent((event) => {
    if (event.type === 'appearance') applyAppearance(event)
  })
}

// 0.9.3: Contrast (Settings → Appearance), kept on this device. "Match system" follows the
// computer's or browser's own high-contrast / "Increase contrast" setting (prefers-contrast: more).
// High = darker text and stronger lines in light mode, brighter text and lines in dark mode,
// thicker focus rings (main.css, :root[data-contrast='high']).
export type ContrastChoice = 'system' | 'high' | 'standard'
const CONTRAST_KEY = 'glofly.contrast'
const systemMore = typeof matchMedia === 'function' ? matchMedia('(prefers-contrast: more)') : null

export function contrastChoice(): ContrastChoice {
  try {
    const v = localStorage.getItem(CONTRAST_KEY)
    return v === 'high' || v === 'standard' ? v : 'system'
  } catch {
    return 'system'
  }
}

function applyContrast(): void {
  const choice = contrastChoice()
  const high = choice === 'high' || (choice === 'system' && !!systemMore?.matches)
  if (high) root.dataset.contrast = 'high'
  else delete root.dataset.contrast
}

export function setContrastChoice(choice: ContrastChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(CONTRAST_KEY)
    else localStorage.setItem(CONTRAST_KEY, choice)
  } catch {
    // storage off: just for now
  }
  applyContrast()
}

/** Runs once at startup with startAppearance. */
export function startContrast(): void {
  applyContrast()
  systemMore?.addEventListener('change', applyContrast)
  // Another Glofly window (or browser tab) changed it.
  window.addEventListener('storage', (e) => {
    if (e.key === CONTRAST_KEY) applyContrast()
  })
}

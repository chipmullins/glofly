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
  startConstellationsLook()
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

// 0.12.0 (sidebar canvas board 3): Settings → Appearance → "Constellations look", kept on this
// device. Ember night is today's look and stays the default; the rail and the constellation
// sidebar take their colors from --cx-* variables set per look (constellations/Looks.css).
export type ConstellationsLook = 'ember' | 'nightGlow' | 'galaxy' | 'daylight'
export const CONSTELLATIONS_LOOKS: { value: ConstellationsLook; label: string }[] = [
  { value: 'ember', label: 'Ember night' },
  { value: 'nightGlow', label: 'Night Glow' },
  { value: 'galaxy', label: 'Night Glow Galaxy' },
  { value: 'daylight', label: 'Daylight' }
]
const LOOK_KEY = 'glofly.constellationsLook'

export function constellationsLook(): ConstellationsLook {
  try {
    const v = localStorage.getItem(LOOK_KEY)
    return CONSTELLATIONS_LOOKS.some((l) => l.value === v) ? (v as ConstellationsLook) : 'ember'
  } catch {
    return 'ember'
  }
}

function applyLook(): void {
  const look = constellationsLook()
  if (look === 'ember') delete root.dataset.cxLook
  else root.dataset.cxLook = look
}

export function setConstellationsLook(look: ConstellationsLook): void {
  try {
    if (look === 'ember') localStorage.removeItem(LOOK_KEY)
    else localStorage.setItem(LOOK_KEY, look)
  } catch {
    // storage off: just for now
  }
  applyLook()
}

function startConstellationsLook(): void {
  applyLook()
  window.addEventListener('storage', (e) => {
    if (e.key === LOOK_KEY) applyLook()
  })
}

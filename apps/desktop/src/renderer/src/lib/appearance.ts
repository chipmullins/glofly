import type { AccentChoice } from '../../../preload/api-types'

// Light or dark, and the accent color, as Settings → Appearance says (Match system is
// worked out in the main process, which follows Windows). The main process tells the
// window at startup and again whenever either changes.

const root = document.documentElement

export function applyAppearance({ accent, dark }: { accent: AccentChoice; dark: boolean }): void {
  root.dataset.theme = dark ? 'dark' : 'light'
  if (accent === 'red') root.dataset.accent = 'red'
  else delete root.dataset.accent
}

/** Runs once at startup, before anything is drawn, and keeps following changes. */
export function startAppearance(): void {
  applyAppearance(window.glofly.app.initialAppearance)
  window.glofly.onEvent((event) => {
    if (event.type === 'appearance') applyAppearance(event)
  })
}

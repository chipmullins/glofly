import { createContext, createElement, useContext, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { create } from 'zustand'

// Colors from the "Glofly Mobile" design canvas (Glow Orange, light and dark). Every color in the
// app comes from here, like the desktop's --glo-* tokens.

const light = {
  bg: '#FFFFFF',
  surface: '#F7F0E9',
  surface2: '#EFE5DB',
  line: '#EADDD1',
  field: '#FFFFFF',
  fieldLine: '#DCC8B8',
  ink: '#24170F',
  ink2: '#4A372B',
  muted: '#6B5547',
  faint: '#76604F',
  accent: '#F47A1F',
  accentInk: '#2A1406',
  accentText: '#B8430A',
  accentSoft: '#FCE2CC',
  focus: 'rgba(244,122,31,0.18)',
  glow: 'rgba(244,122,31,0.35)',
  online: '#2E9E5B',
  onlineText: '#1F7A45',
  onlineSoft: '#EAF5EE',
  away: '#E2A00F',
  dnd: '#D33A2C',
  danger: '#B42318',
  dangerSoft: '#FDECEA',
  dangerLine: '#F1C9C3',
  them: '#F7F0E9',
  me: '#F47A1F',
  meInk: '#2A1406',
  quoteBg: 'rgba(255,255,255,0.32)',
  chip: '#FFFFFF',
  chipMine: '#FDE6D3',
  barBg: '#FBF7F3',
  navBg: '#F7F0E9',
  sheet: '#FFFFFF',
  backdrop: 'rgba(36,23,15,0.45)',
  shadow: 'rgba(36,23,15,0.22)',
  mentionWash: 'rgba(244,122,31,0.10)',
  mutedBadge: '#B4A296',
  info: '#1E4E8C',
  infoSoft: '#E5EEF8',
}

export type Colors = typeof light

// 0.7.5 "dark mode with depth" (DarkMode.dc.html): three layers instead of one flat brown. The
// bars sit deepest, the screen above them, cards a step up and sheets/menus on top. Every grey
// text color passes 4.5:1 on what it sits on.
const dark: Colors = {
  bg: '#1D1715',
  surface: '#28201C',
  surface2: '#2F2621',
  line: 'rgba(255,255,255,0.08)',
  field: '#241D1A',
  fieldLine: '#4A3E36',
  ink: '#F5EDE6',
  ink2: '#D9C8BC',
  muted: '#C9B8AB',
  faint: '#AD9B8E',
  accent: '#F7893A',
  accentInk: '#2A1406',
  accentText: '#FFA96A',
  accentSoft: '#4D2F1B',
  focus: 'rgba(247,137,58,0.22)',
  glow: 'rgba(247,137,58,0.35)',
  online: '#3DBA6E',
  onlineText: '#6FD69A',
  onlineSoft: '#1E3326',
  away: '#F0B429',
  dnd: '#F0544A',
  danger: '#FF8A80',
  dangerSoft: '#3A1F1C',
  dangerLine: '#5A2A26',
  them: '#2A221E',
  me: '#F7893A',
  meInk: '#2A1406',
  quoteBg: 'rgba(42,20,6,0.16)',
  chip: '#1D1715',
  chipMine: '#4D2F1B',
  barBg: '#161110',
  navBg: '#161110',
  sheet: '#2F2621',
  backdrop: 'rgba(0,0,0,0.6)',
  shadow: 'rgba(0,0,0,0.5)',
  mentionWash: 'rgba(247,137,58,0.14)',
  mutedBadge: '#6E5F55',
  info: '#9CC2F0',
  infoSoft: '#1C2A3A',
}

/** Calls look the same in every theme (dark, with firefly glows), like the desktop's --glo-call-*. */
export const call = {
  bg: '#120D0B',
  panel: '#1C1411',
  tile: '#2A1F1A',
  ink: '#FFFFFF',
  muted: 'rgba(255,255,255,0.72)',
  faint: 'rgba(255,255,255,0.5)',
  button: 'rgba(255,255,255,0.14)',
  buttonOn: '#FFFFFF',
  buttonOnInk: '#1C1411',
  hangup: '#E5372A',
  answer: '#2E9E5B',
  glow: '#FFB347',
  talking: '#FFC15E',
}

export type ThemeChoice = 'system' | 'light' | 'dark'

/** Accent colors, the same as the desktop app (Settings → Appearance → Accent color). */
export type AccentChoice = 'orange' | 'red' | 'lagoon' | 'violet' | 'blossom' | 'graphite'

export const ACCENTS: { key: AccentChoice; label: string; swatch: string }[] = [
  { key: 'orange', label: 'Glow Orange', swatch: '#F47A1F' },
  { key: 'red', label: 'Glofly Red', swatch: '#E0193A' },
  { key: 'lagoon', label: 'Glofly Lagoon', swatch: '#1789AD' },
  { key: 'violet', label: 'Glofly Violet', swatch: '#8B3FD9' },
  { key: 'blossom', label: 'Glofly Blossom', swatch: '#D63384' },
  { key: 'graphite', label: 'Glofly Graphite', swatch: '#3D3530' },
]

/** The accent parts of a theme (values from the desktop's main.css data-accent blocks). */
type AccentParts = Pick<Colors, 'accent' | 'accentInk' | 'accentText' | 'accentSoft' | 'focus' | 'glow' | 'me' | 'meInk' | 'chipMine' | 'mentionWash'>
function accentParts(accent: string, onAccent: string, link: string, soft: string, chipMine: string, rgb: string, isDark: boolean): AccentParts {
  return {
    accent,
    accentInk: onAccent,
    accentText: link,
    accentSoft: soft,
    focus: `rgba(${rgb},${isDark ? 0.22 : 0.18})`,
    glow: `rgba(${rgb},0.35)`,
    me: accent,
    meInk: onAccent,
    chipMine,
    mentionWash: `rgba(${rgb},${isDark ? 0.14 : 0.1})`,
  }
}
const accentColors: Record<Exclude<AccentChoice, 'orange'>, { light: AccentParts; dark: AccentParts }> = {
  red: {
    light: accentParts('#E0193A', '#FFFFFF', '#C0122F', '#FAD3DA', '#FCE8EB', '224,25,58', false),
    dark: accentParts('#F0485F', '#2A0A10', '#FF8A9B', '#4A1C24', '#4A1C24', '240,72,95', true),
  },
  lagoon: {
    light: accentParts('#1789AD', '#FFFFFF', '#0F6F8F', '#CFE8F1', '#E8F4F9', '23,137,173', false),
    dark: accentParts('#4CC3E6', '#062029', '#8AD8EF', '#173944', '#173944', '76,195,230', true),
  },
  violet: {
    light: accentParts('#8B3FD9', '#FFFFFF', '#7230B8', '#EBDCFA', '#F5EEFD', '139,63,217', false),
    dark: accentParts('#B57CFF', '#1D0A33', '#CFA8FF', '#3A2552', '#3A2552', '181,124,255', true),
  },
  blossom: {
    light: accentParts('#D63384', '#FFFFFF', '#B0266A', '#F8D3E5', '#FCEBF3', '214,51,132', false),
    dark: accentParts('#FF74B0', '#33081B', '#FF9FC8', '#4A1F33', '#4A1F33', '255,116,176', true),
  },
  graphite: {
    light: accentParts('#3D3530', '#FFFFFF', '#3D3530', '#E3DBD4', '#F3EEE9', '61,53,48', false),
    dark: accentParts('#E8DDD3', '#1E1916', '#F2E9E1', '#3D342E', '#3D342E', '232,221,211', true),
  },
}
const themed: Record<string, Colors> = {}
function colorsFor(isDark: boolean, accent: AccentChoice): Colors {
  if (accent === 'orange') return isDark ? dark : light
  const key = `${accent}-${isDark ? 'd' : 'l'}`
  return (themed[key] ??= { ...(isDark ? dark : light), ...accentColors[accent][isDark ? 'dark' : 'light'] })
}

export const useThemeChoice = create<{ choice: ThemeChoice; accent: AccentChoice; set: (c: ThemeChoice) => void; setAccent: (a: AccentChoice) => void }>((set) => ({
  choice: 'system',
  accent: 'orange',
  set: (choice) => set({ choice }),
  setAccent: (accent) => set({ accent: ACCENTS.some((a) => a.key === accent) ? accent : 'orange' }),
}))

/**
 * Glofly 2.0 on phones: the night side (Constellations) is dark in every theme, from the "Glofly
 * 2.0 Mobile" canvas. Everything drawn inside it (the composer, sheets, polls, dialogs) uses these
 * colors through ThemeOverride, so the existing pieces look right there without changes.
 */
export const night: Colors = {
  bg: '#120c0a',
  surface: '#1c1210',
  surface2: '#241712',
  line: '#2a1c17',
  field: '#1c1210',
  fieldLine: '#3a2a22',
  ink: '#f5ede6',
  ink2: '#d9c2b1',
  muted: '#b8a699',
  faint: '#9c8a7d',
  accent: '#ffb347',
  accentInk: '#1c1210',
  accentText: '#ffb347',
  accentSoft: '#2a1c17',
  focus: 'rgba(255,179,71,0.22)',
  glow: 'rgba(255,165,74,0.35)',
  online: '#3dba6e',
  onlineText: '#6fd39a',
  onlineSoft: '#163024',
  away: '#f0b429',
  dnd: '#d33a2c',
  danger: '#ff8a7a',
  dangerSoft: 'rgba(211,58,44,0.18)',
  dangerLine: '#5a2a26',
  them: '#1c1210',
  me: '#ffb347',
  meInk: '#1c1210',
  quoteBg: 'rgba(18,12,10,0.25)',
  chip: '#1c1210',
  chipMine: '#2a1c17',
  barBg: '#120c0a',
  navBg: 'rgba(18,12,10,0.95)',
  sheet: '#1c1210',
  backdrop: 'rgba(5,3,2,0.6)',
  shadow: 'rgba(0,0,0,0.5)',
  mentionWash: 'rgba(255,179,71,0.10)',
  mutedBadge: '#574a41',
  info: '#8ad8ef',
  infoSoft: '#173944',
}

/** 'night' = the Constellations palette; 'dark' = Glofly's own dark theme (the DM Dock, in every theme). */
export type ThemeMode = 'night' | 'dark'
const ThemeModeContext = createContext<ThemeMode | null>(null)

/** Everything inside draws with the night (or dark) palette, whatever the app's theme is. */
export function ThemeOverride({ mode, children }: { mode: ThemeMode | null; children: ReactNode }) {
  return createElement(ThemeModeContext.Provider, { value: mode }, children)
}

/** The override in force here (null = the app's own theme). */
export const useThemeMode = (): ThemeMode | null => useContext(ThemeModeContext)

export function useTheme(): { c: Colors; dark: boolean } {
  const mode = useContext(ThemeModeContext)
  const system = useColorScheme()
  const choice = useThemeChoice((s) => s.choice)
  const accent = useThemeChoice((s) => s.accent)
  if (mode === 'night') return { c: night, dark: true }
  if (mode === 'dark') return { c: colorsFor(true, accent), dark: true }
  const isDark = choice === 'system' ? system === 'dark' : choice === 'dark'
  return { c: colorsFor(isDark, accent), dark: isDark }
}

export const themes = { light, dark }

/** Font families (bundled Google fonts: Outfit for titles, DM Sans for everything else). */
export const font = {
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodyBold: 'DMSans_700Bold',
  display: 'Outfit_600SemiBold',
  displayMedium: 'Outfit_500Medium',
  displayBold: 'Outfit_700Bold',
}

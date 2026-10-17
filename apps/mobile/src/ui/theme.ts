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
  faint: '#8F7868',
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

const dark: Colors = {
  bg: '#1E1916',
  surface: '#2A231F',
  surface2: '#342B26',
  line: '#3A302A',
  field: '#2A231F',
  fieldLine: '#3A302A',
  ink: '#F5EDE6',
  ink2: '#D9C8BC',
  muted: '#B8A699',
  faint: '#8E7D71',
  accent: '#F7893A',
  accentInk: '#2A1406',
  accentText: '#FFA96A',
  accentSoft: '#4A2E1C',
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
  them: '#2A231F',
  me: '#F7893A',
  meInk: '#2A1406',
  quoteBg: 'rgba(42,20,6,0.16)',
  chip: '#1E1916',
  chipMine: '#4A2E1C',
  barBg: '#171310',
  navBg: '#171310',
  sheet: '#231D1A',
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

export function useTheme(): { c: Colors; dark: boolean } {
  const system = useColorScheme()
  const choice = useThemeChoice((s) => s.choice)
  const accent = useThemeChoice((s) => s.accent)
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

// Control's "Twilight" look (the approved "Glofly Control Mobile" canvas). Light only.

export const c = {
  // violet (headers, sign-in, tab bar)
  violetTop: '#2a1a55',
  violet: '#24174a',
  violetDeep: '#150d2e',
  tabBar: '#1b1238',
  tabBorder: '#3a2b6b',
  onViolet: '#e9e3f7',
  onVioletMuted: '#b9aedb',
  onVioletSoft: '#cfc6ea',
  fieldOnViolet: '#1d1340',
  fieldBorderOnViolet: '#4d3b85',
  gold: '#ffc24a',
  goldInk: '#24174a',
  // page
  page: '#f6f2ec',
  card: '#ffffff',
  ink: '#24170f',
  muted: '#6b5547',
  faint: '#8a7364',
  border: '#ece3d8',
  fieldBorder: '#e2d6c8',
  divider: '#f1eae1',
  primary: '#4b2f8f',
  primaryPressed: '#2f1c63',
  primarySoft: '#efe8fb',
  danger: '#d9362b',
  dangerText: '#a3241b',
  dangerSoft: '#fde8e6',
  dangerBorder: '#f3b8b2',
  warnSoft: '#fdf0d5',
  warnText: '#7a4f00',
  warnBorder: '#f2d48f',
  warnDot: '#e0a100',
  goodSoft: '#e3f3ea',
  goodText: '#1d6b3f',
  online: '#2f9e5c',
  onlineBright: '#4ade80',
  frozenSoft: '#e6eef9',
  frozenText: '#1e4f8a',
  offSoft: '#f1eae1',
  offText: '#5c4a3d',
  scrim: 'rgba(21,13,46,0.45)',
  white: '#ffffff',
}

export const font = {
  display: 'Outfit_600SemiBold',
  displayMedium: 'Outfit_500Medium',
  displayBold: 'Outfit_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bodySemi: 'DMSans_600SemiBold',
}

export type ChipTone = 'off' | 'danger' | 'good' | 'warn' | 'hot' | 'frozen' | 'primary'

export const chipColors: Record<ChipTone, [bg: string, fg: string]> = {
  off: [c.offSoft, c.offText],
  danger: [c.dangerSoft, c.dangerText],
  good: [c.goodSoft, c.goodText],
  warn: [c.warnSoft, c.warnText],
  hot: [c.primarySoft, c.primary],
  frozen: [c.frozenSoft, c.frozenText],
  primary: [c.primary, c.white],
}

/** Constellation tiles (Constellations.dc.html). */
export const tileColors = ['#4b2f8f', '#b45309', '#0f766e', '#1d4ed8', '#7c3aed', '#be185d']

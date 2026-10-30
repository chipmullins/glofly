import type {
  AccentChoice,
  AlertSound,
  AppSettings,
  AppSettingsChanges,
  NotificationSettings,
  SoundSettings,
  TextSize,
  ThemeChoice
} from '../../../desktop/src/preload/api-types'
import { VERSION } from './config'
import { emit } from './events'

// Settings → General (theme, accent, text size, sounds, notifications), kept in this browser
// (the desktop app keeps them in a file on the computer). Starting with the computer and the
// system tray don't exist here, so the window hides them.

type Saved = {
  theme: ThemeChoice
  accent: AccentChoice
  textSize: TextSize
  sounds: SoundSettings
  notifications: NotificationSettings
}

const KEY = 'glofly:app-settings'

const saved: Saved = {
  // 0.7.4: a first visit follows the device's light / dark setting; browsers that used Glofly
  // before keep light unless they picked something (load).
  theme: 'system',
  accent: 'orange',
  textSize: 'default',
  sounds: {
    enabled: true,
    dndSilence: true,
    volume: 100,
    callVolume: 100,
    message: 'mmHm',
    messageSent: 'none',
    constellationMessage: 'skyLantern',
    friendRequest: 'nightBreeze',
    friendOnline: 'hollowWood',
    login: 'gloflyHum',
    logout: 'goodbyeSoft',
    callConnected: 'whistleUp',
    callEnded: 'whistleDown',
    memberJoined: 'bubbleIn',
    memberLeft: 'bubbleOut',
    ringtone: 'doowop',
    outgoing: 'humHum'
  },
  notifications: { enabled: true, preview: true }
}

const ALERT_SOUNDS: AlertSound[] = [
  'chime',
  'hello',
  'glowOn',
  'glowOff',
  'blinkIn',
  'blinkOut',
  'goodnight',
  'sparkTrail',
  'dewdrop',
  'starfall',
  'pebble',
  'pluck',
  'fade',
  'comet',
  'lowComet',
  'twinStars',
  'constellation',
  'nebula',
  'starlightPing',
  'moonrise',
  'hollowWood',
  'nightBreeze',
  'ember',
  'orbit',
  'stardust',
  'aurora',
  'skyLantern',
  'deepSpace',
  'none'
]
/**
 * Oct 29–30, 2026: the call, message, message sent, login and log out rows offer only Chip's picks (and None); a saved older sound falls
 * back to the new default. Keep in step with ROW_CHOICES (renderer/src/lib/sounds.ts) and the
 * desktop's app-settings.ts.
 */
const ROW_SOUNDS: Record<string, readonly string[]> = {
  callConnected: ['whistleUp', 'none'],
  callEnded: ['whistleDown', 'none'],
  memberJoined: ['bubbleIn', 'none'],
  memberLeft: ['bubbleOut', 'none'],
  ringtone: ['doowop', 'none'],
  outgoing: ['humHum', 'none'],
  message: [
    'mmHm',
    'hollowWood',
    'nightBreeze',
    'nudge',
    'tapShoulder',
    'heyHum',
    'brightGlow',
    'doubleNudge',
    'callOut',
    'lanternUp',
    'mmHmQ',
    'starNudge',
    'ripple',
    'none'
  ],
  login: ['gloflyHum', 'gloflyChord', 'dawnHum', 'none'],
  logout: ['goodbyeSoft', 'hushHum', 'none'],
  messageSent: [
    'softWhoosh',
    'flick',
    'lift',
    'puff',
    'sendOff',
    'float',
    'paperPlane',
    'skip',
    'breeze',
    'hop',
    'none'
  ]
}
const THEMES: ThemeChoice[] = ['light', 'dark', 'system']
const ACCENTS: AccentChoice[] = ['orange', 'red', 'lagoon', 'violet', 'blossom', 'graphite']
const TEXT_SIZES: Record<TextSize, number> = { small: 0.9, default: 1, large: 1.1, larger: 1.25 }

function soundSettingOk(key: string, value: unknown): boolean {
  switch (key) {
    case 'enabled':
    case 'dndSilence':
      return typeof value === 'boolean'
    case 'volume':
    case 'callVolume':
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
    case 'constellationMessage':
    case 'friendRequest':
    case 'friendOnline':
      return ALERT_SOUNDS.includes(value as AlertSound)
    case 'message':
    case 'messageSent':
    case 'login':
    case 'logout':
    case 'callConnected':
    case 'callEnded':
    case 'memberJoined':
    case 'memberLeft':
    case 'ringtone':
    case 'outgoing':
      return typeof value === 'string' && ROW_SOUNDS[key].includes(value)
    default:
      return false
  }
}

/** This browser has used Glofly before (it keeps a few small notes in localStorage). */
function usedBefore(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (/^glofly[.:]/.test(localStorage.key(i) ?? '')) return true
    }
  } catch {
    // storage off: treat as new
  }
  return false
}

function load(): void {
  if (usedBefore()) saved.theme = 'light'
  let value: Partial<Saved> | null = null
  try {
    value = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
  } catch {
    value = null // private window, blocked storage, or nothing saved: defaults
  }
  if (!value || typeof value !== 'object') return
  if (THEMES.includes(value.theme as ThemeChoice)) saved.theme = value.theme as ThemeChoice
  if (ACCENTS.includes(value.accent as AccentChoice)) saved.accent = value.accent as AccentChoice
  if ((value.textSize as string) in TEXT_SIZES) saved.textSize = value.textSize as TextSize
  if (typeof value.sounds === 'object' && value.sounds !== null) {
    for (const [k, v] of Object.entries(value.sounds)) {
      if (soundSettingOk(k, v)) (saved.sounds as Record<string, unknown>)[k] = v
    }
    const v = (value as { soundDefaults?: number }).soundDefaults ?? 1
    // Then Hollow wood for friend online (Dewdrop before) and Night breeze for friend requests (Firefly chime).
    if (v < 4 && saved.sounds.friendOnline === 'dewdrop') saved.sounds.friendOnline = 'hollowWood'
    if (v < 4 && saved.sounds.friendRequest === 'chime') saved.sounds.friendRequest = 'nightBreeze'
    // 7 (0.8.8): Glo-fly hummed became the login default (Glo-fly Robot in 0.8.7).
    if (v < 7 && saved.sounds.login === 'gloflyChord') saved.sounds.login = 'gloflyHum'
  }
  const n = value.notifications as Partial<NotificationSettings> | undefined
  if (n && typeof n === 'object') {
    if (typeof n.enabled === 'boolean') saved.notifications.enabled = n.enabled
    if (typeof n.preview === 'boolean') saved.notifications.preview = n.preview
  }
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...saved, soundDefaults: 7 }))
  } catch {
    // Storage blocked: the change lasts until the page is closed.
  }
}

// ---- Light / dark and the accent ------------------------------------------------------

const darkQuery =
  typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

export const isDark = (): boolean =>
  saved.theme === 'dark' || (saved.theme === 'system' && !!darkQuery?.matches)

function sendAppearance(): void {
  emit({ type: 'appearance', accent: saved.accent, dark: isDark() })
  // The browser's own bars (address bar on iPad, scrollbars) follow the theme too.
  document.documentElement.style.colorScheme = isDark() ? 'dark' : 'light'
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = isDark() ? '#1E1916' : '#FFFBF7'
    meta.removeAttribute('media')
  }
}

/** Text size (Settings → Appearance): the desktop app zooms the window; here the page zooms. */
function applyTextSize(): void {
  const zoom = TEXT_SIZES[saved.textSize]
  document.documentElement.style.setProperty('zoom', zoom === 1 ? '' : String(zoom))
}

// ---- Notification settings follow-ups (permission, web push) ---------------------------

type NotificationsChanged = (next: NotificationSettings, prev: NotificationSettings) => void
let notificationsChanged: NotificationsChanged | null = null
export function onNotificationSettings(listener: NotificationsChanged): void {
  notificationsChanged = listener
}

export const notificationSettings = (): NotificationSettings => ({ ...saved.notifications })

// ---- The bridge's app.* ---------------------------------------------------------------

export function startSettings(): void {
  load()
  applyTextSize()
  darkQuery?.addEventListener('change', () => {
    if (saved.theme === 'system') sendAppearance()
  })
  // After the window has subscribed (main.tsx), so the first frame and later ones match.
  queueMicrotask(sendAppearance)
}

export const initialAppearance = (): { accent: AccentChoice; dark: boolean } => {
  load()
  return { accent: saved.accent, dark: isDark() }
}

export function getAppSettings(): AppSettings {
  return {
    version: VERSION,
    theme: saved.theme,
    accent: saved.accent,
    textSize: saved.textSize,
    sounds: { ...saved.sounds },
    notifications: { ...saved.notifications },
    closeToTray: false,
    openAtLogin: false,
    startupAvailable: false
  }
}

export function setAppSettings(changes: AppSettingsChanges): AppSettings {
  if (changes.theme && THEMES.includes(changes.theme)) saved.theme = changes.theme
  if (changes.accent && ACCENTS.includes(changes.accent)) saved.accent = changes.accent
  if (changes.theme || changes.accent) sendAppearance()
  if (changes.textSize && changes.textSize in TEXT_SIZES) {
    saved.textSize = changes.textSize
    applyTextSize()
  }
  if (changes.sounds) {
    for (const [k, v] of Object.entries(changes.sounds)) {
      if (soundSettingOk(k, v)) (saved.sounds as Record<string, unknown>)[k] = v
    }
  }
  if (changes.notifications) {
    const prev = { ...saved.notifications }
    const n = changes.notifications
    if (typeof n.enabled === 'boolean') saved.notifications.enabled = n.enabled
    if (typeof n.preview === 'boolean') saved.notifications.preview = n.preview
    notificationsChanged?.({ ...saved.notifications }, prev)
  }
  save()
  return getAppSettings()
}

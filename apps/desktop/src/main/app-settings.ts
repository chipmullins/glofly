import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  AccentChoice,
  AlertSound,
  AppSettings,
  AppSettingsChanges,
  CallSound,
  NotificationSettings,
  SoundSettings,
  TextSize,
  ThemeChoice
} from '../preload/api-types'

// Settings → General → Appearance and App: theme, accent, text size, starting with the
// computer, and the system tray. These belong to this computer, so they're saved here
// (not on the server).

type Saved = {
  closeToTray: boolean
  theme: ThemeChoice
  accent: AccentChoice
  textSize: TextSize
  sounds: SoundSettings
  notifications: NotificationSettings
}
const saved: Saved = {
  closeToTray: true, // the design has it on by default
  theme: 'light',
  accent: 'orange',
  textSize: 'default',
  sounds: {
    enabled: true,
    dndSilence: true,
    message: 'chime',
    friendRequest: 'chime',
    login: 'hello',
    logout: 'goodnight',
    callConnected: 'glowOn',
    callEnded: 'glowOff',
    memberJoined: 'blinkIn',
    memberLeft: 'blinkOut',
    ringtone: 'ring',
    outgoing: 'jingle'
  },
  notifications: { enabled: true, preview: true }
}

const isNotificationChanges = (value: unknown): value is Partial<NotificationSettings> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(
    ([k, v]) => (k === 'enabled' || k === 'preview') && typeof v === 'boolean'
  )

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
  'none'
]
const CALL_SOUNDS: CallSound[] = ['ring', 'jingle', 'none']

/** Checks a sound setting (from the window or the saved file) before using it. */
function soundSettingOk(key: string, value: unknown): boolean {
  switch (key) {
    case 'enabled':
    case 'dndSilence':
      return typeof value === 'boolean'
    case 'message':
    case 'friendRequest':
    case 'login':
    case 'logout':
    case 'callConnected':
    case 'callEnded':
    case 'memberJoined':
    case 'memberLeft':
      return ALERT_SOUNDS.includes(value as AlertSound)
    case 'ringtone':
    case 'outgoing':
      return CALL_SOUNDS.includes(value as CallSound)
    default:
      return false
  }
}

const isSoundChanges = (value: unknown): value is Partial<SoundSettings> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(([k, v]) => soundSettingOk(k, v))

const THEMES: ThemeChoice[] = ['light', 'dark', 'system']
const ACCENTS: AccentChoice[] = ['orange', 'red', 'lagoon', 'violet']
export const TEXT_SIZES: Record<TextSize, number> = {
  small: 0.9,
  default: 1,
  large: 1.1,
  larger: 1.25
}

const file = (): string => join(app.getPath('userData'), 'app-settings.json')

/** Launched by "Open Glofly when my computer starts": start quietly in the tray. */
const STARTUP_ARG = '--hidden'

export function loadAppSettings(): void {
  try {
    const value = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Saved>
    if (typeof value.closeToTray === 'boolean') saved.closeToTray = value.closeToTray
    if (THEMES.includes(value.theme as ThemeChoice)) saved.theme = value.theme as ThemeChoice
    if (ACCENTS.includes(value.accent as AccentChoice)) saved.accent = value.accent as AccentChoice
    if ((value.textSize as string) in TEXT_SIZES) saved.textSize = value.textSize as TextSize
    if (typeof value.sounds === 'object' && value.sounds !== null) {
      for (const [k, v] of Object.entries(value.sounds)) {
        if (soundSettingOk(k, v)) (saved.sounds as Record<string, unknown>)[k] = v
      }
    }
    if (isNotificationChanges(value.notifications)) {
      saved.notifications = { ...saved.notifications, ...value.notifications }
    }
  } catch {
    // First run (or an unreadable file): keep the defaults.
  }
  // Light, dark, or follow Windows. The window's colors follow this (prefers-color-scheme).
  nativeTheme.themeSource = saved.theme
}

/** True when Glofly is showing its dark theme right now. */
export const isDark = (): boolean => nativeTheme.shouldUseDarkColors

export const currentAccent = (): AccentChoice => saved.accent

/** Tells the window(s) which theme and accent to show. */
export function sendAppearance(windows = BrowserWindow.getAllWindows()): void {
  for (const window of windows) {
    window.webContents.send('glofly:event', {
      type: 'appearance',
      accent: saved.accent,
      dark: isDark()
    })
  }
}

/** Startup flags for a new window, so its first frame already has the right colors. */
export const appearanceArgs = (): string[] => [
  `--glofly-accent=${saved.accent}`,
  ...(isDark() ? ['--glofly-dark'] : [])
]
export const zoomFactor = (): number => TEXT_SIZES[saved.textSize]

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify(saved))
  } catch (err) {
    console.error("Couldn't save app settings", err)
  }
}

/**
 * Only the installed app can start with Windows. While developing, this would register the
 * bare Electron program instead of Glofly.
 */
const startupAvailable = (): boolean =>
  app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin')

export function getAppSettings(): AppSettings {
  return {
    version: app.getVersion(),
    theme: saved.theme,
    accent: saved.accent,
    textSize: saved.textSize,
    sounds: { ...saved.sounds },
    notifications: { ...saved.notifications },
    closeToTray: saved.closeToTray,
    openAtLogin: startupAvailable()
      ? app.getLoginItemSettings({ args: [STARTUP_ARG] }).openAtLogin
      : false,
    startupAvailable: startupAvailable()
  }
}

/** Checks settings sent from the window before using them. */
export function isAppSettingsChanges(value: unknown): value is AppSettingsChanges {
  const c = value as Record<string, unknown> | null
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return false
  return Object.entries(c).every(([k, v]) => {
    if (k === 'closeToTray' || k === 'openAtLogin') return typeof v === 'boolean'
    if (k === 'theme') return THEMES.includes(v as ThemeChoice)
    if (k === 'accent') return ACCENTS.includes(v as AccentChoice)
    if (k === 'textSize') return typeof v === 'string' && v in TEXT_SIZES
    if (k === 'sounds') return isSoundChanges(v)
    if (k === 'notifications') return isNotificationChanges(v)
    return false
  })
}

export function setAppSettings(changes: AppSettingsChanges): AppSettings {
  if (changes.closeToTray !== undefined) {
    saved.closeToTray = changes.closeToTray
    updateTray()
  }
  if (changes.theme) {
    saved.theme = changes.theme
    nativeTheme.themeSource = changes.theme
  }
  if (changes.accent) saved.accent = changes.accent
  if (changes.theme || changes.accent) sendAppearance()
  if (changes.textSize) {
    saved.textSize = changes.textSize
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.setZoomFactor(zoomFactor())
    }
  }
  if (changes.sounds) saved.sounds = { ...saved.sounds, ...changes.sounds }
  if (changes.notifications) {
    saved.notifications = { ...saved.notifications, ...changes.notifications }
  }
  if (
    changes.notifications ||
    changes.closeToTray !== undefined ||
    changes.theme ||
    changes.accent ||
    changes.textSize ||
    changes.sounds
  ) {
    save()
  }
  if (changes.openAtLogin !== undefined && startupAvailable()) {
    app.setLoginItemSettings({ openAtLogin: changes.openAtLogin, args: [STARTUP_ARG] })
  }
  return getAppSettings()
}

/** Started with the computer and allowed to sit in the tray: don't pop the window up. */
export const startHidden = (): boolean => process.argv.includes(STARTUP_ARG) && saved.closeToTray

// ---------------------------------------------------------------------------------------
// The system tray icon, and closing the window to it.

let tray: Tray | null = null
let quitting = false
let getWindow: () => BrowserWindow | null = () => null
let trayIcon = ''

function showWindow(): void {
  const window = getWindow()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function updateTray(): void {
  // The tray icon is there while Glofly keeps running in the background (not on Mac,
  // which has the dock for that).
  const wanted = saved.closeToTray && process.platform !== 'darwin'
  if (!wanted) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  try {
    const image = nativeImage.createFromPath(trayIcon).resize({ width: 16, height: 16 })
    tray = new Tray(image)
    tray.setToolTip('Glofly')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Glofly', click: showWindow },
        { type: 'separator' },
        { label: 'Quit Glofly', click: () => app.quit() }
      ])
    )
    tray.on('click', showWindow)
  } catch (err) {
    // No tray on this system: closing the window just quits, as usual.
    console.error("Couldn't add the tray icon", err)
    tray = null
  }
}

/**
 * Sets up the tray and makes closing the window hide it to the tray instead of quitting
 * (when that setting is on). "Quit Glofly" in the tray menu really quits.
 */
export function setUpTray(window: () => BrowserWindow | null, icon: string): void {
  getWindow = window
  trayIcon = icon
  app.on('before-quit', () => {
    quitting = true
  })
  updateTray()
}

/** Called from the window's close event. True means "hide it to the tray instead". */
export function shouldHideOnClose(): boolean {
  return !quitting && saved.closeToTray && tray !== null && process.platform !== 'darwin'
}

/** Brings the window back (opening Glofly again while it's in the tray). */
export { showWindow }

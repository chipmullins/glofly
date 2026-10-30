import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { goodbyeFirst, skipGoodbye } from './goodbye'
import type {
  AccentChoice,
  AlertSound,
  AppSettings,
  AppSettingsChanges,
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
  /** Which set of default sounds the saved choices were made under (see SOUND_DEFAULTS_VERSION) */
  soundDefaultsVersion?: number
}
const saved: Saved = {
  closeToTray: true, // the design has it on by default
  // 0.7.4: a fresh install follows the computer's light / dark setting. Installs from before
  // keep light unless they picked something (loadAppSettings).
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
    login: 'gloflyChord',
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
 * Oct 29–30, 2026: the call, message, message sent, login and log out rows offer only Chip's picks (and None). A saved older call sound isn't
 * accepted any more, so it falls back to the new default. Keep in step with ROW_CHOICES in
 * the window (renderer/src/lib/sounds.ts) and apps/web/src/bridge/settings.ts.
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
  login: ['gloflyChord', 'dawnHum', 'none'],
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

/**
 * 0.2.2 changed the default ringing sounds (Glow ring → Firefly dance, Glofly jingle → Synth
 * arp). Settings saved before that still hold the old defaults, so they move over once; anyone
 * who had picked something else keeps it. Bumped only when defaults change.
 * 3 (0.7.0): the message sound's default became Low comet (Firefly chime before).
 * 4 (0.7.0): friend online became Hollow wood (Dewdrop before), friend request Night breeze (Firefly chime).
 * 5 (Oct 29, 2026): new call sounds; older ones aren't accepted for the call rows (ROW_SOUNDS).
 * 6 (Oct 30, 2026): new message, login and log out sounds and the message sent row (ROW_SOUNDS).
 */
const SOUND_DEFAULTS_VERSION = 6

/** Checks a sound setting (from the window or the saved file) before using it. */
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

const isSoundChanges = (value: unknown): value is Partial<SoundSettings> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.entries(value).every(([k, v]) => soundSettingOk(k, v))

const THEMES: ThemeChoice[] = ['light', 'dark', 'system']
const ACCENTS: AccentChoice[] = ['orange', 'red', 'lagoon', 'violet', 'blossom', 'graphite']
export const TEXT_SIZES: Record<TextSize, number> = {
  small: 0.9,
  default: 1,
  large: 1.1,
  larger: 1.25
}

const file = (): string => join(app.getPath('userData'), 'app-settings.json')

/** Launched by "Open Glofly when my computer starts": start quietly in the tray. */
const STARTUP_ARG = '--hidden'

/** Glofly has run on this computer before (anything it keeps in its folder is already there). */
function usedBefore(): boolean {
  const dir = app.getPath('userData')
  return ['app-settings.json', 'session.dat', 'games.json', 'Local Storage'].some((name) =>
    existsSync(join(dir, name))
  )
}

export function loadAppSettings(): void {
  // 0.7.4: everyone who used Glofly before "Match system" became the default keeps the light
  // look they've been seeing, until they pick something else.
  if (usedBefore()) saved.theme = 'light'
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
      if ((value.soundDefaultsVersion ?? 1) < 4) {
        if (saved.sounds.friendOnline === 'dewdrop') saved.sounds.friendOnline = 'hollowWood'
        if (saved.sounds.friendRequest === 'chime') saved.sounds.friendRequest = 'nightBreeze'
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
  ...(isDark() ? ['--glofly-dark'] : []),
  // Started with the computer, waiting in the tray: no login sound (Oct 30, 2026).
  ...(startHidden() ? ['--glofly-hidden'] : [])
]
export const zoomFactor = (): number => TEXT_SIZES[saved.textSize]

function save(): void {
  try {
    writeFileSync(
      file(),
      JSON.stringify({ ...saved, soundDefaultsVersion: SOUND_DEFAULTS_VERSION })
    )
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

/** Opened by "Open Glofly when my computer starts" (Windows sign-in or Mac login). */
export const startedAtLogin = (): boolean =>
  process.argv.includes(STARTUP_ARG) || openedAtMacLogin()

/** Started with the computer and allowed to sit in the tray: don't pop the window up. */
export const startHidden = (): boolean => startedAtLogin() && saved.closeToTray

/** Mac: opened by "Open Glofly at login" (macOS passes no startup flag, so ask it). */
function openedAtMacLogin(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch {
    return false
  }
}

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

const isMac = process.platform === 'darwin'

function updateTray(): void {
  // Windows: the tray icon is there while Glofly keeps running in the background.
  // Mac: the same setting shows Glofly's icon in the menu bar (top right of the screen).
  const wanted = saved.closeToTray
  if (!wanted) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  try {
    let image: Electron.NativeImage
    if (isMac) {
      // A black firefly silhouette that macOS recolors to match the menu bar.
      image = nativeImage.createFromPath(trayIcon)
      image.setTemplateImage(true)
    } else {
      image = nativeImage.createFromPath(trayIcon).resize({ width: 16, height: 16 })
    }
    tray = new Tray(image)
    tray.setToolTip('Glofly')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Glofly', click: showWindow },
        { type: 'separator' },
        { label: 'Quit Glofly', click: () => app.quit() }
      ])
    )
    // (On a Mac, clicking the menu-bar icon opens this menu instead.)
    if (!isMac) tray.on('click', showWindow)
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
  app.on('before-quit', (event) => {
    // Oct 30, 2026: the log-off sound first (the windows hide now; Glofly quits after it).
    if (goodbyeFirst(getWindow())) {
      event.preventDefault()
      return
    }
    quitting = true
  })
  updateTray()
}

/**
 * 0.7.2: Glofly is really quitting (an update is about to install). On a Mac, "Update to …" goes
 * through macOS's updater, which closes the windows without the usual before-quit, so the window
 * only hid itself (it looked closed), Glofly never quit, and the update never installed.
 */
export function markQuitting(): void {
  quitting = true
  skipGoodbye() // an update installing: no log-off sound
}

/** Called from the window's close event. True means "hide it to the tray instead". */
export function shouldHideOnClose(): boolean {
  // Mac: closing the window never quits, as with any Mac chat app. Glofly stays in the Dock
  // (messages, calls and notifications keep coming); ⌘Q or Quit Glofly really quits.
  if (isMac) return !quitting
  return !quitting && saved.closeToTray && tray !== null
}

/** Brings the window back (opening Glofly again while it's in the tray). */
export { showWindow }

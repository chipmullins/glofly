import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppSettings } from '../preload/api-types'

// Settings → General → App: start with the computer, and keep running in the system tray.
// These belong to this computer, so they're saved here (not on the server).

type Saved = { closeToTray: boolean }
const saved: Saved = { closeToTray: true } // the design has it on by default

const file = (): string => join(app.getPath('userData'), 'app-settings.json')

/** Launched by "Open Glofly when my computer starts": start quietly in the tray. */
const STARTUP_ARG = '--hidden'

export function loadAppSettings(): void {
  try {
    const value = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Saved>
    if (typeof value.closeToTray === 'boolean') saved.closeToTray = value.closeToTray
  } catch {
    // First run (or an unreadable file): keep the defaults.
  }
}

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
    closeToTray: saved.closeToTray,
    openAtLogin: startupAvailable()
      ? app.getLoginItemSettings({ args: [STARTUP_ARG] }).openAtLogin
      : false,
    startupAvailable: startupAvailable()
  }
}

export function setAppSettings(
  changes: Partial<Pick<AppSettings, 'closeToTray' | 'openAtLogin'>>
): AppSettings {
  if (changes.closeToTray !== undefined) {
    saved.closeToTray = changes.closeToTray
    save()
    updateTray()
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

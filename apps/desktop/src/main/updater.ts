import { app, autoUpdater as nativeUpdater, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { markQuitting } from './app-settings'

// Automatic updates for the installed app.
//
// Where updates come from is baked in at build time, next to the server address:
//   MAIN_VITE_UPDATES_URL=https://<updates address>   (apps/desktop/.env.production)
// A release uploads the new setup file + its .blockmap + latest.yml there. Without
// the setting (development, home-network test builds) nothing is checked.
//
// 0.8.6: every time Glofly opens, the small updater window (launchUpdate.ts) checks first and
// installs a new version before Glofly opens, like Discord. While Glofly stays open it still
// checks every 4 hours and downloads in the background (only the changed parts, thanks to the
// .blockmap). When a new version is ready, the window shows "Restart to update"; otherwise it
// installs quietly the next time Glofly quits.

const CHECK_EVERY = 4 * 60 * 60 * 1000

/** The version that's downloaded and waiting, or null. */
let readyVersion: string | null = null

function updatesUrl(): string | null {
  const setting = import.meta.env.MAIN_VITE_UPDATES_URL?.trim()
  if (!setting) return null
  try {
    const url = new URL(setting)
    // Updates are programs that will run on this PC: only ever over https.
    return url.protocol === 'https:' ? url.href.replace(/\/$/, '') : null
  } catch {
    return null
  }
}

function announce(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('updates:ready', readyVersion)
  }
}

export function updateReady(): string | null {
  return readyVersion
}

/** "Restart to update": closes Glofly, installs silently, and opens it again. */
export function restartToUpdate(): void {
  if (!readyVersion) return
  // 0.7.2: closing the window must really close it now (on a Mac it only hides otherwise).
  markQuitting()
  autoUpdater.quitAndInstall(true, true)
}

let configured: boolean | null = null

/**
 * Points electron-updater at Glofly's update feed, once. False when this copy can't update
 * itself (not installed, no feed set, or an unsigned Mac test build).
 */
export function setUpUpdates(): boolean {
  if (configured !== null) return configured
  const url = updatesUrl()
  // Mac: macOS only installs an update signed by the same developer as the running copy, so
  // only builds signed with Glofly's Developer ID check (the Mac build Action sets
  // MAIN_VITE_MAC_AUTO_UPDATE=true when it signs). Older ad-hoc test builds never check; their
  // testers download the first signed .dmg by hand once, and it updates itself from then on.
  // The Mac copy reads latest-mac.yml and downloads Glofly-<version>-mac.zip from the same place.
  const macSigned = import.meta.env.MAIN_VITE_MAC_AUTO_UPDATE === 'true'
  if (!app.isPackaged || !url || (process.platform === 'darwin' && !macSigned)) {
    configured = false
    return false
  }

  autoUpdater.setFeedURL({ provider: 'generic', url })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.error('Update check failed:', err?.message ?? err))
  // 0.7.2: macOS's updater (Electron's own, which electron-updater hands the install to) says
  // "before-quit-for-update" instead of before-quit: let the windows really close so it installs.
  nativeUpdater.on('before-quit-for-update', markQuitting)
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version
    announce()
  })
  configured = true
  return true
}

let checkForUpdates: (() => void) | null = null

/** "Check for updates" (the update screen): looks right away, if this copy can update itself. */
export function checkNow(): 'checking' | 'unavailable' {
  if (!checkForUpdates) return 'unavailable'
  checkForUpdates()
  return 'checking'
}

/** The background checks while Glofly is open (after the launch check, if there was one). */
export function startAutoUpdates(): void {
  if (!setUpUpdates()) return

  const check = (): void => {
    if (readyVersion) return // already waiting for a restart
    autoUpdater
      .checkForUpdates()
      .catch((err) => console.error('Update check failed:', err?.message ?? err))
  }
  checkForUpdates = check
  setTimeout(check, 30 * 1000) // let sign-in and the first screen settle first
  setInterval(check, CHECK_EVERY)
}

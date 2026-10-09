import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

// Automatic updates for the installed app.
//
// Where updates come from is baked in at build time, next to the server address:
//   MAIN_VITE_UPDATES_URL=https://<updates address>   (apps/desktop/.env.production)
// A release uploads the new setup file + its .blockmap + latest.yml there. Without
// the setting (development, home-network test builds) nothing is checked.
//
// Glofly checks shortly after starting and every 4 hours and downloads in the
// background (only the changed parts, thanks to the .blockmap). When a new version
// is ready, the window shows "Restart to update"; otherwise it installs quietly the
// next time Glofly quits.

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
  autoUpdater.quitAndInstall(true, true)
}

export function startAutoUpdates(): void {
  const url = updatesUrl()
  // Mac test builds aren't signed by Apple, and macOS only installs signed updates, so Mac
  // copies don't check for now (testers download the new .dmg instead).
  if (!app.isPackaged || !url || process.platform === 'darwin') return

  autoUpdater.setFeedURL({ provider: 'generic', url })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.error('Update check failed:', err?.message ?? err))
  autoUpdater.on('update-downloaded', (info) => {
    readyVersion = info.version
    announce()
  })

  const check = (): void => {
    if (readyVersion) return // already waiting for a restart
    autoUpdater
      .checkForUpdates()
      .catch((err) => console.error('Update check failed:', err?.message ?? err))
  }
  setTimeout(check, 30 * 1000) // let sign-in and the first screen settle first
  setInterval(check, CHECK_EVERY)
}

import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

// Automatic updates for the installed app.
//
// Where updates come from is baked in at build time, next to the server address:
//   MAIN_VITE_UPDATES_URL=https://<updates address>   (apps/desktop/.env.production)
// The release pipeline uploads the new setup file + latest.yml there. Without the
// setting (development, home-network test builds) nothing is checked.
//
// Glofly checks shortly after starting and every 4 hours, downloads in the
// background (small delta downloads), shows a Windows notification when it's
// ready, and installs the next time Glofly quits. (An in-app "Restart to update"
// button comes later.)

const CHECK_EVERY = 4 * 60 * 60 * 1000

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

export function startAutoUpdates(): void {
  const url = updatesUrl()
  if (!app.isPackaged || !url) return

  autoUpdater.setFeedURL({ provider: 'generic', url })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => console.error('Update check failed:', err?.message ?? err))

  const check = (): void => {
    autoUpdater
      .checkForUpdatesAndNotify()
      .catch((err) => console.error('Update check failed:', err?.message ?? err))
  }
  setTimeout(check, 30 * 1000) // let sign-in and the first screen settle first
  setInterval(check, CHECK_EVERY)
}

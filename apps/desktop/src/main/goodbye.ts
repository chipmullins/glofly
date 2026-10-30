import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'

// Oct 30, 2026: quitting Glofly (Quit Glofly in the tray, Cmd/Ctrl+Q, or closing the window when
// it doesn't stay in the tray) plays the log-off sound, like signing out does. The windows hide at
// once so quitting still feels instant; the app itself waits for the sound (at most MAX_MS), then
// quits for real. Never for an update install (markQuitting → skipGoodbye) or a computer shutdown.

const MAX_MS = 2500

let state: 'ready' | 'saying' | 'done' = 'ready'

/** Quit straight away from now on (updates installing, the computer shutting down). */
export function skipGoodbye(): void {
  state = 'done'
}

/** The computer is shutting down or signing out: never hold it up. */
export function watchShutdown(window: BrowserWindow): void {
  window.on('session-end', skipGoodbye) // Windows
  powerMonitor.on('shutdown', skipGoodbye) // Mac and Linux
}

/**
 * Asks the window to play the log-off sound, then quits. True means the quit was put off for it
 * (the caller cancels this quit/close; app.quit() comes again once the sound is done).
 */
export function goodbyeFirst(window: BrowserWindow | null): boolean {
  if (state !== 'ready' || !window || window.isDestroyed()) return false
  state = 'saying'
  const contents = window.webContents
  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    state = 'done'
    clearTimeout(timer)
    ipcMain.removeListener('app:goodbye-done', onDone)
    app.quit()
  }
  const onDone = (event: Electron.IpcMainEvent): void => {
    if (event.sender === contents) finish()
  }
  const timer = setTimeout(finish, MAX_MS)
  ipcMain.on('app:goodbye-done', onDone)
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.hide()
  contents.send('glofly:event', { type: 'app:goodbye' })
  return true
}

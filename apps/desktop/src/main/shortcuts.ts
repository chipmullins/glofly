import { app, BrowserWindow, Menu } from 'electron'
import { resolve } from 'path'
import { showWindow } from './app-settings'
import {
  SHORTCUT_ACTIONS,
  SHORTCUT_LABELS,
  TASK_SWITCH,
  taskFromArgv,
  type ShortcutAction
} from './taskbar-core'

// Right-click Glofly on the Windows taskbar (the Jump List) or its Mac Dock icon: New message,
// Set status, Quiet hours. On Windows each task starts Glofly again with "--glofly-task=…"; the
// one-Glofly-at-a-time lock hands that command line to the running copy (second-instance), which
// brings its window forward and passes the action to it. The window does the work (it owns your
// status and Settings): on a `shortcut` event, and once when it's ready, it calls take() and does
// what that returns, so an action is done exactly once even if both happen.

/** An action that came in before the window was listening (Glofly wasn't running yet). */
let pending: ShortcutAction | null = null

function deliver(action: ShortcutAction): void {
  showWindow()
  pending = action
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    if (!window.webContents.isLoading()) {
      window.webContents.send('glofly:event', { type: 'shortcut', action })
    }
  }
}

/** The action waiting from a cold start (once). */
export function takePendingShortcut(): ShortcutAction | null {
  const action = pending
  pending = null
  return action
}

/** A second launch: maybe a Jump List task. Either way the window comes forward. */
export function handleSecondInstance(argv: readonly string[]): void {
  const action = taskFromArgv(argv)
  if (action) deliver(action)
  else showWindow()
}

/** Sets up the Jump List (Windows) or Dock menu (Mac), and a task Glofly was started with. */
export function setupShortcuts(): void {
  const first = taskFromArgv(process.argv)
  if (first) pending = first

  if (process.platform === 'win32') {
    // A development copy runs as "electron.exe <app folder>", so the task has to say which app.
    const appArgs = process.defaultApp && process.argv[1] ? `"${resolve(process.argv[1])}" ` : ''
    app.setUserTasks(
      SHORTCUT_ACTIONS.map((action) => ({
        program: process.execPath,
        arguments: `${appArgs}${TASK_SWITCH}${action}`,
        iconPath: process.execPath,
        iconIndex: 0,
        title: SHORTCUT_LABELS[action].title,
        description: SHORTCUT_LABELS[action].description
      }))
    )
  } else if (process.platform === 'darwin' && app.dock) {
    const item = (action: ShortcutAction): Electron.MenuItemConstructorOptions => ({
      label: SHORTCUT_LABELS[action].title.replace('Set status: ', ''),
      click: () => deliver(action)
    })
    app.dock.setMenu(
      Menu.buildFromTemplate([
        item('new-message'),
        {
          label: 'Set status',
          submenu: [item('status:online'), item('status:away'), item('status:dnd')]
        },
        item('quiet-hours')
      ])
    )
  }
}

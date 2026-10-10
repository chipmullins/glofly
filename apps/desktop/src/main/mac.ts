import { app, Menu, shell, systemPreferences, type MenuItemConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'

// Mac-only pieces. Nothing here runs on Windows.
//
// - The app menu along the top of the screen. Without an Edit menu, ⌘C / ⌘V / ⌘A / ⌘Z don't
//   work in text boxes on a Mac (Windows handles those keys without a menu).
// - macOS's own permission prompts for the microphone and camera (System Settings → Privacy &
//   Security), and whether Screen Recording is allowed.

export const isMac = process.platform === 'darwin'

/** The menu bar at the top of the screen: Glofly, Edit, View, Window, Help. */
export function setUpMacMenu(): void {
  if (!isMac) return
  app.setAboutPanelOptions({
    applicationName: 'Glofly',
    applicationVersion: app.getVersion(),
    copyright: 'Copyright © 2026 Glofly',
    credits: 'Twemoji © Twitter (CC-BY 4.0) · Outfit and DM Sans (SIL OFL)'
  })

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Glofly',
      submenu: [
        { role: 'about', label: 'About Glofly' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Glofly' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Glofly' }
      ]
    },
    // Undo, Redo, Cut, Copy, Paste, Paste and Match Style, Delete, Select All, Speech.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        // Reload and DevTools only while developing (the installed app never reloads itself).
        ...(is.dev
          ? ([
              { role: 'reload' },
              { role: 'toggleDevTools' },
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])
          : []),
        // No zoom items: text size is Settings → Appearance.
        { role: 'togglefullscreen' }
      ]
    },
    // Minimize, Zoom, Close (⌘W hides the window; Glofly keeps running), Bring All to Front.
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Glofly website', click: () => void shell.openExternal('https://glofly.app') },
        {
          label: 'Contact support',
          click: () => void shell.openExternal('mailto:support@glofly.app')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * Before a call uses the microphone or camera, macOS must have said yes. The first time, this
 * shows macOS's own "Glofly would like to access the microphone" prompt (the wording comes from
 * electron-builder.yml). After that it answers straight away: true if allowed, false if the
 * person said no (then only System Settings → Privacy & Security can change it).
 * Always true on Windows.
 */
export async function askMacMediaAccess(types: string[]): Promise<boolean> {
  if (!isMac) return true
  try {
    for (const type of types) {
      if (type !== 'audio' && type !== 'video') continue
      const ok = await systemPreferences.askForMediaAccess(
        type === 'audio' ? 'microphone' : 'camera'
      )
      if (!ok) return false
    }
    return true
  } catch {
    return false
  }
}

export type ScreenAccess = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'

/**
 * Screen Recording permission (Mac). There's no prompt to ask for it directly: the first time
 * Glofly lists screens, macOS asks by itself; after a "no", only System Settings can change it,
 * and Glofly has to be reopened afterwards. Always "granted" on Windows.
 */
export function macScreenAccess(): ScreenAccess {
  if (!isMac) return 'granted'
  try {
    return systemPreferences.getMediaAccessStatus('screen') as ScreenAccess
  } catch {
    return 'unknown'
  }
}

const PRIVACY_PANES = {
  microphone: 'Privacy_Microphone',
  camera: 'Privacy_Camera',
  screen: 'Privacy_ScreenCapture',
  // Push to talk: seeing keys pressed in other apps
  accessibility: 'Privacy_Accessibility'
} as const
export type PrivacyPane = keyof typeof PRIVACY_PANES

export const isPrivacyPane = (value: unknown): value is PrivacyPane =>
  typeof value === 'string' && Object.hasOwn(PRIVACY_PANES, value)

/** Opens System Settings → Privacy & Security at the right list (Mac only). */
export function openMacPrivacySettings(pane: PrivacyPane): void {
  if (!isMac) return
  void shell.openExternal(
    `x-apple.systempreferences:com.apple.preference.security?${PRIVACY_PANES[pane]}`
  )
}

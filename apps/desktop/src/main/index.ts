import { app, shell, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { checkUsername, login, logout, register, restore } from './auth'
import type { LoginRequest, RegisterRequest, WindowTheme } from '../preload/api-types'

// Colors for the minimize / maximize / close buttons, matching each screen.
const TITLE_BAR = {
  login: { color: '#FFFBF7', symbolColor: '#24170F', height: 40 },
  app: { color: '#FFFFFF', symbolColor: '#4A372B', height: 40 }
} as const

// On Windows, Glofly draws its own top area and Windows only draws the window
// buttons (keeping Snap Layouts and double-click-to-maximize).
const customTitleBar = process.platform === 'win32'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: 'Glofly',
    backgroundColor: '#FFFBF7',
    show: false,
    autoHideMenuBar: true,
    ...(customTitleBar ? { titleBarStyle: 'hidden', titleBarOverlay: TITLE_BAR.login } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Links that try to open a new window go to the real browser instead (https only).
  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The Glofly window never navigates away from the app itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  // In development, load from the dev server (hot reload). Otherwise load the built files.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** True for pages that belong to the Glofly app itself. */
function isAppUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl && url.startsWith(devUrl)) return true
  return url.startsWith('file://')
}

/** Only answer requests that come from the Glofly window. */
function fromApp(event: IpcMainInvokeEvent): boolean {
  return isAppUrl(event.senderFrame?.url ?? '')
}

/** Never trust what arrives over IPC: check its shape before using it. */
function isLoginRequest(value: unknown): value is LoginRequest {
  const v = value as Partial<LoginRequest> | null
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.identifier === 'string' &&
    v.identifier.length <= 254 &&
    typeof v.password === 'string' &&
    v.password.length <= 128 &&
    typeof v.keepSignedIn === 'boolean'
  )
}

function isRegisterRequest(value: unknown): value is RegisterRequest {
  const v = value as Partial<RegisterRequest> | null
  const shortText = (x: unknown, max: number): boolean => typeof x === 'string' && x.length <= max
  return (
    typeof v === 'object' &&
    v !== null &&
    shortText(v.email, 254) &&
    shortText(v.username, 40) &&
    shortText(v.displayName, 64) &&
    shortText(v.password, 128) &&
    shortText(v.birthday, 10) &&
    typeof v.acceptTerms === 'boolean'
  )
}

function isWindowTheme(value: unknown): value is WindowTheme {
  return value === 'login' || value === 'app'
}

function registerIpcHandlers(): void {
  ipcMain.on('window:theme', (event, theme: unknown) => {
    if (!customTitleBar || !isAppUrl(event.senderFrame?.url ?? '') || !isWindowTheme(theme)) return
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(TITLE_BAR[theme])
  })

  ipcMain.handle('auth:register', (event, request: unknown) => {
    if (!fromApp(event) || !isRegisterRequest(request)) {
      return { ok: false, fields: {}, message: 'Check your details.' }
    }
    return register(request)
  })

  ipcMain.handle('auth:check-username', (event, username: unknown) => {
    if (!fromApp(event) || typeof username !== 'string' || username.length > 40) return null
    return checkUsername(username)
  })

  ipcMain.handle('auth:restore', (event) => {
    if (!fromApp(event)) return null
    return restore()
  })

  ipcMain.handle('auth:login', (event, request: unknown) => {
    if (!fromApp(event) || !isLoginRequest(request)) {
      return { ok: false, reason: 'invalid', message: 'Check your details.' }
    }
    return login(request)
  })

  ipcMain.handle('auth:logout', (event) => {
    if (!fromApp(event)) return
    return logout()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.glofly.app')

  // F12 opens DevTools in development; reload shortcuts are disabled in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  createWindow()

  app.on('activate', function () {
    // macOS: reopen the window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

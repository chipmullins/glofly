import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  call,
  fetchAuditCsv,
  isAllowedCall,
  reportError,
  SERVER_URL,
  signInCode,
  signInPassword,
  signOut,
  whenSignedOut
} from './api'

// Glofly Control: the admin app. Same safety rules as the Glofly app: a sandboxed window,
// a strict Content Security Policy, no permissions, no navigating away, and a narrow
// preload API whose every message is checked here.

if (!app.requestSingleInstanceLock()) app.quit()

let mainWindow: BrowserWindow | null = null

// The window draws its own top strip on Windows; the buttons follow the screen shown.
const TITLE_BAR = {
  signin: { color: '#1b1238', symbolColor: '#e9e3f7', height: 36 },
  app: { color: '#f6f2ec', symbolColor: '#24170f', height: 36 }
} as const
const customTitleBar = process.platform === 'win32'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 680,
    title: 'Glofly Control',
    backgroundColor: '#1b1238',
    show: false,
    autoHideMenuBar: true,
    ...(customTitleBar ? { titleBarStyle: 'hidden', titleBarOverlay: TITLE_BAR.signin } : {}),
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      spellcheck: false,
      additionalArguments: [`--control-server=${SERVER_URL}`]
    }
  })
  mainWindow = window
  window.on('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  // No new windows. https links (glofly.app, the Terms) open in the real browser.
  window.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const APP_PAGE = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** Only Control's own page counts as the app. */
function isAppUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) return url.startsWith(devUrl)
  return url.split(/[?#]/)[0] === APP_PAGE
}

const fromApp = (event: IpcMainInvokeEvent | IpcMainEvent): boolean =>
  isAppUrl(event.senderFrame?.url ?? '')

const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max

/** A request body: a plain object, small. */
function isBody(value: unknown): boolean {
  if (value === undefined) return true
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    return JSON.stringify(value).length <= 8_000
  } catch {
    return false
  }
}

/** 0.8.2: pages a desktop alert can open (renderer Page names). */
const ALERT_PAGES = new Set([
  'dashboard',
  'accounts',
  'reports',
  'inbox',
  'constellations',
  'server',
  'errors',
  'audit'
])

/** 0.8.2: a native notification for a Control alert; clicking it brings Control forward on that page. */
function showAlert(title: string, body: string, page: string): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title, body, silent: false })
  notification.on('click', () => {
    const window = mainWindow
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('control:open-page', page)
  })
  notification.show()
}

const REFUSED = { ok: false, status: 0, error: 'refused', message: 'Not allowed.' } as const

function setUpIpc(): void {
  ipcMain.handle('signin:password', (event, username: unknown, password: unknown) => {
    if (!fromApp(event) || !text(username, 254) || !text(password, 256)) return REFUSED
    return signInPassword(username, password)
  })
  ipcMain.handle('signin:code', (event, kind: unknown, value: unknown) => {
    if (!fromApp(event) || (kind !== 'code' && kind !== 'backupCode') || !text(value, 40)) {
      return REFUSED
    }
    return signInCode(kind, value)
  })
  ipcMain.handle('signin:signout', (event) => {
    if (!fromApp(event)) return
    return signOut()
  })
  ipcMain.handle('control:call', (event, method: unknown, path: unknown, body: unknown) => {
    if (!fromApp(event) || !isAllowedCall(method, path) || !isBody(body)) return REFUSED
    return call(method as string, path as string, body)
  })
  ipcMain.handle('control:export-audit', async (event) => {
    if (!fromApp(event) || !mainWindow) return { ok: false, message: 'Not allowed.' }
    const result = await fetchAuditCsv()
    if (!result.ok) return result
    const day = new Date().toISOString().slice(0, 10)
    const choice = await dialog.showSaveDialog(mainWindow, {
      title: 'Save the audit log',
      defaultPath: `glofly-audit-log-${day}.csv`,
      filters: [{ name: 'CSV (Excel, Google Sheets)', extensions: ['csv'] }]
    })
    if (choice.canceled || !choice.filePath) return { ok: true, saved: false }
    try {
      await writeFile(choice.filePath, result.csv, 'utf8')
    } catch {
      // (A thrown error would leave the window's Export button stuck on "Exporting…".)
      return { ok: false, message: "Couldn't save there. Try another folder." }
    }
    return { ok: true, saved: true }
  })
  ipcMain.handle('control:copy', async (event, value: unknown) => {
    // Electron 44: writeText answers with a promise (it used to be instant).
    // (0.7.3: up to 5,000 characters, so an error's whole stack can be copied.)
    if (fromApp(event) && text(value, 5000)) await clipboard.writeText(value).catch(() => undefined)
  })
  ipcMain.handle('control:open-external', (event, url: unknown) => {
    if (
      fromApp(event) &&
      text(url, 300) &&
      /^https:\/\/(glofly\.app|api\.glofly\.app)(\/|$)/.test(url)
    ) {
      void shell.openExternal(url)
    }
  })
  ipcMain.on('control:report-error', (event, report: unknown) => {
    if (!fromApp(event) || typeof report !== 'object' || report === null) return
    const r = report as Record<string, unknown>
    if (!text(r.message, 2000)) return
    reportError(
      {
        message: r.message,
        stack: typeof r.stack === 'string' ? r.stack.slice(0, 8000) : undefined,
        where: typeof r.where === 'string' ? r.where.slice(0, 40) : undefined
      },
      app.getVersion()
    )
  })
  ipcMain.on('control:notify', (event, alert: unknown) => {
    if (!fromApp(event) || typeof alert !== 'object' || alert === null) return
    const a = alert as Record<string, unknown>
    if (!text(a.title, 120) || (a.body !== '' && !text(a.body, 300))) return
    if (typeof a.page !== 'string' || !ALERT_PAGES.has(a.page)) return
    showAlert(a.title, a.body as string, a.page)
  })
  ipcMain.on('control:screen', (event, screen: unknown) => {
    if (!fromApp(event) || !customTitleBar || (screen !== 'signin' && screen !== 'app')) return
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(TITLE_BAR[screen])
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.glofly.control')
  // Control needs no camera, microphone, notifications or anything else: refuse every permission.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(permission === 'clipboard-sanitized-write')
  )
  session.defaultSession.setPermissionCheckHandler(
    (_contents, permission) => permission === 'clipboard-sanitized-write'
  )
  setUpIpc()
  whenSignedOut((reason) => mainWindow?.webContents.send('control:signed-out', reason))
  createWindow()
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Closing Control signs out (the session would end within the hour anyway).
  void signOut().finally(() => app.quit())
})

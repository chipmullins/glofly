import { app, shell, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import {
  API_URL,
  checkUsername,
  endSessionLocally,
  getSessionToken,
  login,
  logout,
  register,
  restore
} from './auth'
import {
  deleteMessage,
  editMessage,
  listConversations,
  loadMessages,
  markRead,
  openDm,
  reactToMessage,
  sendMessage
} from './messages'
import { connectRealtime, disconnectRealtime, sendTyping } from './realtime'
import { getMyStatus, getSettings, setMyStatus, setSettings, startIdleWatch } from './status'
import { isUserId } from './api'
import {
  acceptRequest,
  blockUser,
  listFriends,
  removeFriend,
  removeRequest,
  searchUsers,
  sendRequest,
  unblockUser
} from './friends'
import type { LoginRequest, RegisterRequest, WindowTheme } from '../preload/api-types'

// Colors for the minimize / maximize / close buttons, matching each screen.
const TITLE_BAR = {
  login: { color: '#FFFBF7', symbolColor: '#24170F', height: 40 },
  app: { color: '#FFFFFF', symbolColor: '#4A372B', height: 40 }
} as const

// Developer option: `npm run second -w apps/desktop` opens a second copy of Glofly with its
// own saved sign-in, so two test accounts can chat live on one PC.
const isSecondWindow = process.env.npm_lifecycle_event === 'second'
if (isSecondWindow) app.setPath('userData', `${app.getPath('userData')}-second`)

// On Windows, Glofly draws its own top area and Windows only draws the window
// buttons (keeping Snap Layouts and double-click-to-maximize).
const customTitleBar = process.platform === 'win32'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: isSecondWindow ? 'Glofly (second window)' : 'Glofly',
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

  // Keep "(second window)" in the title so the two copies are easy to tell apart.
  if (isSecondWindow) mainWindow.on('page-title-updated', (event) => event.preventDefault())

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

/** Opens the live connection once signed in. If the server rejects it, sign out here too. */
function goLive(): void {
  const token = getSessionToken()
  if (token) connectRealtime(API_URL, token, () => void endSessionLocally())
}

/** Runs an auth action, and opens the live connection if it signed someone in. */
async function thenGoLive<T>(result: Promise<T>): Promise<T> {
  const value = await result
  if (getSessionToken()) goLive()
  return value
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
    return thenGoLive(register(request))
  })

  ipcMain.handle('auth:check-username', (event, username: unknown) => {
    if (!fromApp(event) || typeof username !== 'string' || username.length > 40) return null
    return checkUsername(username)
  })

  // Friends. Every handler checks the sender and the input before calling the server.
  const invalid = { ok: false, error: 'invalid', message: 'Something about that request was off.' }
  const isShortText = (v: unknown, max: number): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= max

  ipcMain.handle('friends:list', (event) => (fromApp(event) ? listFriends() : invalid))
  ipcMain.handle('friends:search', (event, query: unknown) =>
    fromApp(event) && isShortText(query, 32) ? searchUsers(query) : invalid
  )
  ipcMain.handle('friends:send-request', (event, username: unknown) =>
    fromApp(event) && isShortText(username, 40) ? sendRequest(username) : invalid
  )
  const byUserId: [string, (id: string) => Promise<unknown>][] = [
    ['friends:accept', acceptRequest],
    ['friends:remove-request', removeRequest],
    ['friends:remove', removeFriend],
    ['friends:block', blockUser],
    ['friends:unblock', unblockUser]
  ]
  for (const [channel, action] of byUserId) {
    ipcMain.handle(channel, (event, userId: unknown) =>
      fromApp(event) && isUserId(userId) ? action(userId) : invalid
    )
  }

  // Privacy settings: only known on/off settings get through.
  ipcMain.handle('settings:get', (event) => (fromApp(event) ? getSettings() : invalid))
  ipcMain.handle('settings:set', (event, changes: unknown) => {
    const known = ['readReceipts', 'showLastSeen', 'showTyping']
    const c = changes as Record<string, unknown> | null
    const ok =
      fromApp(event) &&
      typeof c === 'object' &&
      c !== null &&
      Object.keys(c).length > 0 &&
      Object.entries(c).every(([k, v]) => known.includes(k) && typeof v === 'boolean')
    return ok ? setSettings(c as Record<string, boolean>) : invalid
  })

  // Your status.
  ipcMain.handle('status:get', (event) => (fromApp(event) ? getMyStatus() : invalid))
  ipcMain.handle('status:set', (event, changes: unknown) => {
    const c = changes as { status?: unknown; statusText?: unknown } | null
    const choices = ['online', 'away', 'dnd', 'invisible']
    const ok =
      fromApp(event) &&
      typeof c === 'object' &&
      c !== null &&
      (c.status === undefined || (typeof c.status === 'string' && choices.includes(c.status))) &&
      (c.statusText === undefined ||
        c.statusText === null ||
        (typeof c.statusText === 'string' && c.statusText.length <= 200))
    if (!ok) return invalid
    return setMyStatus({
      ...(c.status !== undefined ? { status: c.status as 'online' } : {}),
      ...(c.statusText !== undefined ? { statusText: c.statusText as string | null } : {})
    })
  })

  // Conversations and messages.
  const isMessage = (v: unknown): v is string => typeof v === 'string' && v.length <= 8000
  ipcMain.handle('conversations:list', (event) => (fromApp(event) ? listConversations() : invalid))
  ipcMain.handle('conversations:open-dm', (event, userId: unknown) =>
    fromApp(event) && isUserId(userId) ? openDm(userId) : invalid
  )
  ipcMain.handle('conversations:messages', (event, id: unknown, before: unknown) =>
    fromApp(event) && isUserId(id) && (before === undefined || isUserId(before))
      ? loadMessages(id, before)
      : invalid
  )
  ipcMain.handle('conversations:send', (event, id: unknown, body: unknown, replyTo: unknown) =>
    fromApp(event) && isUserId(id) && isMessage(body) && (replyTo == null || isUserId(replyTo))
      ? sendMessage(id, body, replyTo ?? undefined)
      : invalid
  )
  ipcMain.handle('conversations:edit', (event, id: unknown, messageId: unknown, body: unknown) =>
    fromApp(event) && isUserId(id) && isUserId(messageId) && isMessage(body)
      ? editMessage(id, messageId, body)
      : invalid
  )
  ipcMain.handle('conversations:remove', (event, id: unknown, messageId: unknown) =>
    fromApp(event) && isUserId(id) && isUserId(messageId) ? deleteMessage(id, messageId) : invalid
  )
  ipcMain.handle(
    'conversations:react',
    (event, id: unknown, messageId: unknown, emoji: unknown, on: unknown) =>
      fromApp(event) &&
      isUserId(id) &&
      isUserId(messageId) &&
      typeof emoji === 'string' &&
      emoji.length > 0 &&
      emoji.length <= 32 &&
      typeof on === 'boolean'
        ? reactToMessage(id, messageId, emoji, on)
        : invalid
  )
  ipcMain.handle('conversations:read', (event, id: unknown) =>
    fromApp(event) && isUserId(id) ? markRead(id) : invalid
  )
  ipcMain.on('conversations:typing', (event, id: unknown) => {
    if (isAppUrl(event.senderFrame?.url ?? '') && isUserId(id)) sendTyping(id)
  })

  ipcMain.handle('auth:restore', (event) => {
    if (!fromApp(event)) return null
    return thenGoLive(restore())
  })

  ipcMain.handle('auth:login', (event, request: unknown) => {
    if (!fromApp(event) || !isLoginRequest(request)) {
      return { ok: false, reason: 'invalid', message: 'Check your details.' }
    }
    return thenGoLive(login(request))
  })

  ipcMain.handle('auth:logout', (event) => {
    if (!fromApp(event)) return
    disconnectRealtime()
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
  startIdleWatch()
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

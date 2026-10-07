import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  protocol,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
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
  removeUpload,
  sendMessage,
  uploadAttachment
} from './messages'
import { saveAttachment, showInFolder } from './files'
import { changePassword, deleteAccount, getAccount } from './account'
import {
  appearanceArgs,
  getAppSettings,
  isAppSettingsChanges,
  isDark,
  loadAppSettings,
  setAppSettings,
  zoomFactor,
  sendAppearance,
  setUpTray,
  shouldHideOnClose,
  showWindow,
  startHidden
} from './app-settings'
import { connectRealtime, disconnectRealtime, sendTyping } from './realtime'
import { getMyStatus, getSettings, setMyStatus, setSettings, startIdleWatch } from './status'
import { isUserId } from './api'
import { handleMediaRequest, MEDIA_SCHEME } from './media'
import { getMyProfile, getProfile, removePhoto, setPhoto, updateProfile } from './profile'
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
import type {
  LoginRequest,
  PhotoType,
  PrivacySettings,
  ProfileChanges,
  RegisterRequest,
  WindowTheme
} from '../preload/api-types'

// Colors for the minimize / maximize / close buttons, matching each screen and theme.
const TITLE_BAR = {
  login: { color: '#FFFBF7', symbolColor: '#24170F', height: 40 },
  app: { color: '#FFFFFF', symbolColor: '#4A372B', height: 40 },
  loginDark: { color: '#1E1916', symbolColor: '#D9C8BC', height: 40 },
  appDark: { color: '#1E1916', symbolColor: '#D9C8BC', height: 40 }
} as const

const titleBarFor = (screen: WindowTheme): (typeof TITLE_BAR)[keyof typeof TITLE_BAR] =>
  TITLE_BAR[isDark() ? (screen === 'app' ? 'appDark' : 'loginDark') : screen]

/** Which screen each window is showing, so its window buttons can follow theme changes. */
const screenOf = new Map<number, WindowTheme>()

// Developer option: `npm run second -w apps/desktop` opens a second copy of Glofly with its
// own saved sign-in, so two test accounts can chat live on one PC.
const isSecondWindow = process.env.npm_lifecycle_event === 'second'
if (isSecondWindow) app.setPath('userData', `${app.getPath('userData')}-second`)

// Only one Glofly at a time (per sign-in folder). Opening it again, say while it's in the
// tray, brings the existing window forward instead.
if (!app.requestSingleInstanceLock()) app.quit()
else app.on('second-instance', () => showWindow())

let mainWindow: BrowserWindow | null = null

// Profile photos load through glofly-media:// (see media.ts). Registered before the app
// starts, as a secure scheme so the window treats it like https.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true } }
])

// On Windows, Glofly draws its own top area and Windows only draws the window
// buttons (keeping Snap Layouts and double-click-to-maximize).
const customTitleBar = process.platform === 'win32'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 700,
    title: isSecondWindow ? 'Glofly (second window)' : 'Glofly',
    backgroundColor: isDark() ? '#1E1916' : '#FFFBF7',
    show: false,
    autoHideMenuBar: true,
    ...(customTitleBar ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarFor('login') } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // The accent is known before the page draws, so it never flashes the wrong color.
      additionalArguments: appearanceArgs()
    }
  })

  mainWindow = window
  // Text size (Settings → Appearance) is a zoom level for the whole window.
  // A reload (say, while developing) gets the current theme and accent too.
  window.webContents.on('did-finish-load', () => {
    window.webContents.setZoomFactor(zoomFactor())
    sendAppearance([window])
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  // Keep "(second window)" in the title so the two copies are easy to tell apart.
  if (isSecondWindow) window.on('page-title-updated', (event) => event.preventDefault())

  // Started with the computer: stay in the tray until opened.
  window.on('ready-to-show', () => {
    if (!startHidden()) window.show()
  })

  // "Keep running in the system tray when closed": closing just hides the window.
  window.on('close', (event) => {
    if (shouldHideOnClose()) {
      event.preventDefault()
      window.hide()
    }
  })

  // Links that try to open a new window go to the real browser instead (https only).
  window.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // The Glofly window never navigates away from the app itself.
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  // In development, load from the dev server (hot reload). Otherwise load the built files.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// The one page that is the Glofly app. Any other file (say, one dropped on the window)
// is never treated as the app, so it can't navigate in or talk to the main process.
const APP_PAGE = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** True for pages that belong to the Glofly app itself. */
function isAppUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) return url.startsWith(devUrl)
  return url.split(/[?#]/)[0] === APP_PAGE
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
    typeof v.keepSignedIn === 'boolean' &&
    (v.restore === undefined || typeof v.restore === 'boolean')
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
    screenOf.set(event.sender.id, theme)
    BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(titleBarFor(theme))
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

  // Privacy settings: only known settings with allowed values get through.
  ipcMain.handle('settings:get', (event) => (fromApp(event) ? getSettings() : invalid))
  ipcMain.handle('settings:set', (event, changes: unknown) => {
    const onOff = ['readReceipts', 'showLastSeen', 'showTyping']
    const allowed = (k: string, v: unknown): boolean =>
      onOff.includes(k)
        ? typeof v === 'boolean'
        : k === 'friendRequests' && (v === 'everyone' || v === 'nobody')
    const c = changes as Record<string, unknown> | null
    const ok =
      fromApp(event) &&
      typeof c === 'object' &&
      c !== null &&
      Object.keys(c).length > 0 &&
      Object.entries(c).every(([k, v]) => allowed(k, v))
    return ok ? setSettings(c as Partial<PrivacySettings>) : invalid
  })

  // App settings (this computer only).
  ipcMain.handle('app:get-settings', (event) => (fromApp(event) ? getAppSettings() : null))
  ipcMain.handle('app:set-settings', (event, changes: unknown) =>
    fromApp(event) && isAppSettingsChanges(changes) ? setAppSettings(changes) : null
  )

  // Settings → Account. Passwords are checked for size only; the server does the rest.
  const isPassword = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= 128
  ipcMain.handle(
    'account:change-password',
    (event, current: unknown, next: unknown, signOutOthers: unknown) =>
      fromApp(event) &&
      isPassword(current) &&
      isPassword(next) &&
      typeof signOutOthers === 'boolean'
        ? changePassword(current, next, signOutOthers)
        : invalid
  )
  ipcMain.handle('account:get', (event) => (fromApp(event) ? getAccount() : invalid))
  ipcMain.handle('account:delete', (event, password: unknown) =>
    fromApp(event) && isPassword(password) ? deleteAccount(password) : invalid
  )

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

  // Profiles and profile photos.
  const PHOTO_MAX_BYTES = 8 * 1024 * 1024
  const PHOTO_TYPES: PhotoType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const BIO_MAX = 190
  const isProfileChanges = (value: unknown): value is ProfileChanges => {
    const c = value as Record<string, unknown> | null
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return false
    const keys = Object.keys(c)
    return (
      keys.length > 0 &&
      keys.every((k) => k === 'displayName' || k === 'bio') &&
      (c.displayName === undefined ||
        (typeof c.displayName === 'string' && c.displayName.length <= 64)) &&
      (c.bio === undefined ||
        c.bio === null ||
        (typeof c.bio === 'string' && c.bio.length <= BIO_MAX * 2))
    )
  }
  ipcMain.handle('profile:get-mine', (event) => (fromApp(event) ? getMyProfile() : invalid))
  ipcMain.handle('profile:get', (event, userId: unknown) =>
    fromApp(event) && isUserId(userId) ? getProfile(userId) : invalid
  )
  ipcMain.handle('profile:update', (event, changes: unknown) =>
    fromApp(event) && isProfileChanges(changes) ? updateProfile(changes) : invalid
  )
  ipcMain.handle('profile:set-photo', (event, data: unknown, type: unknown) => {
    if (
      !fromApp(event) ||
      !(data instanceof ArrayBuffer) ||
      !PHOTO_TYPES.includes(type as PhotoType)
    ) {
      return invalid
    }
    if (data.byteLength === 0 || data.byteLength > PHOTO_MAX_BYTES) {
      return { ok: false, error: 'invalid', message: 'Photos can be up to 8 MB.' }
    }
    return setPhoto(new Uint8Array(data), type as PhotoType)
  })
  ipcMain.handle('profile:remove-photo', (event) => (fromApp(event) ? removePhoto() : invalid))

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
  const isAttachmentIds = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length <= 10 && v.every(isUserId)
  ipcMain.handle(
    'conversations:send',
    (event, id: unknown, body: unknown, replyTo: unknown, attachmentIds: unknown) =>
      fromApp(event) &&
      isUserId(id) &&
      isMessage(body) &&
      (replyTo == null || isUserId(replyTo)) &&
      (attachmentIds == null || isAttachmentIds(attachmentIds))
        ? sendMessage(id, body, replyTo ?? undefined, attachmentIds ?? undefined)
        : invalid
  )

  // Photos and files in chats.
  const FILE_MAX_BYTES = 25 * 1024 * 1024
  ipcMain.handle('conversations:upload', (event, id: unknown, data: unknown, name: unknown) => {
    if (
      !fromApp(event) ||
      !isUserId(id) ||
      !(data instanceof ArrayBuffer) ||
      typeof name !== 'string' ||
      name.length > 1000
    ) {
      return invalid
    }
    if (data.byteLength === 0)
      return { ok: false, error: 'invalid', message: 'That file is empty.' }
    if (data.byteLength > FILE_MAX_BYTES) {
      return { ok: false, error: 'invalid', message: 'Files can be up to 25 MB.' }
    }
    return uploadAttachment(id, new Uint8Array(data), name)
  })
  ipcMain.handle('conversations:remove-upload', (event, id: unknown, attachmentId: unknown) =>
    fromApp(event) && isUserId(id) && isUserId(attachmentId)
      ? removeUpload(id, attachmentId)
      : invalid
  )
  ipcMain.handle(
    'files:save',
    (event, id: unknown, attachmentId: unknown, kind: unknown, name: unknown) =>
      fromApp(event) &&
      isUserId(id) &&
      isUserId(attachmentId) &&
      (kind === 'image' || kind === 'file') &&
      typeof name === 'string' &&
      name.length <= 1000
        ? saveAttachment(BrowserWindow.fromWebContents(event.sender), id, attachmentId, kind, name)
        : invalid
  )
  ipcMain.on('files:show-in-folder', (event, path: unknown) => {
    if (isAppUrl(event.senderFrame?.url ?? '') && typeof path === 'string') showInFolder(path)
  })
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

  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
  loadAppSettings()
  registerIpcHandlers()
  startIdleWatch()
  createWindow()
  setUpTray(() => mainWindow, icon)

  // Light ↔ dark (picked in Settings, or Windows changed with "Match system"):
  // the page follows by itself; the window background and buttons follow here.
  nativeTheme.on('updated', () => {
    sendAppearance()
    for (const window of BrowserWindow.getAllWindows()) {
      window.setBackgroundColor(isDark() ? '#1E1916' : '#FFFBF7')
      if (customTitleBar) {
        window.setTitleBarOverlay(titleBarFor(screenOf.get(window.webContents.id) ?? 'login'))
      }
    }
  })

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

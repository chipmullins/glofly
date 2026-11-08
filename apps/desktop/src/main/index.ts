import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
// Mac menu-bar icon (macOS picks trayTemplate@2x.png beside it on Retina screens).
import menuBarIcon from '../../resources/trayTemplate.png?asset'
import {
  API_URL,
  checkUsername,
  endSessionLocally,
  forgotPassword,
  getSessionToken,
  login,
  loginCode,
  loginResend,
  logout,
  qrPoll,
  qrStart,
  register,
  restore,
  signupMode,
  friendLinkInfo
} from './auth'
import { reportError, setErrorReports, watchMainErrors, watchProcessCrashes } from './errors'
import {
  deleteMessage,
  editMessage,
  listConversations,
  loadMessages,
  searchMessages,
  markRead,
  forwardMessage,
  forwardTargets,
  pinConversation,
  orderGroups,
  orderPins,
  muteConversation,
  closeConversation,
  openDm,
  createGroup,
  renameGroup,
  setGroupPhoto,
  removeGroupPhoto,
  addMembers,
  removeMember,
  reactToMessage,
  removeUpload,
  sendMessage,
  uploadAttachment
} from './messages'
import * as extras from './chatExtras'
import * as social from './social'
import { saveAttachment, showInFolder } from './files'
import { handleSecondInstance, setupShortcuts, takePendingShortcut } from './shortcuts'
import { handleDeepLinkArgv, setupDeepLinks, takeDeepLink } from './deepLinks'
import { FRIEND_LINK_PATTERN } from '@glofly/shared/friendLinks'
import {
  clearAllNotifications,
  clearNotification,
  isShowNotification,
  listenToNotificationPresses,
  setBadge,
  showTestNotification,
  openNotificationSettings,
  showNotification
} from './notifications'
import {
  activeCalls,
  answerCall,
  chooseScreen,
  declineCall,
  joinCall,
  leaveCall,
  pickedScreen,
  ringPeople,
  addToCall,
  stayInCall,
  screenSources,
  startCall,
  watchControl,
  watchGet,
  watchPlayerUrl,
  watchPreview,
  watchReact,
  watchReport,
  watchSettings,
  watchStart,
  watchStop
} from './calls'
import { screenSoundSupport, startScreenSound, stopScreenSound } from './screenSound'
import { isWatchReaction } from '@glofly/shared/watch'
import { looksLikeVideo } from '@glofly/shared/attachments'
import { VIDEO_MAX_BYTES } from '@glofly/shared/rules'
import { isStatusClearAfter, type StatusClearAfter } from '@glofly/shared/statusClear'
import {
  cancelEmailChange,
  changeEmail,
  changePassword,
  deleteAccount,
  getAccount,
  listSessions,
  resendVerification,
  signOutDevice,
  signOutOtherDevices
} from './account'
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
import { goodbyeFirst, watchShutdown } from './goodbye'
import { connectRealtime, disconnectRealtime, sendTyping, shareActivity } from './realtime'
import {
  isOverlayWindow,
  overlayClear,
  overlayNotification,
  overlaySignedIn,
  overlaySignedOut,
  startOverlay
} from './overlay'
import {
  addGame,
  cleanGameName,
  gameState,
  hideGame,
  isExe,
  markNoticeShown,
  removeGame,
  runningPrograms,
  setGamesEnabled,
  startGameWatch
} from './games'
import { getMyStatus, getSettings, setMyStatus, setSettings, startIdleWatch } from './status'
import { isAppsRequest, isConstellationRequest, isToolsRequest, isUserId } from './api'
import { checkPausedNow, configurePauseChecks, getPaused, getUpdateRequired } from './app-status'
import { isReportRequest, listNotices, noticeReply, noticeSeen, sendReport } from './safety'
import { TEAM_REPLY_MAX } from '@glofly/shared/types'
import { handleMediaRequest, MEDIA_SCHEME } from './media'
import { checkNow, restartToUpdate, startAutoUpdates, updateReady } from './updater'
import { focusLaunchWindow, updateOnLaunch } from './launchUpdate'
import { isPttBinding, startPtt, stopPtt } from './ptt'
import {
  askMacMediaAccess,
  isMac,
  isPrivacyPane,
  macScreenAccess,
  openMacPrivacySettings,
  setUpMacMenu
} from './mac'
import {
  getMyProfile,
  getProfile,
  removePhoto,
  setNickname,
  setHeader,
  removeHeader,
  getMutuals,
  getActivity,
  setPhoto,
  updateProfile
} from './profile'
import {
  acceptRequest,
  blockUser,
  listFriends,
  removeFriend,
  removeRequest,
  searchUsers,
  sendRequest,
  unblockUser,
  setOnlineAlert,
  inviteByEmail,
  myFriendLink,
  resetFriendLink,
  previewFriendLink,
  acceptFriendLink
} from './friends'
import type {
  VoiceInfo,
  LoginRequest,
  MuteDuration,
  PhotoType,
  PrivacySettings,
  ProfileChanges,
  RegisterRequest,
  SignedInUser,
  WindowTheme
} from '../preload/api-types'
import { request as apiRequest } from './api'

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
/** The exact colors under each window's buttons, as the page last reported them (2.0). */
const titleBarColorOf = new Map<number, { color: string; symbolColor: string; height: number }>()
const titleBarOf = (
  window: BrowserWindow
): { color: string; symbolColor: string; height: number } =>
  titleBarColorOf.get(window.webContents.id) ??
  titleBarFor(screenOf.get(window.webContents.id) ?? 'login')
const HEX = /^#[0-9a-fA-F]{6}$/

// Developer option: `npm run second -w apps/desktop` opens a second copy of Glofly with its
// own saved sign-in, so two test accounts can chat live on one PC.
const isSecondWindow = process.env.npm_lifecycle_event === 'second'
if (isSecondWindow) app.setPath('userData', `${app.getPath('userData')}-second`)

// Only one Glofly at a time (per sign-in folder). Opening it again, say while it's in the
// tray, brings the existing window forward instead.
// A Jump List task (Windows) arrives this way too: see shortcuts.ts.
// 0.8.0: a glofly:// link (a friend's invite link) arrives the same way on Windows (deepLinks.ts).
if (!app.requestSingleInstanceLock()) app.quit()
else
  app.on('second-instance', (_event, argv) => {
    if (!handleDeepLinkArgv(argv)) handleSecondInstance(argv)
    // 0.8.6: while the updater window is up, it comes forward (a link or Jump List task waits
    // for Glofly's window, which picks it up when it opens).
    focusLaunchWindow()
  })
setupDeepLinks()

let mainWindow: BrowserWindow | null = null

// Profile photos load through glofly-media:// (see media.ts). Registered before the app
// starts, as a secure scheme so the window treats it like https.
protocol.registerSchemesAsPrivileged([
  // corsEnabled: the window can draw a profile photo onto a canvas (notification pictures).
  {
    scheme: MEDIA_SCHEME,
    // stream: videos (0.5.0) play while they load, and can be skipped through (Range requests).
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true
    }
  }
])

// On Windows, Glofly draws its own top area and Windows only draws the window
// buttons (keeping Snap Layouts and double-click-to-maximize).
const customTitleBar = process.platform === 'win32'

// On a Mac, the page runs up to the top edge too, with macOS's red / yellow / green buttons
// (traffic lights) over its top-left corner. The page leaves room for them (main.tsx adds
// .mac-titlebar). Double-clicking the empty top area zooms the window, as on any Mac app.
const macTitleBar = {
  titleBarStyle: 'hidden',
  trafficLightPosition: { x: 18, y: 18 }
} as const

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
    ...(isMac ? macTitleBar : {}),
    // The Glofly icon on the window and taskbar (the installed app also has it built in).
    ...(process.platform !== 'darwin' ? { icon } : {}),
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
    // The game overlay goes with it (else an invisible window would keep Glofly running).
    overlaySignedOut()
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
    } else if (window === mainWindow && process.platform !== 'darwin' && goodbyeFirst(window)) {
      // Closing quits Glofly (no tray): the log-off sound first, then it quits.
      event.preventDefault()
    }
  })
  watchShutdown(window)

  // Links that try to open a new window go to the real browser instead (https only).
  window.webContents.setWindowOpenHandler((details) => {
    // https links open in the browser; the only email link allowed is Glofly support's.
    if (details.url.startsWith('https://') || details.url === 'mailto:support@glofly.app') {
      shell.openExternal(details.url)
    }
    // Communities round: a cfx.re/join card's Join opens FiveM / RedM into that server (only
    // their own connect links, nothing else in those schemes).
    if (/^(fivem|redm):\/\/connect\/cfx\.re\/join\/[a-z0-9]{4,12}$/.test(details.url)) {
      void shell.openExternal(details.url)
    }
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

// What the Glofly page may use. Electron says yes to everything unless told otherwise, so only
// these are allowed, and only for the app's own page: the microphone and camera (calls), copying
// text, full screen (a shared screen), and picking where call audio plays.
const ALLOWED_PERMISSIONS = new Set([
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
  'speaker-selection'
])

function setUpPermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const media =
      permission !== 'media' ||
      ('mediaTypes' in details &&
        (details.mediaTypes ?? []).every((t) => t === 'audio' || t === 'video'))
    const allowed = ALLOWED_PERMISSIONS.has(permission) && media && isAppUrl(details.requestingUrl)
    // Mac: the microphone and camera also need macOS's own yes (its prompt the first time).
    if (allowed && isMac && permission === 'media' && 'mediaTypes' in details) {
      void askMacMediaAccess(details.mediaTypes ?? []).then(callback)
      return
    }
    callback(allowed)
  })
  ses.setPermissionCheckHandler((contents, permission, _origin, details) => {
    const url = details.requestingUrl ?? contents?.getURL() ?? ''
    return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(url)
  })
  // Sharing your screen in a call: only the screen or window picked in Glofly's own picker.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isAppUrl(request.frame?.url ?? '')) {
        callback({})
        return
      }
      void pickedScreen()
        .then((picked) => {
          if (!picked) console.warn('[screen share] the picked screen or window was not found')
          // Older Windows: Electron's loopback sends the computer's sound (asked for, and only
          // then). Everywhere else the sound comes from screenSound, never from here.
          callback(
            picked
              ? picked.sound && request.audioRequested
                ? { video: picked.source, audio: 'loopback' }
                : { video: picked.source }
              : {}
          )
        })
        .catch((err) => {
          console.warn('[screen share] failed', err)
          callback({})
        })
    },
    { useSystemPicker: false }
  )
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
    typeof v.acceptTerms === 'boolean' &&
    (v.inviteCode === undefined || shortText(v.inviteCode, 20)) &&
    (v.friendLink === undefined || shortText(v.friendLink, 40))
  )
}

function isWindowTheme(value: unknown): value is WindowTheme {
  return value === 'login' || value === 'app'
}

/** Opens the live connection once signed in. If the server rejects it, sign out here too. */
function goLive(): void {
  const token = getSessionToken()
  if (token) connectRealtime(API_URL, token, () => void endSessionLocally())
  if (token) overlaySignedIn()
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
    const window = BrowserWindow.fromWebContents(event.sender)
    if (window) window.setTitleBarOverlay(titleBarOf(window))
  })

  // The page samples the color right under the window buttons (banners, Constellations' night
  // sky, dialogs' dimming…) and the buttons take it on, so they never sit in a mismatched box.
  ipcMain.on('window:titlebar-color', (event, color: unknown, symbolColor: unknown) => {
    if (!customTitleBar || !isAppUrl(event.senderFrame?.url ?? '')) return
    if (typeof color !== 'string' || typeof symbolColor !== 'string') return
    if (!HEX.test(color) || !HEX.test(symbolColor)) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    const bar = { color, symbolColor, height: 40 }
    titleBarColorOf.set(event.sender.id, bar)
    window.setTitleBarOverlay(bar)
  })

  ipcMain.handle('auth:register', (event, request: unknown) => {
    if (!fromApp(event) || !isRegisterRequest(request)) {
      return { ok: false, fields: {}, message: 'Check your details.' }
    }
    return thenGoLive(register(request))
  })

  ipcMain.handle('auth:signup-mode', (event) => {
    if (!fromApp(event)) return null
    return signupMode()
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
  ipcMain.handle('friends:set-online-alert', (event, userId: unknown, on: unknown) =>
    fromApp(event) && isUserId(userId) && typeof on === 'boolean'
      ? setOnlineAlert(userId, on)
      : invalid
  )
  ipcMain.handle('friends:invite', (event, email: unknown) =>
    fromApp(event) && typeof email === 'string' && email.length > 0 && email.length <= 320
      ? inviteByEmail(email)
      : invalid
  )
  // 0.8.0: shareable friend invite links.
  const isLinkCode = (code: unknown): code is string =>
    typeof code === 'string' && FRIEND_LINK_PATTERN.test(code)
  ipcMain.handle('friends:my-link', (event) => (fromApp(event) ? myFriendLink() : invalid))
  ipcMain.handle('friends:reset-link', (event) => (fromApp(event) ? resetFriendLink() : invalid))
  ipcMain.handle('friends:preview-link', (event, code: unknown) =>
    fromApp(event) && isLinkCode(code) ? previewFriendLink(code) : invalid
  )
  ipcMain.handle('friends:accept-link', (event, code: unknown) =>
    fromApp(event) && isLinkCode(code) ? acceptFriendLink(code) : invalid
  )
  ipcMain.handle('auth:friend-link-info', (event, code: unknown) =>
    fromApp(event) && isLinkCode(code) ? friendLinkInfo(code) : null
  )
  ipcMain.handle('links:take', (event) => (fromApp(event) ? takeDeepLink() : null))

  // Privacy settings: only known settings with allowed values get through.
  ipcMain.handle('settings:get', (event) => (fromApp(event) ? getSettings() : invalid))
  ipcMain.handle('settings:set', (event, changes: unknown) => {
    const onOff = ['readReceipts', 'showLastSeen', 'showTyping', 'onlineAlerts', 'showGlows']
    const allowed = (k: string, v: unknown): boolean =>
      onOff.includes(k)
        ? typeof v === 'boolean'
        : k === 'friendRequests'
          ? v === 'everyone' || v === 'nobody'
          : k === 'onlineAlertsMode' && (v === 'all' || v === 'selected' || v === 'none')
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
  // Email: shape only (an @ and a sensible length); the server checks properly.
  const isEmail = (v: unknown): v is string =>
    typeof v === 'string' && v.length >= 3 && v.length <= 254 && v.includes('@')
  ipcMain.handle('account:resend-verification', (event) =>
    fromApp(event) ? resendVerification() : invalid
  )
  ipcMain.handle('account:change-email', (event, newEmail: unknown, password: unknown) =>
    fromApp(event) && isEmail(newEmail) && isPassword(password)
      ? changeEmail(newEmail.trim(), password)
      : invalid
  )
  ipcMain.handle('account:cancel-email-change', (event) =>
    fromApp(event) ? cancelEmailChange() : invalid
  )
  // Where you're signed in. Session ids are UUIDs (checked so nothing else reaches the URL).
  ipcMain.handle('account:sessions', (event) => (fromApp(event) ? listSessions() : invalid))
  ipcMain.handle('account:sign-out-device', (event, sessionId: unknown) =>
    fromApp(event) && isUserId(sessionId) ? signOutDevice(sessionId) : invalid
  )
  ipcMain.handle('account:sign-out-other-devices', (event) =>
    fromApp(event) ? signOutOtherDevices() : invalid
  )

  // Your status.
  ipcMain.handle('status:get', (event) => (fromApp(event) ? getMyStatus() : invalid))
  ipcMain.handle('status:set', (event, changes: unknown) => {
    const c = changes as {
      status?: unknown
      statusText?: unknown
      statusClearAfter?: unknown
      timeZone?: unknown
    } | null
    const choices = ['online', 'away', 'dnd', 'invisible']
    const ok =
      fromApp(event) &&
      typeof c === 'object' &&
      c !== null &&
      (c.status === undefined || (typeof c.status === 'string' && choices.includes(c.status))) &&
      (c.statusText === undefined ||
        c.statusText === null ||
        (typeof c.statusText === 'string' && c.statusText.length <= 200)) &&
      (c.statusClearAfter === undefined || isStatusClearAfter(c.statusClearAfter)) &&
      (c.timeZone === undefined || (typeof c.timeZone === 'string' && c.timeZone.length <= 64))
    if (!ok) return invalid
    return setMyStatus({
      ...(c.status !== undefined ? { status: c.status as 'online' } : {}),
      ...(c.statusText !== undefined ? { statusText: c.statusText as string | null } : {}),
      ...(c.statusClearAfter !== undefined
        ? { statusClearAfter: c.statusClearAfter as StatusClearAfter }
        : {}),
      ...(c.timeZone !== undefined ? { timeZone: c.timeZone as string } : {})
    })
  })

  // Profiles and profile photos.
  const PHOTO_MAX_BYTES = 8 * 1024 * 1024
  const PHOTO_TYPES: PhotoType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  const BIO_MAX = 190
  const PROFILE_KEYS = ['displayName', 'bio', 'pronouns', 'board', 'privacy', 'headerFocus']
  const isProfileChanges = (value: unknown): value is ProfileChanges => {
    const c = value as Record<string, unknown> | null
    if (typeof c !== 'object' || c === null || Array.isArray(c)) return false
    const keys = Object.keys(c)
    return (
      keys.length > 0 &&
      keys.every((k) => PROFILE_KEYS.includes(k)) &&
      // 0.9.1: pronouns, board, privacy, header position (the server checks the details).
      (c.pronouns === undefined || c.pronouns === null || (typeof c.pronouns === 'string' && c.pronouns.length <= 80)) &&
      (c.board === undefined || (Array.isArray(c.board) && c.board.length <= 6 && JSON.stringify(c.board).length <= 8000)) &&
      (c.privacy === undefined || (typeof c.privacy === 'object' && c.privacy !== null && !Array.isArray(c.privacy) && Object.keys(c.privacy).length <= 3)) &&
      (c.headerFocus === undefined || (typeof c.headerFocus === 'number' && c.headerFocus >= 0 && c.headerFocus <= 100)) &&
      (c.displayName === undefined ||
        (typeof c.displayName === 'string' && c.displayName.length <= 64)) &&
      (c.bio === undefined ||
        c.bio === null ||
        (typeof c.bio === 'string' && c.bio.length <= BIO_MAX * 2))
    )
  }
  const isPreviewAs = (v: unknown): v is 'friend' | 'everyone' | undefined =>
    v === undefined || v === null || v === 'friend' || v === 'everyone'
  ipcMain.handle('profile:get-mine', (event, as: unknown) =>
    fromApp(event) && isPreviewAs(as) ? getMyProfile(as ?? undefined) : invalid
  )
  ipcMain.handle('profile:get', (event, userId: unknown) =>
    fromApp(event) && isUserId(userId) ? getProfile(userId) : invalid
  )
  ipcMain.handle('profile:set-nickname', (event, userId: unknown, nickname: unknown) =>
    fromApp(event) &&
    isUserId(userId) &&
    (nickname === null || (typeof nickname === 'string' && nickname.length <= 200))
      ? setNickname(userId, nickname)
      : invalid
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
  // 0.9.1 profiles
  ipcMain.handle('profile:set-header', (event, data: unknown, type: unknown) => {
    if (!fromApp(event) || !(data instanceof ArrayBuffer) || !PHOTO_TYPES.includes(type as PhotoType)) {
      return invalid
    }
    if (data.byteLength === 0 || data.byteLength > PHOTO_MAX_BYTES) {
      return { ok: false, error: 'invalid', message: 'Pictures can be up to 8 MB.' }
    }
    return setHeader(new Uint8Array(data), type as PhotoType)
  })
  ipcMain.handle('profile:remove-header', (event) => (fromApp(event) ? removeHeader() : invalid))
  ipcMain.handle('profile:mutuals', (event, userId: unknown) =>
    fromApp(event) && isUserId(userId) ? getMutuals(userId) : invalid
  )
  ipcMain.handle('profile:activity', (event, userId: unknown, as: unknown) =>
    fromApp(event) && isUserId(userId) && isPreviewAs(as) ? getActivity(userId, as ?? undefined) : invalid
  )

  // Conversations and messages.
  const isMessage = (v: unknown): v is string => typeof v === 'string' && v.length <= 8000
  ipcMain.handle('conversations:list', (event) => (fromApp(event) ? listConversations() : invalid))
  ipcMain.handle('conversations:open-dm', (event, userId: unknown) =>
    fromApp(event) && isUserId(userId) ? openDm(userId) : invalid
  )
  // Group chats: up to 25 people, names up to 50 characters (the server checks the details).
  const isPeople = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length >= 1 && v.length <= 25 && v.every(isUserId)
  const isGroupName = (v: unknown): v is string | null =>
    v === null || (typeof v === 'string' && v.length <= 200)
  ipcMain.handle('conversations:create-group', (event, userIds: unknown, name: unknown) =>
    fromApp(event) && isPeople(userIds) && isGroupName(name) ? createGroup(userIds, name) : invalid
  )
  ipcMain.handle(
    'conversations:set-group-photo',
    (event, id: unknown, data: unknown, type: unknown) => {
      if (
        !fromApp(event) ||
        !isUserId(id) ||
        !(data instanceof ArrayBuffer) ||
        !PHOTO_TYPES.includes(type as PhotoType)
      ) {
        return invalid
      }
      if (data.byteLength === 0 || data.byteLength > PHOTO_MAX_BYTES) {
        return { ok: false, error: 'invalid', message: 'Photos can be up to 8 MB.' }
      }
      return setGroupPhoto(id, new Uint8Array(data), type as PhotoType)
    }
  )
  // 2.0 Constellations and My games: one gateway for their routes (/constellations/…, /games/…),
  // limited to those paths, plain characters and small JSON bodies.
  ipcMain.handle(
    'constellations:request',
    (event, method: unknown, path: unknown, body: unknown) => {
      if (!fromApp(event) || !isConstellationRequest(method, path, body)) return invalid
      return apiRequest(method, path as string, body ?? undefined)
    }
  )
  // Communities round: Settings → Connected apps and Developer (Sign in with Glofly).
  ipcMain.handle('apps:request', (event, method: unknown, path: unknown, body: unknown) => {
    if (!fromApp(event) || !isAppsRequest(method, path, body)) return invalid
    return apiRequest(method as 'GET', path as string, body ?? undefined)
  })
  ipcMain.handle(
    'constellations:set-icon',
    (event, id: unknown, data: unknown, type: unknown, which: unknown = 'icon') => {
      // 0.7.5: the same for the banner photo (which: 'banner').
      if (
        !fromApp(event) ||
        !isUserId(id) ||
        !(data instanceof ArrayBuffer) ||
        !PHOTO_TYPES.includes(type as PhotoType) ||
        (which !== 'icon' && which !== 'banner')
      ) {
        return invalid
      }
      if (data.byteLength === 0 || data.byteLength > PHOTO_MAX_BYTES) {
        return { ok: false, error: 'invalid', message: 'Photos can be up to 8 MB.' }
      }
      return apiRequest('PUT', `/constellations/${id}/${which}`, undefined, {
        data: new Uint8Array(data),
        type: type as PhotoType
      })
    }
  )
  ipcMain.handle('conversations:remove-group-photo', (event, id: unknown) =>
    fromApp(event) && isUserId(id) ? removeGroupPhoto(id) : invalid
  )
  ipcMain.handle('conversations:rename-group', (event, id: unknown, name: unknown) =>
    fromApp(event) && isUserId(id) && isGroupName(name) ? renameGroup(id, name) : invalid
  )
  ipcMain.handle('conversations:add-members', (event, id: unknown, userIds: unknown) =>
    fromApp(event) && isUserId(id) && isPeople(userIds) ? addMembers(id, userIds) : invalid
  )
  ipcMain.handle('conversations:remove-member', (event, id: unknown, userId: unknown) =>
    fromApp(event) && isUserId(id) && isUserId(userId) ? removeMember(id, userId) : invalid
  )
  ipcMain.handle('conversations:messages', (event, id: unknown, before: unknown, thread: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    (before == null || isUserId(before)) &&
    (thread == null || isUserId(thread))
      ? loadMessages(id, before ?? undefined, thread ?? undefined)
      : invalid
  )
  ipcMain.handle('conversations:search', (event, query: unknown, id: unknown, before: unknown) =>
    fromApp(event) &&
    typeof query === 'string' &&
    query.trim().length >= 2 &&
    query.length <= 100 &&
    (id === undefined || isUserId(id)) &&
    (before === undefined || isUserId(before))
      ? searchMessages(query.trim(), id, before)
      : invalid
  )
  const clientIdOf = (v: unknown): string | undefined =>
    typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined
  const isAttachmentIds = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length <= 10 && v.every(isUserId)
  ipcMain.handle(
    'conversations:send',
    (
      event,
      id: unknown,
      body: unknown,
      replyTo: unknown,
      attachmentIds: unknown,
      options: unknown
    ) =>
      fromApp(event) &&
      isUserId(id) &&
      isMessage(body) &&
      (replyTo == null || isUserId(replyTo)) &&
      (attachmentIds == null || isAttachmentIds(attachmentIds))
        ? sendMessage(id, body, replyTo ?? undefined, attachmentIds ?? undefined, {
            lantern: (options as { lantern?: unknown } | null)?.lantern === true,
            clientId: clientIdOf((options as { clientId?: unknown } | null)?.clientId),
            // Communities round: a reply in a thread (maybe also shown in the nebula)
            ...(isUserId((options as { threadId?: unknown } | null)?.threadId)
              ? {
                  threadId: (options as { threadId: string }).threadId,
                  alsoInNebula: (options as { alsoInNebula?: unknown }).alsoInNebula === true
                }
              : {})
          })
        : invalid
  )

  // 0.5.0 social extras, stickers and broadcasts (each checks its own values in social.ts).
  ipcMain.handle('social:get', (event) => (fromApp(event) ? social.getSocial() : invalid))
  ipcMain.handle('social:hang', (event, ids: unknown) =>
    fromApp(event) ? social.hang(ids) : invalid
  )
  ipcMain.handle('social:stop-hang', (event) => (fromApp(event) ? social.stopHang() : invalid))
  ipcMain.handle('social:birthday', (event, share: unknown) =>
    fromApp(event) ? social.shareBirthday(share) : invalid
  )
  ipcMain.handle('social:year', (event) => (fromApp(event) ? social.year() : invalid))
  ipcMain.handle('stickers:list', (event) => (fromApp(event) ? social.listStickers() : invalid))
  ipcMain.handle('stickers:make', (event, data: unknown) =>
    fromApp(event) ? social.makeSticker(data) : invalid
  )
  ipcMain.handle('stickers:remove', (event, id: unknown) =>
    fromApp(event) ? social.removeSticker(id) : invalid
  )
  ipcMain.handle('stickers:send', (event, id: unknown, chat: unknown, replyTo: unknown) =>
    fromApp(event) ? social.sendSticker(id, chat, replyTo) : invalid
  )
  ipcMain.handle('broadcasts:start', (event, title: unknown, notify: unknown) =>
    fromApp(event) ? social.startBroadcast(title, notify ?? true) : invalid
  )
  ipcMain.handle('broadcasts:stop', (event) => (fromApp(event) ? social.stopBroadcast() : invalid))
  ipcMain.handle('broadcasts:mine', (event) => (fromApp(event) ? social.myBroadcast() : invalid))
  ipcMain.handle('broadcasts:watch', (event, userId: unknown) =>
    fromApp(event) ? social.watchBroadcast(userId) : invalid
  )

  // 0.5.0 chat extras (each checks its own values in chatExtras.ts).
  ipcMain.handle('chat:gifs', (event, q: unknown, offset: unknown) =>
    fromApp(event) ? extras.gifs(q, offset) : invalid
  )
  ipcMain.handle('chat:send-gif', (event, id: unknown, gif: unknown, replyTo: unknown) =>
    fromApp(event) ? extras.sendGif(id, gif, replyTo) : invalid
  )
  ipcMain.handle('chat:remove-preview', (event, id: unknown, mid: unknown) =>
    fromApp(event) ? extras.removePreview(id, mid) : invalid
  )
  ipcMain.handle(
    'chat:create-poll',
    (event, id: unknown, question: unknown, options: unknown, multi: unknown) =>
      fromApp(event) ? extras.createPoll(id, question, options, multi) : invalid
  )
  ipcMain.handle('chat:vote', (event, id: unknown, mid: unknown, options: unknown) =>
    fromApp(event) ? extras.vote(id, mid, options) : invalid
  )
  ipcMain.handle('chat:close-poll', (event, id: unknown, mid: unknown) =>
    fromApp(event) ? extras.closePoll(id, mid) : invalid
  )
  ipcMain.handle('chat:start-game', (event, id: unknown, kind: unknown) =>
    fromApp(event) ? extras.startGame(id, kind) : invalid
  )
  ipcMain.handle('chat:move', (event, id: unknown, mid: unknown, move: unknown) =>
    fromApp(event) ? extras.move(id, mid, move) : invalid
  )
  ipcMain.handle('chat:fireflies', (event, id: unknown, emoji: unknown) =>
    fromApp(event) ? extras.fireflies(id, emoji) : invalid
  )

  // Photos and files in chats.
  const FILE_MAX_BYTES = 25 * 1024 * 1024
  const VOICE_MAX_BYTES = 6 * 1024 * 1024
  /** A voice message's length (up to 5 minutes) and waveform (up to 64 bars, 0–100). */
  const isVoiceInfo = (v: unknown): v is VoiceInfo => {
    const x = v as Partial<VoiceInfo> | null
    return (
      typeof x === 'object' &&
      x !== null &&
      typeof x.durationMs === 'number' &&
      Number.isFinite(x.durationMs) &&
      x.durationMs >= 200 &&
      x.durationMs <= 305_000 &&
      Array.isArray(x.peaks) &&
      x.peaks.length >= 1 &&
      x.peaks.length <= 64 &&
      x.peaks.every((p) => Number.isInteger(p) && p >= 0 && p <= 100)
    )
  }
  ipcMain.handle(
    'conversations:upload',
    (event, id: unknown, data: unknown, name: unknown, voice: unknown) => {
      if (
        !fromApp(event) ||
        !isUserId(id) ||
        !(data instanceof ArrayBuffer) ||
        typeof name !== 'string' ||
        name.length > 1000 ||
        (voice !== undefined && !isVoiceInfo(voice))
      ) {
        return invalid
      }
      if (data.byteLength === 0)
        return { ok: false, error: 'invalid', message: 'That file is empty.' }
      // Videos (0.5.0) may be bigger; the server checks they really are videos.
      if (data.byteLength > (looksLikeVideo(name) ? VIDEO_MAX_BYTES : FILE_MAX_BYTES)) {
        return {
          ok: false,
          error: 'invalid',
          message: looksLikeVideo(name)
            ? 'Videos can be up to 64 MB.'
            : 'Files can be up to 25 MB (videos up to 64 MB).'
        }
      }
      if (voice && data.byteLength > VOICE_MAX_BYTES) {
        return { ok: false, error: 'invalid', message: 'Voice messages can be up to 5 minutes.' }
      }
      return uploadAttachment(id, new Uint8Array(data), name, voice as VoiceInfo | undefined)
    }
  )
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
  // 0.9.3: forwarding (the server checks every place; this only checks the shape).
  ipcMain.handle('conversations:forward', (event, id: unknown, to: unknown, note: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    Array.isArray(to) &&
    to.length >= 1 &&
    to.length <= 5 &&
    to.every(isUserId) &&
    typeof note === 'string' &&
    note.length <= 4200
      ? forwardMessage(id, to as string[], note)
      : invalid
  )
  ipcMain.handle('conversations:forwardTargets', (event) =>
    fromApp(event) ? forwardTargets() : invalid
  )
  ipcMain.handle('conversations:pin', (event, id: unknown, pinned: unknown) =>
    fromApp(event) && isUserId(id) && typeof pinned === 'boolean'
      ? pinConversation(id, pinned)
      : invalid
  )
  ipcMain.handle('conversations:orderGroups', (event, ids: unknown) =>
    fromApp(event) &&
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= 1000 &&
    ids.every(isUserId)
      ? orderGroups(ids)
      : invalid
  )
  ipcMain.handle('conversations:orderPins', (event, ids: unknown) =>
    fromApp(event) &&
    Array.isArray(ids) &&
    ids.length > 0 &&
    ids.length <= 50 &&
    ids.every(isUserId)
      ? orderPins(ids)
      : invalid
  )
  ipcMain.handle('conversations:mute', (event, id: unknown, duration: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    (duration === null || ['1h', '8h', '24h', 'forever'].includes(duration as string))
      ? muteConversation(id, duration as MuteDuration | null)
      : invalid
  )
  ipcMain.handle('conversations:close', (event, id: unknown, closed: unknown) =>
    fromApp(event) && isUserId(id) && typeof closed === 'boolean'
      ? closeConversation(id, closed)
      : invalid
  )
  ipcMain.on('conversations:typing', (event, id: unknown) => {
    if (isAppUrl(event.senderFrame?.url ?? '') && isUserId(id)) sendTyping(id)
  })

  // Calls.
  ipcMain.handle('calls:start', (event, id: unknown, video: unknown, ring: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    typeof video === 'boolean' &&
    (ring === undefined || isPeople(ring))
      ? startCall(id, video, ring)
      : invalid
  )
  ipcMain.handle('calls:active', (event) => (fromApp(event) ? activeCalls() : invalid))
  const byCallId: [string, (id: string) => Promise<unknown>][] = [
    ['calls:answer', answerCall],
    ['calls:join', joinCall],
    ['calls:decline', declineCall],
    ['calls:stay', stayInCall],
    ['calls:leave', leaveCall]
  ]
  for (const [channel, action] of byCallId) {
    ipcMain.handle(channel, (event, id: unknown) =>
      fromApp(event) && isUserId(id) ? action(id) : invalid
    )
  }
  ipcMain.handle('calls:ring', (event, id: unknown, userIds: unknown) =>
    fromApp(event) && isUserId(id) && isPeople(userIds) ? ringPeople(id, userIds) : invalid
  )
  ipcMain.handle('calls:add', (event, id: unknown, userIds: unknown) =>
    fromApp(event) && isUserId(id) && isPeople(userIds) ? addToCall(id, userIds) : invalid
  )
  // Watch Together (0.5.0). Only well-formed values reach the server.
  const isWatchControl = (v: unknown): v is 'everyone' | 'starter' =>
    v === 'everyone' || v === 'starter'
  const isLink = (v: unknown): v is string =>
    typeof v === 'string' && v.length > 0 && v.length <= 500
  const isSeconds = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 48 * 3600
  ipcMain.handle('watch:player-url', (event) => (fromApp(event) ? watchPlayerUrl() : null))
  ipcMain.handle('watch:get', (event, id: unknown) =>
    fromApp(event) && isUserId(id) ? watchGet(id) : invalid
  )
  ipcMain.handle('watch:preview', (event, link: unknown) =>
    fromApp(event) && isLink(link) ? watchPreview(link) : invalid
  )
  ipcMain.handle('watch:start', (event, id: unknown, link: unknown, control: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    isLink(link) &&
    (control === undefined || isWatchControl(control))
      ? watchStart(id, link, control)
      : invalid
  )
  ipcMain.handle('watch:control', (event, id: unknown, action: unknown, to: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    (action === 'play' ||
      action === 'pause' ||
      action === 'seek' ||
      action === 'back' ||
      action === 'forward') &&
    (to === undefined || isSeconds(to))
      ? watchControl(id, action, to)
      : invalid
  )
  ipcMain.handle('watch:settings', (event, id: unknown, control: unknown) =>
    fromApp(event) && isUserId(id) && isWatchControl(control) ? watchSettings(id, control) : invalid
  )
  ipcMain.handle(
    'watch:report',
    (event, id: unknown, videoId: unknown, duration: unknown, title: unknown) =>
      fromApp(event) &&
      isUserId(id) &&
      typeof videoId === 'string' &&
      /^[A-Za-z0-9_:-]{4,40}$/.test(videoId) &&
      isSeconds(duration) &&
      (title === undefined || (typeof title === 'string' && title.length <= 300))
        ? watchReport(id, videoId, duration, title)
        : invalid
  )
  ipcMain.handle('watch:react', (event, id: unknown, reaction: unknown) =>
    fromApp(event) && isUserId(id) && isWatchReaction(reaction) ? watchReact(id, reaction) : invalid
  )
  ipcMain.handle('watch:stop', (event, id: unknown) =>
    fromApp(event) && isUserId(id) ? watchStop(id) : invalid
  )
  ipcMain.handle('calls:screen-sources', (event) => (fromApp(event) ? screenSources() : []))
  // Mac: is Screen Recording allowed, and opening System Settings at the right place.
  ipcMain.handle('calls:screen-access', (event) => (fromApp(event) ? macScreenAccess() : 'unknown'))
  ipcMain.on('app:open-privacy-settings', (event, pane: unknown) => {
    if (isAppUrl(event.senderFrame?.url ?? '') && isPrivacyPane(pane)) openMacPrivacySettings(pane)
  })
  // 0.5.0: the sound that goes with a shared screen or window (screenSound/index.ts).
  ipcMain.handle('screen-sound:support', (event) =>
    fromApp(event) ? screenSoundSupport() : 'none'
  )
  ipcMain.handle('screen-sound:start', (event, sourceId: unknown) =>
    fromApp(event) &&
    typeof sourceId === 'string' &&
    /^(screen|window):[\w:-]{1,100}$/.test(sourceId)
      ? startScreenSound(event.sender, sourceId)
      : { ok: false }
  )
  ipcMain.handle('screen-sound:stop', (event) => {
    if (fromApp(event)) stopScreenSound(event.sender)
  })
  ipcMain.handle('calls:choose-screen', (event, sourceId: unknown, sound: unknown) =>
    fromApp(event) &&
    typeof sourceId === 'string' &&
    /^(screen|window):[\w:-]{1,100}$/.test(sourceId)
      ? chooseScreen(sourceId, sound === true)
      : false
  )

  // Push to talk: listen for the chosen key while in a call (works with a game in front).
  ipcMain.handle('ptt:start', (event, choice: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return fromApp(event) && window && isPttBinding(choice)
      ? startPtt(window, choice)
      : 'unavailable'
  })
  ipcMain.on('ptt:stop', (event) => {
    if (isAppUrl(event.senderFrame?.url ?? '')) stopPtt()
  })

  // Windows notifications and the taskbar badge (the window decides when and what).
  ipcMain.on('notifications:show', (event, notification: unknown) => {
    if (isAppUrl(event.senderFrame?.url ?? '') && isShowNotification(notification)) {
      // In game with the overlay showing: a pop-up there instead of a Windows notification.
      if (!overlayNotification(notification)) showNotification(notification, icon)
    }
  })
  // Oct 30, 2026: Settings' "Send a test" and the first sign-in on a Mac (see notifications.ts).
  ipcMain.handle('notifications:test', (event, welcome: unknown) =>
    fromApp(event) ? showTestNotification(icon, welcome === true) : false
  )
  ipcMain.on('notifications:open-settings', (event) => {
    if (isAppUrl(event.senderFrame?.url ?? '')) openNotificationSettings()
  })
  ipcMain.on('notifications:clear', (event, key: unknown) => {
    if (isAppUrl(event.senderFrame?.url ?? '') && typeof key === 'string' && key.length <= 60) {
      clearNotification(key)
      overlayClear(key)
    }
  })
  ipcMain.on('notifications:badge', (event, count: unknown, image: unknown) => {
    if (!isAppUrl(event.senderFrame?.url ?? '') || typeof count !== 'number') return
    setBadge(BrowserWindow.fromWebContents(event.sender), count, image)
  })

  // An incoming call: show Glofly if it's tucked away in the tray, and flash the taskbar button
  // (without taking focus away from whatever you're doing).
  // "Playing …": Settings → Activity. Every value from the window is checked first.
  ipcMain.handle('games:state', (event) => (fromApp(event) ? gameState() : null))
  ipcMain.handle('games:set-enabled', (event, enabled: unknown) =>
    fromApp(event) && typeof enabled === 'boolean' ? setGamesEnabled(enabled) : null
  )
  ipcMain.handle('games:hide', (event, name: unknown, hide: unknown) => {
    const clean = cleanGameName(name)
    return fromApp(event) && clean && typeof hide === 'boolean' ? hideGame(clean, hide) : null
  })
  ipcMain.handle('games:add', (event, exe: unknown, name: unknown) => {
    const clean = cleanGameName(name)
    return fromApp(event) && isExe(exe) && clean ? addGame(exe, clean) : null
  })
  ipcMain.handle('games:remove', (event, exe: unknown) =>
    fromApp(event) && isExe(exe) ? removeGame(exe) : null
  )
  ipcMain.handle('games:running', (event) => (fromApp(event) ? runningPrograms() : []))
  ipcMain.on('games:notice-shown', (event) => {
    if (isAppUrl(event.senderFrame?.url ?? '')) markNoticeShown()
  })

  // Auto-updates: is a new version downloaded and waiting, and "Restart to update".
  ipcMain.handle('updates:status', (event) => (fromApp(event) ? updateReady() : null))
  ipcMain.handle('updates:check-now', (event) => (fromApp(event) ? checkNow() : 'unavailable'))
  ipcMain.handle('app:update-required', (event) => (fromApp(event) ? getUpdateRequired() : null))
  // "Glofly is paused" (0.4.0): is it, and "Try again" (asks the server now).
  ipcMain.handle('app:paused', (event) => (fromApp(event) ? getPaused() : null))
  ipcMain.handle('app:check-paused', (event) => (fromApp(event) ? checkPausedNow() : null))
  ipcMain.handle('reports:send', (event, report: unknown) =>
    fromApp(event) && isReportRequest(report) ? sendReport(report) : invalid
  )
  ipcMain.handle('notices:list', (event) => (fromApp(event) ? listNotices() : invalid))
  ipcMain.handle('notices:seen', (event, id: unknown) =>
    fromApp(event) && isUserId(id) ? noticeSeen(id) : invalid
  )
  ipcMain.handle('notices:reply', (event, id: unknown, body: unknown) =>
    fromApp(event) &&
    isUserId(id) &&
    typeof body === 'string' &&
    body.trim() &&
    body.length <= TEAM_REPLY_MAX
      ? noticeReply(id, body.trim())
      : invalid
  )
  ipcMain.on('updates:restart', (event) => {
    if (!isAppUrl(event.senderFrame?.url ?? '')) return
    restartToUpdate()
  })

  ipcMain.on('window:attention', (event) => {
    if (!isAppUrl(event.senderFrame?.url ?? '')) return
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (!window.isVisible()) window.showInactive()
    if (!window.isFocused()) window.flashFrame(true)
  })

  ipcMain.handle('auth:restore', (event) => {
    if (!fromApp(event)) return null
    return thenGoLive(restore())
  })

  // Who am I now (0.4.0: after Control turns "Restricted" on or off). Null if it can't tell.
  ipcMain.handle('auth:me', async (event) => {
    if (!fromApp(event)) return null
    const result = await apiRequest<{ user: SignedInUser }>('GET', '/auth/me')
    return result.ok ? result.data.user : null
  })

  ipcMain.handle('auth:login', (event, request: unknown) => {
    if (!fromApp(event) || !isLoginRequest(request)) {
      return { ok: false, reason: 'invalid', message: 'Check your details.' }
    }
    return thenGoLive(login(request))
  })

  // 0.7.3 two-step sign-in and QR code sign-in.
  const isChallenge = (v: unknown): v is string =>
    typeof v === 'string' && /^[A-Za-z0-9_-]{32}$/.test(v)
  ipcMain.handle('auth:login-code', (event, challenge: unknown, code: unknown) => {
    if (!fromApp(event) || !isChallenge(challenge) || typeof code !== 'string' || code.length > 20)
      return { ok: false, reason: 'invalid', message: 'Enter the code.' }
    return thenGoLive(loginCode(challenge, code))
  })
  ipcMain.handle('auth:login-resend', (event, challenge: unknown, method: unknown) => {
    if (!fromApp(event) || !isChallenge(challenge)) return invalid
    return loginResend(challenge, method === 'sms' || method === 'email' ? method : undefined)
  })
  ipcMain.handle('auth:qr-start', (event, keep: unknown) =>
    fromApp(event) ? qrStart(keep !== false) : invalid
  )
  ipcMain.handle('auth:qr-poll', (event, id: unknown, secret: unknown) => {
    if (
      !fromApp(event) ||
      typeof id !== 'string' ||
      !/^[A-Za-z0-9_-]{22}$/.test(id) ||
      typeof secret !== 'string' ||
      secret.length > 100
    )
      return { state: 'expired' }
    return thenGoLive(qrPoll(id, secret))
  })
  // 0.7.3: two-step settings, quiet hours, pins, mark unread, send later.
  // Jump List / Dock menu: the action waiting for the window (see shortcuts.ts).
  ipcMain.handle('shortcuts:take', (event) =>
    isAppUrl(event.senderFrame?.url ?? '') ? takePendingShortcut() : null
  )
  ipcMain.handle('tools:request', (event, method: unknown, path: unknown, body: unknown) => {
    if (!fromApp(event) || !isToolsRequest(method, path, body)) return invalid
    return apiRequest(method, path as string, body ?? undefined)
  })
  // 0.7.3 error reports.
  ipcMain.on('errors:report', (event, report: unknown) => {
    const r = report as Record<string, unknown> | null
    if (!fromApp(event) || !r || typeof r.message !== 'string') return
    reportError({
      message: r.message,
      stack: typeof r.stack === 'string' ? r.stack : undefined,
      where: typeof r.where === 'string' ? r.where : undefined,
      os: typeof r.os === 'string' ? r.os : undefined
    })
  })
  ipcMain.on('errors:enabled', (event, on: unknown) => {
    if (fromApp(event)) setErrorReports(on !== false)
  })

  ipcMain.handle('auth:forgot-password', (event, identifier: unknown) => {
    if (
      !fromApp(event) ||
      typeof identifier !== 'string' ||
      !identifier.trim() ||
      identifier.length > 254
    ) {
      return { ok: false, message: 'Enter your username or email.' }
    }
    return forgotPassword(identifier.trim())
  })

  ipcMain.handle('auth:logout', (event) => {
    if (!fromApp(event)) return
    disconnectRealtime()
    overlaySignedOut()
    clearAllNotifications()
    setBadge(BrowserWindow.fromWebContents(event.sender), 0, null)
    return logout()
  })
}

watchMainErrors()
watchProcessCrashes()

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.glofly.app')

  // F12 opens DevTools in development; reload shortcuts are disabled in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
  setUpMacMenu()
  setUpPermissions()
  loadAppSettings()
  configurePauseChecks(API_URL)
  registerIpcHandlers()
  // 0.9.3: presses on Glofly's Windows notifications (also from Action Center after a restart).
  listenToNotificationPresses()
  startIdleWatch()
  // 0.8.6: the updater window checks for a new version first (and installs it) before Glofly
  // opens. When nothing's new, or it can't check, it hands over to openGlofly.
  void updateOnLaunch(openGlofly)
})

/** Opens Glofly's window and starts everything that goes with it (once). */
let opened = false
function openGlofly(): BrowserWindow | null {
  if (opened) return mainWindow
  opened = true
  createWindow()
  setUpTray(() => mainWindow, isMac ? menuBarIcon : icon)
  setupShortcuts()
  startAutoUpdates()
  startGameWatch(shareActivity)
  // 0.7.0 game overlay (Windows): the same app page as the main window, opened with #overlay.
  startOverlay({
    preload: join(__dirname, '../preload/index.js'),
    load: (window) => {
      if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
        void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#overlay`)
      } else {
        void window.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'overlay' })
      }
    },
    mainWindow: () => mainWindow,
    signedIn: () => !!getSessionToken(),
    isAppUrl
  })

  // Light ↔ dark (picked in Settings, or Windows changed with "Match system"):
  // the page follows by itself; the window background and buttons follow here.
  nativeTheme.on('updated', () => {
    sendAppearance()
    for (const window of BrowserWindow.getAllWindows()) {
      if (isOverlayWindow(window)) continue // see-through, no title bar
      window.setBackgroundColor(isDark() ? '#1E1916' : '#FFFBF7')
      if (customTitleBar) {
        window.setTitleBarOverlay(titleBarOf(window))
      }
    }
  })

  app.on('activate', function () {
    // macOS: clicking the Dock icon brings the window back (closing it only hid it).
    if (mainWindow) showWindow()
    else createWindow()
  })
  return mainWindow
}

// The push-to-talk keyboard hook never outlives Glofly.
app.on('will-quit', () => stopPtt())

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

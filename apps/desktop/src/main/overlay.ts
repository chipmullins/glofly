import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle
} from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  OverlayCommand,
  OverlayInfo,
  OverlaySettings,
  OverlayState,
  OverlayToast,
  OverlayVoice,
  ShowNotification
} from '../preload/api-types'
import {
  cleanGameName,
  checkGamesNow,
  isRunningGameExe,
  runningGame,
  watchRunningGame
} from './games'

// 0.7.0 Game overlay (Windows): Glofly on top of the game you're playing.
//
// It's a see-through, always-on-top window over the game's screen. While it's closed it never
// takes a click or a key (everything goes to the game) and only shows the voice widget, pop-ups
// and a pinned chat. The open key (Shift + ` by default) makes it a normal window you can click
// and type in; Esc or the key again hands focus back to the game.
//
// It only appears while a game Glofly recognises (games.ts) is the window in front. Games in
// exclusive full screen draw over every other window, so there it can't show: Settings says to
// use borderless / windowed full screen. Glofly never loads anything into a game (that's what
// anti-cheat looks for).
//
// The overlay is the same app page as the main window, opened with #overlay (OverlayApp.tsx),
// so it signs in the same way and gets the same live events. Voice comes from the main window
// (it's where the call runs): it sends a small snapshot here, and buttons in the overlay are
// sent back to it as commands.

const supported = process.platform === 'win32'

/** The keys you can pick (Electron accelerators). Few, so none of them is a common game key. */
const OPEN_KEYS = ['Shift+`', 'Ctrl+`', 'Alt+`', 'Shift+F1', 'Ctrl+Shift+G']
const MUTE_KEYS = ['Shift+M', 'Ctrl+Shift+M', 'Alt+M', 'Shift+F2']
const VOICE_STYLES = ['full', 'photos', 'talking', 'off'] as const
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
const POPUPS = ['messages', 'calls', 'constellations', 'friends'] as const

/** Checking which window is in front, while a game is running. */
const POLL_MS = 750
/** "Try it" in Settings shows the overlay over Glofly for this long. */
const PREVIEW_MS = 45_000
/** Programs that can be full screen while a game runs but are never the game. */
const NEVER_GAMES = new Set([
  'explorer.exe',
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'opera.exe',
  'brave.exe',
  'vlc.exe',
  'glofly.exe',
  'electron.exe',
  'steamwebhelper.exe',
  'steam.exe',
  'obs64.exe',
  'discord.exe'
])

type Saved = OverlaySettings & { seenGames: string[] }

const saved: Saved = {
  enabled: true,
  openKey: 'Shift+`',
  muteKey: 'Shift+M',
  voice: 'full',
  corner: 'top-left',
  opacity: 78,
  popups: { messages: true, calls: true, constellations: true, friends: false },
  offGames: [],
  pinnedChat: null,
  seenGames: []
}

const file = (): string => join(app.getPath('userData'), 'overlay.json')

const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/** Checks changes (from Settings or the saved file) and applies the good ones. */
function apply(changes: Record<string, unknown>): boolean {
  let ok = true
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'enabled' && typeof v === 'boolean') saved.enabled = v
    else if (k === 'openKey' && OPEN_KEYS.includes(v as string)) saved.openKey = v as string
    else if (k === 'muteKey' && (v === null || MUTE_KEYS.includes(v as string)))
      saved.muteKey = v as string | null
    else if (k === 'voice' && VOICE_STYLES.includes(v as (typeof VOICE_STYLES)[number]))
      saved.voice = v as OverlaySettings['voice']
    else if (k === 'corner' && CORNERS.includes(v as (typeof CORNERS)[number]))
      saved.corner = v as OverlaySettings['corner']
    else if (k === 'opacity' && typeof v === 'number' && Number.isInteger(v) && v >= 40 && v <= 100)
      saved.opacity = v
    else if (k === 'popups' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
      for (const [p, on] of Object.entries(v)) {
        if (POPUPS.includes(p as (typeof POPUPS)[number]) && typeof on === 'boolean')
          saved.popups[p as (typeof POPUPS)[number]] = on
        else ok = false
      }
    } else if (k === 'offGames' && Array.isArray(v) && v.length <= 200) {
      saved.offGames = v.map(cleanGameName).filter((n): n is string => !!n)
    } else if (k === 'pinnedChat' && (v === null || isId(v))) saved.pinnedChat = v as string | null
    else if (k === 'seenGames' && Array.isArray(v)) {
      saved.seenGames = v
        .map(cleanGameName)
        .filter((n): n is string => !!n)
        .slice(0, 30)
    } else ok = false
  }
  return ok
}

function load(): void {
  try {
    const v = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, unknown>
    if (v && typeof v === 'object') {
      // Each setting on its own: one bad value doesn't lose the rest.
      for (const [k, value] of Object.entries(v)) apply({ [k]: value })
    }
  } catch {
    // First run (or an unreadable file): defaults.
  }
}

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify(saved, null, 2))
  } catch (err) {
    console.error("Couldn't save the overlay settings", err)
  }
}

function settings(): OverlaySettings {
  const { enabled, openKey, muteKey, voice, corner, opacity, popups, offGames, pinnedChat } = saved
  return {
    enabled,
    openKey,
    muteKey,
    voice,
    corner,
    opacity,
    popups: { ...popups },
    offGames: [...offGames],
    pinnedChat
  }
}

function info(): OverlayInfo {
  const playing = runningGame()
  const games = [...new Set([...(playing ? [playing] : []), ...saved.seenGames, ...saved.offGames])]
  return {
    supported,
    settings: settings(),
    games,
    keys: { open: OPEN_KEYS, mute: MUTE_KEYS }
  }
}

// ---- Windows: which window is in front ----------------------------------------------

type Native = {
  foreground: () => number
  pidOf: (hwnd: number) => number
  exeOf: (pid: number) => string | null
  rectOf: (hwnd: number) => Rectangle | null
  focus: (hwnd: number) => void
}
let native: Native | null | undefined

function loadNative(): Native | null {
  if (native !== undefined) return native
  native = null
  if (!supported) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const kernel32 = koffi.load('kernel32.dll')
    koffi.struct('GloflyOverlayRect', {
      left: 'int32_t',
      top: 'int32_t',
      right: 'int32_t',
      bottom: 'int32_t'
    })
    const getForeground = user32.func('intptr_t __stdcall GetForegroundWindow()')
    const getPid = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
    )
    const getRect = user32.func(
      'bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ GloflyOverlayRect *lpRect)'
    )
    const setForeground = user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)')
    const openProcess = kernel32.func(
      'intptr_t __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'
    )
    const closeHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t hObject)')
    const imageName = kernel32.func(
      'bool __stdcall QueryFullProcessImageNameW(intptr_t hProcess, uint32_t dwFlags, void *lpExeName, _Inout_ uint32_t *lpdwSize)'
    )
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    native = {
      foreground: () => Number(getForeground()),
      pidOf: (hwnd) => {
        const out = [0]
        getPid(hwnd, out)
        return out[0] ?? 0
      },
      exeOf: (pid) => {
        const handle = Number(openProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid))
        if (!handle) return null
        try {
          const buf = Buffer.alloc(1040)
          const size = [520]
          if (!imageName(handle, 0, buf, size)) return null
          const path = buf.toString('utf16le', 0, (size[0] ?? 0) * 2)
          return path.split('\\').pop()?.toLowerCase() || null
        } finally {
          closeHandle(handle)
        }
      },
      rectOf: (hwnd) => {
        const r = {} as { left: number; top: number; right: number; bottom: number }
        if (!getRect(hwnd, r)) return null
        return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }
      },
      focus: (hwnd) => void setForeground(hwnd)
    }
  } catch (err) {
    console.warn('[overlay] window checks are unavailable', err)
    native = null
  }
  return native
}

// ---- The overlay window -------------------------------------------------------------

type Deps = {
  preload: string
  /** Loads the app page with #overlay */
  load: (window: BrowserWindow) => void
  mainWindow: () => BrowserWindow | null
  signedIn: () => boolean
  /** The page is the Glofly app (for checking who sent an IPC message) */
  isAppUrl: (url: string) => boolean
}
let deps: Deps | null = null

let win: BrowserWindow | null = null
let visible = false
let open = false
let preview = false
let previewTimer: ReturnType<typeof setTimeout> | null = null
let poller: ReturnType<typeof setInterval> | null = null
/** The game's window (to hand focus back when the overlay closes, and to share it) */
let gameHwnd = 0
let voice: OverlayVoice | null = null
let keys: string[] = []

const alive = (w: BrowserWindow | null): w is BrowserWindow => !!w && !w.isDestroyed()

/** The overlay's window (it keeps a see-through background and has no title bar). */
export const isOverlayWindow = (w: BrowserWindow): boolean => w === win

function handleOf(w: BrowserWindow): number {
  try {
    const buf = w.getNativeWindowHandle()
    return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0)
  } catch {
    return 0
  }
}

function ensureWindow(): BrowserWindow | null {
  if (alive(win)) return win
  if (!deps) return null
  const w = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    title: 'Glofly overlay',
    webPreferences: { preload: deps.preload, sandbox: true, backgroundThrottling: false }
  })
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setIgnoreMouseEvents(true)
  // Links in a chat open in the real browser (https only); the overlay never navigates.
  w.webContents.setWindowOpenHandler((details) => {
    if (details.url.startsWith('https://')) void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (event) => event.preventDefault())
  w.webContents.on('did-finish-load', () => {
    w.webContents.setZoomFactor(1)
    sendState()
    send('overlay:voice', voice)
  })
  w.on('closed', () => {
    if (win === w) {
      win = null
      visible = false
      open = false
      setKeys()
    }
  })
  win = w
  deps.load(w)
  return w
}

function send(channel: string, payload: unknown): void {
  if (alive(win)) win.webContents.send(channel, payload)
}

function state(): OverlayState {
  return { visible, open, preview, game: preview ? null : runningGame() }
}

function sendState(): void {
  send('overlay:state', state())
}

function toMain(command: OverlayCommand): void {
  const main = deps?.mainWindow() ?? null
  if (alive(main)) main.webContents.send('overlay:command', command)
}

/** Shows the overlay (closed) over this part of the screen (physical pixels), or the main screen. */
function showOver(rect: Rectangle | null): void {
  const w = ensureWindow()
  if (!w) return
  let display = screen.getPrimaryDisplay()
  try {
    if (rect) display = screen.getDisplayMatching(screen.screenToDipRect(null, rect))
  } catch {
    // Keep the main screen.
  }
  const b = display.bounds
  const now = w.getBounds()
  if (now.x !== b.x || now.y !== b.y || now.width !== b.width || now.height !== b.height) {
    w.setBounds(b)
  }
  if (!visible) {
    visible = true
    w.showInactive()
    w.setAlwaysOnTop(true, 'screen-saver')
    setKeys()
    sendState()
  }
}

function hide(): void {
  if (!visible) return
  if (open) closeOverlay(false)
  visible = false
  if (alive(win)) win.hide()
  setKeys()
  sendState()
}

function openOverlay(): void {
  if (!visible || open || !alive(win)) return
  open = true
  win.setIgnoreMouseEvents(false)
  win.setFocusable(true)
  win.show()
  win.focus()
  sendState()
}

function closeOverlay(giveBack = true): void {
  if (!open || !alive(win)) return
  open = false
  win.setIgnoreMouseEvents(true)
  win.setFocusable(false)
  win.blur()
  if (giveBack) {
    if (preview) deps?.mainWindow()?.focus()
    else if (gameHwnd) loadNative()?.focus(gameHwnd)
  }
  sendState()
}

const toggle = (): void => (open ? closeOverlay() : openOverlay())

/** The global keys, only while the overlay is showing (so they're never taken from other apps). */
function setKeys(): void {
  const want: [string, () => void][] = []
  if (visible && saved.enabled) {
    want.push([saved.openKey, toggle])
    if (saved.muteKey && voice?.connected) want.push([saved.muteKey, () => toMain({ cmd: 'mute' })])
  }
  const next = want.map(([k]) => k)
  if (next.join('|') === keys.join('|')) return
  for (const k of keys) globalShortcut.unregister(k)
  keys = []
  for (const [k, run] of want) {
    try {
      if (globalShortcut.register(k, run)) keys.push(k)
      else console.warn(`[overlay] ${k} is taken by another app`)
    } catch (err) {
      console.warn(`[overlay] couldn't use ${k}`, err)
    }
  }
}

/** Is the window in front the game? Shows or hides the overlay to match. */
function poll(): void {
  if (preview) return
  const n = loadNative()
  const game = runningGame()
  if (!n || !game || !saved.enabled || !deps?.signedIn() || saved.offGames.includes(game))
    return hide()
  const hwnd = n.foreground()
  if (!hwnd) return
  // The overlay itself (open, being typed in): leave it be.
  if (alive(win) && hwnd === handleOf(win)) return
  const pid = n.pidOf(hwnd)
  const own = new Set(app.getAppMetrics().map((m) => m.pid))
  if (own.has(pid)) return hide()
  const exe = n.exeOf(pid)
  const rect = n.rectOf(hwnd)
  let isGame = !!exe && isRunningGameExe(exe)
  if (!isGame && exe && !NEVER_GAMES.has(exe) && rect) {
    // A game Glofly only knows from Steam (no program name): a window covering a whole screen.
    try {
      const d = screen.getDisplayMatching(screen.screenToDipRect(null, rect))
      const full = screen.dipToScreenRect(null, d.bounds)
      isGame =
        rect.x <= full.x &&
        rect.y <= full.y &&
        rect.width >= full.width &&
        rect.height >= full.height
    } catch {
      isGame = false
    }
  }
  // Something else came to the front (Alt+Tab): the overlay goes, open or not.
  if (!isGame) return hide()
  gameHwnd = hwnd
  showOver(rect)
}

function startPolling(): void {
  if (poller || !supported) return
  poller = setInterval(poll, POLL_MS)
  poll()
}

function stopPolling(): void {
  if (poller) clearInterval(poller)
  poller = null
}

/** The running game changed (games.ts). */
function gameChanged(name: string | null): void {
  if (name && !saved.seenGames.includes(name)) {
    saved.seenGames = [name, ...saved.seenGames].slice(0, 30)
    save()
  }
  if (name && saved.enabled && deps?.signedIn()) {
    startPolling()
  } else {
    stopPolling()
    gameHwnd = 0
    if (!preview) {
      hide()
      // Nothing to play over: free the window's memory until the next game.
      if (alive(win)) win.destroy()
      win = null
    }
  }
}

function endPreview(): void {
  if (!preview) return
  preview = false
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = null
  hide()
  if (runningGame()) startPolling()
  else if (alive(win)) {
    win.destroy()
    win = null
  }
}

function startPreview(): void {
  if (!supported || !saved.enabled) return
  stopPolling()
  preview = true
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(endPreview, PREVIEW_MS)
  const main = deps?.mainWindow() ?? null
  let rect: Rectangle | null = null
  if (alive(main)) {
    try {
      rect = screen.dipToScreenRect(main, main.getBounds())
    } catch {
      rect = null
    }
  }
  if (visible) sendState()
  showOver(rect)
}

// ---- Pop-ups (the main window's notifications go here while you're in game) -------------

function kindOf(key: string): OverlayToast['kind'] {
  if (key.startsWith('call:')) return 'call'
  if (key.startsWith('nebula:')) return 'constellation'
  if (/^(request|online|hang|joined):/.test(key)) return 'friend'
  return 'message'
}

const POPUP_FOR: Record<OverlayToast['kind'], (typeof POPUPS)[number]> = {
  message: 'messages',
  call: 'calls',
  constellation: 'constellations',
  friend: 'friends'
}

/**
 * Called with each notification the main window wants to show. While the overlay is showing (and
 * that kind of pop-up is on) it shows there instead of as a Windows notification: true.
 */
export function overlayNotification(n: ShowNotification): boolean {
  if (!visible || !saved.enabled) return false
  const kind = kindOf(n.key)
  if (!saved.popups[POPUP_FOR[kind]]) return false
  const toast: OverlayToast = {
    key: n.key,
    kind,
    conversationId: n.conversationId,
    title: n.title,
    body: n.body,
    icon: n.icon
  }
  send('overlay:toast', toast)
  return true
}

/** A notification went away (a call was answered, a chat was read). */
export function overlayClear(key: string): void {
  send('overlay:clear-toast', key)
}

/** Signed out: no overlay until someone signs in again. */
export function overlaySignedOut(): void {
  endPreview()
  stopPolling()
  hide()
  if (alive(win)) win.destroy()
  win = null
  voice = null
}

/** Signed in: start looking again. */
export function overlaySignedIn(): void {
  if (saved.enabled) checkGamesNow()
  if (runningGame()) gameChanged(runningGame())
}

// ---- What arrives from the windows ----------------------------------------------------

function cleanVoice(v: unknown): OverlayVoice | null {
  const x = v as Record<string, unknown> | null
  if (!x || typeof x !== 'object' || !Array.isArray(x.people)) return null
  const kind = x.kind === 'group' || x.kind === 'nebula' ? x.kind : 'dm'
  const people = x.people.slice(0, 50).flatMap((p: unknown) => {
    const q = p as Record<string, unknown> | null
    if (!q || !isId(q.id) || typeof q.displayName !== 'string') return []
    return [
      {
        id: q.id,
        displayName: q.displayName.slice(0, 64),
        avatarVersion: typeof q.avatarVersion === 'string' ? q.avatarVersion.slice(0, 64) : null,
        speaking: q.speaking === true,
        muted: q.muted === true,
        me: q.me === true
      }
    ]
  })
  return {
    title: typeof x.title === 'string' ? x.title.slice(0, 80) : '',
    kind,
    people,
    micOn: x.micOn === true,
    sharing: x.sharing === true,
    connected: x.connected === true
  }
}

const OVERLAY_COMMANDS = new Set(['mute', 'leave', 'answer', 'decline', 'share-game'])

async function shareGame(): Promise<void> {
  if (!gameHwnd) return
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 }
    })
    const found = sources.find((s) => s.id.split(':')[1] === String(gameHwnd))
    if (found) toMain({ cmd: 'share-game', sourceId: found.id })
    else send('overlay:problem', "Couldn't find the game's window to share.")
  } catch (err) {
    console.warn('[overlay] sharing the game failed', err)
    send('overlay:problem', "Couldn't share the game.")
  }
}

export function startOverlay(d: Deps): void {
  deps = d
  load()
  const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    d.isAppUrl(e.senderFrame?.url ?? '')
  const fromOverlay = (e: IpcMainEvent): boolean =>
    alive(win) && e.sender === win.webContents && fromApp(e)
  const fromMain = (e: IpcMainEvent): boolean => {
    const main = d.mainWindow()
    return alive(main) && e.sender === main.webContents && fromApp(e)
  }

  ipcMain.handle('overlay:info', (e) => (fromApp(e) ? info() : null))
  ipcMain.handle('overlay:set', (e, changes: unknown) => {
    if (!fromApp(e) || typeof changes !== 'object' || changes === null || Array.isArray(changes))
      return null
    const rest = { ...(changes as Record<string, unknown>) }
    delete rest.seenGames // only the main process adds to it
    if (!apply(rest)) return null
    save()
    if (!saved.enabled) {
      endPreview()
      stopPolling()
      hide()
    } else if (runningGame()) {
      startPolling()
    } else {
      checkGamesNow()
    }
    setKeys()
    const now = info()
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('overlay:settings', now)
    return now
  })
  ipcMain.on('overlay:preview', (e, on: unknown) => {
    if (!fromApp(e) || typeof on !== 'boolean') return
    if (on) startPreview()
    else endPreview()
  })
  ipcMain.on('overlay:close', (e) => {
    if (fromOverlay(e)) closeOverlay()
  })
  ipcMain.on('overlay:voice', (e, v: unknown) => {
    if (!fromMain(e)) return
    voice = v === null ? null : cleanVoice(v)
    send('overlay:voice', voice)
    setKeys()
  })
  ipcMain.on('overlay:command', (e, c: unknown) => {
    const cmd = (c as { cmd?: unknown } | null)?.cmd
    if (!fromOverlay(e) || typeof cmd !== 'string' || !OVERLAY_COMMANDS.has(cmd)) return
    if (cmd === 'share-game') void shareGame()
    else toMain({ cmd } as OverlayCommand)
    // Answering from the overlay: the call shows in the overlay's voice panel, so it stays open.
  })

  watchRunningGame(() => saved.enabled && d.signedIn(), gameChanged)
  app.on('will-quit', () => {
    for (const k of keys) globalShortcut.unregister(k)
    keys = []
  })
}

import { app, BrowserWindow, shell } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import type { LaunchUpdateView } from '../preload/launch-update'
import { markQuitting, startedAtLogin } from './app-settings'
import { reportError } from './errors'
import { setUpUpdates } from './updater'

// 0.8.6: update on every launch, like Discord (Windows and Mac).
//
// When Glofly opens, a small 360×420 window ("Checking for updates") asks the update feed
// whether there's a newer version. Nothing new: Glofly opens (the window shows for about a
// second). A new version: it downloads with a progress bar while the firefly flies in a
// circle, installs, and Glofly reopens straight into the new version. Approved look: the
// "Glofly Desktop Updater" design canvas (the page is src/renderer/updater.html).
//
// It never stands in the way of opening Glofly:
//  - no answer within 5 seconds (slow or no internet): "Couldn't check", then Glofly opens and
//    the background check (updater.ts) keeps trying;
//  - a download that stalls for 30 seconds, or would take more than about 2 more minutes: Glofly
//    opens and the download carries on in the background ("Restart to update" when it's ready);
//  - an update that didn't install twice in a row is skipped at launch (reported to
//    Control → Errors) so Glofly can't get stuck reinstalling it every time it opens;
//  - opened by "Open Glofly when my computer starts": no window at all. The background check
//    downloads quietly and the update installs the next time Glofly quits.
//
// It only does anything in the installed app with an update feed (and, on a Mac, a build signed
// with Glofly's Developer ID), the same rules as the background updates. Since the check lives in
// the app, it starts working from the version after the one that adds it.
//
// Try the window while developing (no real update): npm run updater-preview (apps/desktop).

const CHECK_TIMEOUT = 5_000
const MIN_SHOWN = 900
const OFFLINE_SHOWN = 1_800
const DONE_SHOWN = 900
const STALL_AFTER = 30_000
const SLOW_CHECK_AFTER = 8_000
const SLOW_SECONDS_LEFT = 120
const INSTALL_GRACE = 20_000
const MAX_TRIES = 2

const VERSION = /^[0-9A-Za-z.+-]{1,40}$/
const safeVersion = (v: unknown): string => (typeof v === 'string' && VERSION.test(v) ? v : '')

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------
// "Didn't install twice": the version being installed is written down just before Glofly closes
// to install it. If the next start is still the old version, that try failed.

type Tries = { version: string; tries: number; reported?: boolean }

const triesFile = (): string => join(app.getPath('userData'), 'launch-update.json')

function readTries(): Tries | null {
  try {
    const value = JSON.parse(readFileSync(triesFile(), 'utf8')) as Partial<Tries>
    if (typeof value.version !== 'string' || typeof value.tries !== 'number') return null
    return { version: value.version, tries: value.tries, reported: value.reported === true }
  } catch {
    return null
  }
}

function writeTries(value: Tries | null): void {
  try {
    if (value) writeFileSync(triesFile(), JSON.stringify(value))
    else if (existsSync(triesFile())) unlinkSync(triesFile())
  } catch {
    // Not being able to keep count only means a failing update may be tried again.
  }
}

/** The version to skip at launch (it failed to install twice), or null. */
function settleTries(): string | null {
  const tried = readTries()
  if (!tried) return null
  if (tried.version === app.getVersion()) {
    writeTries(null) // it installed
    return null
  }
  if (tried.tries < MAX_TRIES) return null
  if (!tried.reported) {
    reportError({
      message: `Update to ${tried.version} didn't install after ${tried.tries} tries (still on ${app.getVersion()})`,
      where: 'updater'
    })
    writeTries({ ...tried, reported: true })
  }
  return tried.version
}

function countTry(version: string): void {
  const tried = readTries()
  writeTries({ version, tries: tried?.version === version ? tried.tries + 1 : 1 })
}

// ---------------------------------------------------------------------------------------
// The window.

let launchWindow: BrowserWindow | null = null

/** Opening Glofly again while the updater window is up brings it forward. */
export function focusLaunchWindow(): boolean {
  const window = launchWindow
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

type LaunchWindow = {
  window: BrowserWindow
  show: (view: LaunchUpdateView) => void
  /** How long it has been on screen (0 while it hasn't appeared yet). */
  shownFor: () => number
}

function createLaunchWindow(): LaunchWindow {
  const window = new BrowserWindow({
    width: 360,
    height: 420,
    useContentSize: true,
    show: false,
    center: true,
    frame: false,
    transparent: true, // the page draws the rounded night-sky card
    backgroundColor: '#00000000',
    hasShadow: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Glofly',
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  launchWindow = window

  let shownAt = 0
  window.once('ready-to-show', () => {
    window.show()
    shownAt = Date.now()
  })
  window.on('closed', () => {
    if (launchWindow === window) launchWindow = null
  })

  // It's a fixed page: it never goes anywhere or opens anything.
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  let loaded = false
  let latest: LaunchUpdateView = { phase: 'checking' }
  const push = (): void => {
    if (!loaded || window.isDestroyed()) return
    // The view is plain data (a phase, a checked version string and numbers).
    window.webContents
      .executeJavaScript(`window.gfUpdate && window.gfUpdate(${JSON.stringify(latest)})`)
      .catch(() => undefined)
  }
  window.webContents.on('did-finish-load', () => {
    loaded = true
    push()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/updater.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/updater.html'))
  }

  return {
    window,
    show: (view) => {
      latest = view
      push()
    },
    shownFor: () => (shownAt ? Date.now() - shownAt : 0)
  }
}

/** Opens Glofly, then closes the updater window once Glofly's own window is on screen. */
function handOff(launch: LaunchWindow, openApp: () => BrowserWindow | null): void {
  const main = openApp()
  const close = (): void => {
    if (!launch.window.isDestroyed()) launch.window.destroy()
  }
  if (!main || main.isDestroyed() || main.isVisible()) return close()
  main.once('show', close)
  setTimeout(close, 4_000) // whatever happens, it never lingers
}

// ---------------------------------------------------------------------------------------

/**
 * Runs the launch check, then calls openApp (which opens Glofly's window and starts everything
 * else). openApp isn't called when Glofly closes to install an update: it reopens by itself.
 */
export async function updateOnLaunch(openApp: () => BrowserWindow | null): Promise<void> {
  if (!app.isPackaged && process.env['GLOFLY_UPDATER_PREVIEW'] === '1') return preview(openApp)
  if (!setUpUpdates() || startedAtLogin()) {
    openApp()
    return
  }

  const skip = settleTries()
  const launch = createLaunchWindow()

  let finished = false
  let installing = false
  let version = ''
  let downloadStarted = 0
  let lastProgress = 0
  const cleanups: Array<() => void> = []
  const listen = <A extends unknown[]>(event: string, handler: (...args: A) => void): void => {
    const h = handler as (...args: unknown[]) => void
    autoUpdater.on(event as 'error', h)
    cleanups.push(() => autoUpdater.removeListener(event as 'error', h))
  }
  const timers: ReturnType<typeof setTimeout>[] = []
  const later = (ms: number, fn: () => void): void => {
    timers.push(setTimeout(fn, ms))
  }

  /** Stops watching the updater (it carries on by itself in the background) and opens Glofly. */
  const open = async (waitMs = 0): Promise<void> => {
    if (finished) return
    finished = true
    for (const stop of cleanups) stop()
    for (const timer of timers) clearTimeout(timer)
    if (waitMs > 0 && !launch.window.isDestroyed()) await delay(waitMs)
    handOff(launch, openApp)
  }
  const openSoon = (): Promise<void> => open(Math.max(0, MIN_SHOWN - launch.shownFor()))
  const openOffline = (): void => {
    if (finished) return
    launch.show({ phase: 'offline' })
    void open(OFFLINE_SHOWN)
  }

  // Closing the updater window (Alt+F4, Cmd+W) closes Glofly, as with any app's window.
  launch.window.on('closed', () => {
    if (finished) return
    finished = true
    for (const stop of cleanups) stop()
    for (const timer of timers) clearTimeout(timer)
    app.quit()
  })

  let phase: 'checking' | 'downloading' = 'checking'

  listen('update-not-available', () => {
    if (phase === 'checking') void openSoon()
  })

  listen('update-available', (info: UpdateInfo) => {
    if (phase !== 'checking' || finished) return
    version = safeVersion(info?.version)
    if (version && version === skip) {
      // It failed to install twice: open normally ("Restart to update" still offers it).
      void openSoon()
      return
    }
    phase = 'downloading'
    downloadStarted = lastProgress = Date.now()
    launch.show({ phase: 'downloading', version, percent: 0, transferred: 0, total: 0 })
    const watch = (): void => {
      if (finished || installing) return
      if (Date.now() - lastProgress > STALL_AFTER) void open()
      else later(2_000, watch)
    }
    later(2_000, watch)
  })

  listen('download-progress', (progress: ProgressInfo) => {
    if (phase !== 'downloading' || finished) return
    lastProgress = Date.now()
    const percent = Number(progress?.percent) || 0
    const total = Number(progress?.total) || 0
    const transferred = Number(progress?.transferred) || 0
    const speed = Number(progress?.bytesPerSecond) || 0
    if (percent >= 99.9) {
      // Mac: macOS's own updater takes it from here, which can take a few seconds more.
      launch.show({ phase: 'installing', version })
      return
    }
    launch.show({ phase: 'downloading', version, percent, transferred, total })
    // A slow connection: don't keep Glofly closed for minutes; finish in the background.
    if (Date.now() - downloadStarted > SLOW_CHECK_AFTER && speed > 0 && total > transferred) {
      if ((total - transferred) / speed > SLOW_SECONDS_LEFT) void open()
    }
  })

  listen('update-downloaded', (info: UpdateInfo) => {
    if (finished) return
    const ready = safeVersion(info?.version) || version
    if (ready && ready === skip) return void openSoon()
    installing = true
    launch.show({ phase: 'done', version: ready })
    later(DONE_SHOWN, () => {
      if (finished) return
      finished = true
      for (const stop of cleanups) stop()
      countTry(ready)
      // Closes Glofly, installs silently, and opens the new version (Windows: the installer
      // runs it; Mac: macOS's updater relaunches it).
      markQuitting()
      autoUpdater.quitAndInstall(true, true)
      // Still here a while later: the install didn't start. Open Glofly rather than sit there.
      setTimeout(() => {
        if (!launch.window.isDestroyed()) handOff(launch, openApp)
      }, INSTALL_GRACE)
    })
  })

  listen('error', () => {
    if (finished || installing) return
    if (phase === 'checking') openOffline()
    else void open() // a download that failed: the background check tries again later
  })

  later(CHECK_TIMEOUT, () => {
    if (phase === 'checking') openOffline()
  })

  autoUpdater.checkForUpdates().then(
    (result) => {
      // null: this copy can't update itself after all (nothing will be heard back).
      if (!result && phase === 'checking') void openSoon()
    },
    () => {
      if (phase === 'checking') openOffline()
    }
  )
}

// ---------------------------------------------------------------------------------------
// Development preview: every frame of the window with a pretend download, then Glofly opens.

async function preview(openApp: () => BrowserWindow | null): Promise<void> {
  const launch = createLaunchWindow()
  const [major, minor, patch] = app
    .getVersion()
    .split('.')
    .map((n) => Number(n) || 0)
  const version = `${major}.${minor}.${patch + 1}`
  const total = 19.1 * 1024 * 1024
  let closed = false
  launch.window.on('closed', () => {
    closed = true
  })

  await delay(1_600)
  for (let step = 0; step <= 50 && !closed; step++) {
    const percent = step * 2
    launch.show(
      percent >= 100
        ? { phase: 'installing', version }
        : { phase: 'downloading', version, percent, transferred: (total * percent) / 100, total }
    )
    await delay(110)
  }
  await delay(900)
  launch.show({ phase: 'done', version })
  await delay(1_600)
  launch.show({ phase: 'offline' })
  await delay(2_400)
  if (!closed) handOff(launch, openApp)
  else openApp()
}

import { app, BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CustomGame, GameState, RunningProgram } from '../preload/api-types'
import { KNOWN_GAMES } from './game-list'
import { isHidden, matchGame, parseRegName, parseSteamAppId, parseTasklist } from './game-parse'

// "Playing Guild Wars 2": every 15 seconds Glofly asks Windows which programs are running
// and matches them against games it knows, games you added yourself, and whatever Steam
// says is running. Only the matched game's name leaves this computer (sent to the server by
// realtime.ts); the list of running programs never does.
//
// Settings (saved on this computer, games.json): Show what I'm playing (on by default),
// games you added, games you hid, and whether the one-time "your friends can see this"
// note has been shown.

const CHECK_EVERY_MS = 15_000
const NAME_MAX = 64
/** A program file name: letters, digits, spaces and a few symbols, ending in .exe */
const EXE = /^[\w .()+'!&-]{1,96}\.exe$/i

type Saved = {
  enabled: boolean
  custom: CustomGame[]
  hidden: string[]
  noticeShown: boolean
}
const saved: Saved = { enabled: true, custom: [], hidden: [], noticeShown: false }

let current: string | null = null
let timer: ReturnType<typeof setInterval> | null = null
let checking = false
let onActivity: (name: string | null) => void = () => {}

const supported = process.platform === 'win32'
const file = (): string => join(app.getPath('userData'), 'games.json')

/** Control characters, zero-width characters and direction overrides (the right-to-left trick). */
const HIDDEN_CHARACTERS = new RegExp(
  // eslint-disable-next-line no-control-regex -- removing control characters is the point
  '[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2069\\ufeff]',
  'g'
)

export const cleanGameName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const name = value.replace(HIDDEN_CHARACTERS, '').replace(/\s+/g, ' ').trim()
  return name ? [...name].slice(0, NAME_MAX).join('') : null
}
export const isExe = (value: unknown): value is string =>
  typeof value === 'string' && EXE.test(value)

function load(): void {
  try {
    const v = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Saved>
    if (typeof v.enabled === 'boolean') saved.enabled = v.enabled
    if (typeof v.noticeShown === 'boolean') saved.noticeShown = v.noticeShown
    if (Array.isArray(v.custom)) {
      saved.custom = v.custom
        .filter((g) => isExe(g?.exe) && cleanGameName(g?.name))
        .map((g) => ({ exe: g.exe.toLowerCase(), name: cleanGameName(g.name)! }))
        .slice(0, 100)
    }
    if (Array.isArray(v.hidden)) {
      saved.hidden = v.hidden
        .map(cleanGameName)
        .filter((n): n is string => !!n)
        .slice(0, 200)
    }
  } catch {
    // First run (or an unreadable file): defaults.
  }
}

function save(): void {
  try {
    writeFileSync(file(), JSON.stringify(saved, null, 2))
  } catch (err) {
    console.error("Couldn't save game settings", err)
  }
}

export function gameState(): GameState {
  return {
    supported,
    enabled: saved.enabled,
    current: saved.enabled ? current : null,
    detected: current,
    custom: saved.custom,
    hidden: saved.hidden,
    noticeShown: saved.noticeShown
  }
}

function announce(): void {
  const state = gameState()
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('games:changed', state)
}

/** Runs a Windows program and returns what it printed (empty if it failed). */
function run(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      resolve(err ? '' : String(out))
    )
  })
}

/** Lowercase program names of everything running. */
async function runningExes(): Promise<Set<string>> {
  return parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh']))
}

/** The game Steam says is running right now, by its name in Steam's own records. */
async function steamGame(): Promise<string | null> {
  const appId = parseSteamAppId(
    await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'])
  )
  if (!appId) return null
  const name = parseRegName(
    await run('reg', ['query', `HKCU\\Software\\Valve\\Steam\\Apps\\${appId}`, '/v', 'Name'])
  )
  return cleanGameName(name)
}

/**
 * What's being played: your own games first, then known games, then Steam. `shared` leaves out
 * games you hid; `running` doesn't (0.7.0: the game overlay works in hidden games too).
 */
async function detect(): Promise<{ shared: string | null; running: string | null }> {
  const exes = await runningExes()
  const all = matchGame(exes, saved.custom, KNOWN_GAMES, [])
  const visible = matchGame(exes, saved.custom, KNOWN_GAMES, saved.hidden)
  if (visible) return { shared: visible, running: all ?? visible }
  const steam = exes.has('steam.exe') ? await steamGame() : null
  return {
    shared: steam && !isHidden(steam, saved.hidden) ? steam : null,
    running: all ?? steam
  }
}

/** The game running now, hidden or not (null when nothing is, or nobody asked to look). */
let running: string | null = null
/** 0.7.0: the game overlay wants to know about games even with "Show what I'm playing" off. */
let overlayWants: () => boolean = () => false
let onRunning: (name: string | null) => void = () => {}

async function check(): Promise<void> {
  if (checking || !supported) return
  checking = true
  try {
    const found = saved.enabled || overlayWants() ? await detect() : { shared: null, running: null }
    const shared = saved.enabled ? found.shared : null
    if (shared !== current) {
      current = shared
      onActivity(saved.enabled ? current : null)
      announce()
    }
    if (found.running !== running) {
      running = found.running
      onRunning(running)
    }
  } catch (err) {
    console.error('Game check failed', err)
  } finally {
    checking = false
  }
}

/** 0.7.0 game overlay: told whenever the running game changes (looked for while `wants()`). */
export function watchRunningGame(
  wants: () => boolean,
  listener: (name: string | null) => void
): void {
  overlayWants = wants
  onRunning = listener
}

/** Asks again right away (say, the overlay was just turned on). */
export const checkGamesNow = (): void => void check()

export const runningGame = (): string | null => running

/** Whether this program (lowercase file name) is the running game, as far as Glofly knows it. */
export const isRunningGameExe = (exe: string): boolean =>
  !!running && matchGame(new Set([exe.toLowerCase()]), saved.custom, KNOWN_GAMES, []) === running

/** Starts watching for games. `share` sends the game (or null) to the server. */
export function startGameWatch(share: (name: string | null) => void): void {
  load()
  onActivity = share
  if (!supported) return
  void check()
  timer = setInterval(() => void check(), CHECK_EVERY_MS)
  app.on('before-quit', () => {
    if (timer) clearInterval(timer)
  })
}

/** What to share right now (sent again whenever the connection comes back). */
export const sharedGame = (): string | null => (saved.enabled ? current : null)

// ---- Settings → Activity ----

export function setGamesEnabled(enabled: boolean): GameState {
  saved.enabled = enabled
  save()
  if (!enabled) {
    current = null
    onActivity(null)
  }
  announce()
  void check()
  return gameState()
}

export function hideGame(name: string, hide: boolean): GameState {
  const lower = name.toLowerCase()
  saved.hidden = saved.hidden.filter((n) => n.toLowerCase() !== lower)
  if (hide) saved.hidden.push(name)
  save()
  if (hide && current?.toLowerCase() === lower) {
    current = null
    onActivity(null)
  }
  announce()
  void check()
  return gameState()
}

export function addGame(exe: string, name: string): GameState {
  const lower = exe.toLowerCase()
  saved.custom = [{ exe: lower, name }, ...saved.custom.filter((g) => g.exe !== lower)].slice(
    0,
    100
  )
  save()
  announce()
  void check()
  return gameState()
}

export function removeGame(exe: string): GameState {
  saved.custom = saved.custom.filter((g) => g.exe !== exe.toLowerCase())
  save()
  announce()
  void check()
  return gameState()
}

export function markNoticeShown(): void {
  if (saved.noticeShown) return
  saved.noticeShown = true
  save()
  announce()
}

/** Programs with a window open right now, for "Add a game" (only shown on this computer). */
export async function runningPrograms(): Promise<RunningProgram[]> {
  if (!supported) return []
  const out = await run(
    'powershell',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle | ConvertTo-Json -Compress'
    ],
    10_000
  )
  let rows: unknown
  try {
    rows = JSON.parse(out || '[]')
  } catch {
    return []
  }
  const list = (Array.isArray(rows) ? rows : [rows]) as {
    ProcessName?: unknown
    MainWindowTitle?: unknown
  }[]
  const skip = new Set([
    'glofly',
    'electron',
    'explorer',
    'applicationframehost',
    'textinputhost',
    'systemsettings'
  ])
  const seen = new Set<string>()
  const result: RunningProgram[] = []
  for (const r of list) {
    if (typeof r?.ProcessName !== 'string' || typeof r?.MainWindowTitle !== 'string') continue
    const exe = `${r.ProcessName}.exe`.toLowerCase()
    if (skip.has(r.ProcessName.toLowerCase()) || seen.has(exe) || !isExe(exe)) continue
    seen.add(exe)
    result.push({ exe, title: cleanGameName(r.MainWindowTitle) ?? r.ProcessName })
  }
  return result.sort((a, b) => a.title.localeCompare(b.title))
}

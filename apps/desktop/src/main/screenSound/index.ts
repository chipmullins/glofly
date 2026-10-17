// 0.5.0: the sound that goes with a shared screen or window (Broadcast now, and sharing in a call).
//
// What this computer can do (screenSoundSupport):
//   'app'    Windows 10 2004+ and macOS 14.2+: only the shared app's sound (a window), or the
//            whole computer's sound without Glofly's own (a screen). See worker.ts.
//   'system' older Windows: Electron's loopback, which is everything, Glofly's own calls included.
//   'none'   older Macs and Linux: the screen goes without sound.
//
// For 'app', the capture runs in a utility process (worker.ts) and its sound is passed to the
// window that asked, which turns it into a call track (renderer lib/screenSound.ts).
import { app, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import { release } from 'node:os'
import { join } from 'node:path'
import type { WorkerStart } from './worker'

export type ScreenSoundSupport = 'app' | 'system' | 'none'
export type ScreenSoundFormat = {
  sampleRate: number
  channels: number
  float: boolean
  /** 'app': only the shared window's app. 'computer': everything except Glofly. */
  scope: 'app' | 'computer'
}

const has = (pkg: string): boolean => {
  try {
    require.resolve(`${pkg}/package.json`)
    return true
  } catch {
    return false
  }
}

let support: ScreenSoundSupport | null = null
export function screenSoundSupport(): ScreenSoundSupport {
  if (support) return support
  const [major, minor, build] = release()
    .split('.')
    .map((n) => Number(n) || 0)
  if (process.platform === 'win32') {
    // Process loopback arrived in Windows 10 version 2004 (build 19041); 64-bit only.
    support = build >= 19041 && process.arch === 'x64' && has('loopback-capture') ? 'app' : 'system'
  } else if (process.platform === 'darwin') {
    // Core Audio taps: macOS 14.2 (Darwin 23.2) and newer.
    support = (major > 23 || (major === 23 && minor >= 2)) && has('audiotee') ? 'app' : 'none'
  } else support = 'none'
  return support
}

let running: { child: UtilityProcess; owner: WebContents } | null = null

export function stopScreenSound(owner?: WebContents): void {
  if (!running || (owner && running.owner !== owner)) return
  const { child } = running
  running = null
  child.postMessage({ type: 'stop' })
  setTimeout(() => child.kill(), 1500)
}

/** Glofly's own processes. On a Mac only the ones that play sound need leaving out. */
function gloflyPids(): number[] {
  const metrics = app.getAppMetrics()
  const sound = metrics
    .filter((m) => m.serviceName === 'audio.mojom.AudioService')
    .map((m) => m.pid)
  const rest = metrics.map((m) => m.pid).filter((p) => p !== process.pid && !sound.includes(p))
  return process.platform === 'darwin' && sound.length
    ? [process.pid, ...sound]
    : [process.pid, ...sound, ...rest]
}

/**
 * Starts capturing the sound for `sourceId` and streams it to `owner` ('screen-sound:chunk'),
 * until stopScreenSound, the window goes away, or a new share starts.
 */
export function startScreenSound(
  owner: WebContents,
  sourceId: string
): Promise<{ ok: true; format: ScreenSoundFormat } | { ok: false }> {
  stopScreenSound()
  if (screenSoundSupport() !== 'app') return Promise.resolve({ ok: false })
  const child = utilityProcess.fork(join(__dirname, 'screenSound.js'), [], {
    serviceName: 'Glofly screen sound',
    stdio: 'inherit'
  })
  const mine = { child, owner }
  running = mine
  const done = (): void => {
    if (running === mine) running = null
    if (!owner.isDestroyed()) owner.send('screen-sound:ended')
  }
  owner.once('destroyed', () => stopScreenSound(owner))
  owner.once('did-start-navigation', () => stopScreenSound(owner))

  return new Promise((resolve) => {
    let answered = false
    const answer = (r: { ok: true; format: ScreenSoundFormat } | { ok: false }): void => {
      if (answered) return
      answered = true
      clearTimeout(timer)
      if (!r.ok) stopScreenSound(owner)
      resolve(r)
    }
    const timer = setTimeout(() => answer({ ok: false }), 6000)
    child.on(
      'message',
      (m: { type?: string; data?: Uint8Array; message?: string } & ScreenSoundFormat) => {
        if (running !== mine || owner.isDestroyed()) return
        if (m?.type === 'chunk' && m.data instanceof Uint8Array)
          owner.send('screen-sound:chunk', m.data)
        else if (m?.type === 'format') {
          answer({
            ok: true,
            format: {
              sampleRate: m.sampleRate,
              channels: m.channels,
              float: m.float,
              scope: m.scope
            }
          })
        } else if (m?.type === 'error') {
          console.warn('[screen sound]', m.message)
          answer({ ok: false })
        }
      }
    )
    child.once('exit', () => {
      answer({ ok: false })
      done()
    })
    const start: WorkerStart = { type: 'start', sourceId, gloflyPids: gloflyPids() }
    child.postMessage(start)
  })
}

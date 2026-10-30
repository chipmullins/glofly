// 0.5.0: the sound that goes with a shared screen, captured in a process of its own (Electron's
// utilityProcess) so the native capture code can never take the Glofly window down with it.
//
// Two ways to listen, picked by the main process when it starts this:
//   - "app":      only one app's sound (the window being shared, and the processes it started).
//   - "computer": everything the computer plays EXCEPT Glofly itself (call voices, ringtones,
//                 Watch Together), so friends never hear themselves back.
//
// Windows 10 2004+ uses WASAPI's process loopback (the loopback-capture package); a window is
// turned into its process with user32's GetWindowThreadProcessId (koffi). macOS 14.2+ uses Core
// Audio taps (the audiotee helper); a window is turned into its process through CoreGraphics
// (osascript's JavaScript bridge, so no native module is needed on a Mac).
//
// Messages to the main process:
//   { type: 'format', sampleRate, channels, float, scope }   once, before any sound
//   { type: 'chunk', data: Uint8Array }                        interleaved PCM, ~20 ms each
//   { type: 'error', message }                                 couldn't start or stopped early
//   { type: 'note', message }                                  a fallback was used (reported)
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { join, sep } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export type WorkerStart = {
  type: 'start'
  /** desktopCapturer's id: "screen:…" or "window:<HWND or CGWindowID>:…". */
  sourceId: string
  /** Glofly's own processes (main, renderers, its audio service) to leave out. */
  gloflyPids: number[]
}

type Out =
  | {
      type: 'format'
      sampleRate: number
      channels: number
      float: boolean
      scope: 'app' | 'computer' | 'everything'
    }
  | { type: 'chunk'; data: Uint8Array }
  | { type: 'error'; message: string }
  /** Something worth reporting that didn't stop the sound (a fallback was used). */
  | { type: 'note'; message: string }

const port = process.parentPort
const send = (m: Out): void => port.postMessage(m)

/** Sends PCM in ~20 ms pieces (a message every 10 ms or less is needless chatter). */
function batcher(bytesPer20ms: number): { push: (b: Buffer) => void; flush: () => void } {
  let parts: Buffer[] = []
  let size = 0
  const flush = (): void => {
    if (!size) return
    const all = Buffer.concat(parts, size)
    parts = []
    size = 0
    send({ type: 'chunk', data: new Uint8Array(all.buffer, all.byteOffset, all.byteLength) })
  }
  return {
    push: (b) => {
      parts.push(Buffer.from(b)) // the native side may reuse its buffer
      size += b.length
      if (size >= bytesPer20ms) flush()
    },
    flush
  }
}

const windowHandle = (sourceId: string): number | null => {
  const m = /^window:(\d{1,20}):/.exec(sourceId)
  const n = m ? Number(m[1]) : NaN
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

// ---- Windows -----------------------------------------------------------------------------------

type Capture = {
  start: (pid: number, tree: boolean, cb: (b: Buffer) => void) => void
  startSystemAudio: (cb: (b: Buffer) => void) => void
  stop: () => void
}

function windowsProcessOf(hwnd: number): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require('koffi') as typeof import('koffi')
    const user32 = koffi.load('user32.dll')
    const getPid = user32.func(
      'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'
    )
    const out = [0]
    const thread = getPid(hwnd, out) as number
    return thread && out[0] > 0 ? out[0] : null
  } catch (err) {
    console.warn('[screen sound] could not find the window’s app', err)
    return null
  }
}

let capture: Capture | null = null

function startWindows(start: WorkerStart): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const addon = require('loopback-capture') as { LoopbackCapture: new () => Capture }
  const hwnd = windowHandle(start.sourceId)
  const appPid = hwnd ? windowsProcessOf(hwnd) : null
  const own = new Set([...start.gloflyPids, process.ppid, process.pid])
  // A window: that app and everything it started. The whole screen (or an app we couldn't
  // identify): everything except Glofly's process tree (the main process is its root).
  let scope: 'app' | 'computer' | 'everything' = appPid && !own.has(appPid) ? 'app' : 'computer'
  const out = batcher(48_000 * 2 * 2 * 0.02)
  // Oct 30, 2026: the format is only announced once the capture has really started (it used to go
  // first, so a capture that failed to start still looked started: a silent track). If Windows
  // refuses the per-app capture, fall back to the whole computer's sound (Glofly's included; the
  // window says so) rather than none.
  const tryStart = (how: () => void): string | null => {
    capture = new addon.LoopbackCapture()
    try {
      how()
      return null
    } catch (err) {
      capture = null
      return (err as Error)?.message ?? String(err)
    }
  }
  const failed =
    scope === 'app'
      ? tryStart(() => capture!.start(appPid!, true, out.push))
      : tryStart(() => capture!.start(start.gloflyPids[0] ?? process.ppid, false, out.push))
  if (failed) {
    send({ type: 'note', message: `${scope} capture failed: ${failed}` })
    const again = tryStart(() => capture!.startSystemAudio(out.push))
    if (again) throw new Error(`${failed}; system capture: ${again}`)
    scope = 'everything'
  }
  send({ type: 'format', sampleRate: 48_000, channels: 2, float: false, scope })
  setInterval(out.flush, 40).unref()
}

// ---- Mac ---------------------------------------------------------------------------------------

let tee: ChildProcess | null = null

async function macProcessOf(windowId: number): Promise<number | null> {
  // CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, id) → kCGWindowOwnerPID
  const script =
    'function run(argv){ObjC.import("CoreGraphics");' +
    'var l=ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(8,Number(argv[0]))));' +
    'return l&&l.length?String(l[0].kCGWindowOwnerPID):""}'
  try {
    const { stdout } = await run(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script, String(windowId)],
      {
        timeout: 4000
      }
    )
    const pid = Number(stdout.trim())
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null
  } catch (err) {
    console.warn('[screen sound] could not find the window’s app', err)
    return null
  }
}

/** pid and every process it started (a browser's sound comes from a helper process). */
async function withChildren(pid: number): Promise<number[]> {
  try {
    const { stdout } = await run('/bin/ps', ['-Ao', 'pid=,ppid='], { timeout: 4000 })
    const kids = new Map<number, number[]>()
    for (const line of stdout.split('\n')) {
      const [p, pp] = line.trim().split(/\s+/).map(Number)
      if (!p || !pp) continue
      kids.set(pp, [...(kids.get(pp) ?? []), p])
    }
    const all = [pid]
    for (let i = 0; i < all.length && all.length < 200; i++) all.push(...(kids.get(all[i]) ?? []))
    return all
  } catch {
    return [pid]
  }
}

async function startMac(start: WorkerStart): Promise<void> {
  const id = windowHandle(start.sourceId)
  const appPid = id ? await macProcessOf(id) : null
  const scope = appPid && !start.gloflyPids.includes(appPid) ? 'app' : 'computer'
  const pids = scope === 'app' ? await withChildren(appPid!) : start.gloflyPids
  // The helper sits next to its package: …/node_modules/audiotee/bin/audiotee. In the packaged
  // app it's unpacked from the archive (electron-builder asarUnpack), so it can run.
  // (From its entry, …/audiotee/dist/index.js: its "exports" list refuses audiotee/package.json.)
  const bin = join(require.resolve('audiotee'), '..', '..', 'bin', 'audiotee').replace(
    `app.asar${sep}`,
    `app.asar.unpacked${sep}`
  )
  const args = ['--sample-rate', '48000', '--chunk-duration', '0.02']
  args.push(scope === 'app' ? '--include-processes' : '--exclude-processes', ...pids.map(String))
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  tee = child
  // Asking for a sample rate makes AudioTee send 16-bit samples; it says how many channels in
  // its "metadata" line (one, when it converts). Sound waits until the format is known.
  let format: Out | null = null
  const early: Buffer[] = []
  let out = batcher(48_000 * 2 * 0.02)
  const announce = (channels: number, float: boolean): void => {
    if (format) return
    format = { type: 'format', sampleRate: 48_000, channels, float, scope }
    send(format)
    for (const b of early.splice(0)) out.push(b)
  }
  const fallback = setTimeout(() => announce(1, false), 1500)
  child.stderr!.setEncoding('utf8')
  let pending = ''
  child.stderr!.on('data', (text: string) => {
    pending += text
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      try {
        const m = JSON.parse(line) as { message_type?: string; data?: Record<string, unknown> }
        if (m.message_type === 'metadata' && m.data) {
          const channels = Number(m.data.channels_per_frame) === 2 ? 2 : 1
          const float = Number(m.data.bits_per_channel) === 32
          out = batcher(48_000 * channels * (float ? 4 : 2) * 0.02)
          clearTimeout(fallback)
          announce(channels, float)
        } else if (m.message_type === 'error') {
          send({ type: 'error', message: String(m.data?.message ?? 'capture failed') })
        }
      } catch {
        // not one of AudioTee's JSON lines
      }
    }
  })
  child.stdout!.on('data', (b: Buffer) => (format ? out.push(b) : early.push(b)))
  child.on('error', (err) => send({ type: 'error', message: err.message }))
  child.on('exit', (code) => {
    tee = null
    send({ type: 'error', message: `stopped (${code ?? 'signal'})` })
    process.exit(0)
  })
  setInterval(() => out.flush(), 40).unref()
}

// ---- Both --------------------------------------------------------------------------------------

function stopAll(): void {
  try {
    capture?.stop()
  } catch {
    // already stopped
  }
  capture = null
  tee?.kill('SIGTERM')
  tee = null
}

port.on('message', (e) => {
  const m = e.data as WorkerStart | { type: 'stop' }
  if (m?.type === 'stop') {
    stopAll()
    process.exit(0)
  }
  if (m?.type !== 'start' || capture || tee) return
  const started =
    process.platform === 'win32' ? Promise.resolve().then(() => startWindows(m)) : startMac(m)
  started.catch((err: Error) => {
    send({ type: 'error', message: err?.message ?? 'capture failed' })
    stopAll()
    process.exit(0)
  })
})
process.on('exit', stopAll)

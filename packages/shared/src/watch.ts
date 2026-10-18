// Watch Together (Oct 2026): a YouTube video everyone in a call sees at the same moment.
//
// The server keeps one small state per call: which video, playing or paused, and where it was
// at a moment in the server's time. Every app works out "where the video should be now" from
// that and nudges its own player (YouTube's embed player) to match. Play, pause and skips go
// through the server, which answers everyone in the call with the new state.

/** Who can play, pause and skip: everyone in the call, or only whoever started the video. */
export type WatchControl = 'everyone' | 'starter'

/** What someone just did (for "Jordan went back 10 seconds"). */
export type WatchAction =
  | 'start'
  | 'change'
  | 'play'
  | 'pause'
  | 'seek'
  | 'back'
  | 'forward'
  | 'control'
  | 'ended'

/** The video a call is watching together. */
export type WatchState = {
  callId: string
  /** YouTube's 11-character video id */
  videoId: string
  title: string
  channel: string | null
  /** Seconds, once known (a player reports it) */
  durationSec: number | null
  /** Who picked the video */
  startedBy: string
  control: WatchControl
  playing: boolean
  /** Seconds into the video at `at` */
  position: number
  /** The server's clock (ms since 1970) when `position` was true */
  at: number
  /** The latest thing someone did, and who */
  last: { userId: string; action: WatchAction } | null
  /** Goes up with every change, so an older answer never wins over a newer one */
  seq: number
}

/** `watch:updated` on the live connection, and GET /calls/:id/watch. */
export type WatchUpdate = {
  callId: string
  /** null: nobody's watching anything (any more) */
  watch: WatchState | null
  /** The server's clock (ms) when it sent this, so apps can line their clocks up with it */
  serverNow: number
}

/** The little firefly reactions that float over the video. */
export const WATCH_REACTIONS = ['heart', 'laugh', 'wow', 'fire'] as const
export type WatchReaction = (typeof WATCH_REACTIONS)[number]

export const isWatchReaction = (value: unknown): value is WatchReaction =>
  typeof value === 'string' && (WATCH_REACTIONS as readonly string[]).includes(value)

/** `watch:reaction` on the live connection. */
export type WatchReactionEvent = {
  callId: string
  userId: string
  reaction: WatchReaction
  /** Unique, so the same reaction isn't shown twice */
  id: string
}

/** What a YouTube link shows before starting (the Start dialog). */
export type WatchPreview = {
  videoId: string
  title: string
  channel: string | null
  /** A picture from YouTube, or null */
  thumbnailUrl: string | null
}

/** How far ±10 s goes. */
export const WATCH_SKIP_SEC = 10

/** Further apart than this (seconds), an app jumps to where everyone is. */
export const WATCH_DRIFT_SEC = 1.2

const YT_ID = /^[A-Za-z0-9_-]{11}$/

/** A valid YouTube video id? */
export const isYouTubeId = (value: unknown): value is string =>
  typeof value === 'string' && YT_ID.test(value)

/** A link split into host, path parts and query (shared code has no URL class). */
function splitLink(input: string): { host: string; parts: string[]; query: Map<string, string>; hash: string } | null {
  const m = input.trim().match(/^(?:(https?):\/\/)?([^/?#\s]+)([^?#\s]*)(\?[^#\s]*)?(#\S*)?$/i)
  if (!m) return null
  const query = new Map<string, string>()
  for (const pair of (m[4] ?? '').slice(1).split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    if (!query.has(key)) query.set(key, eq < 0 ? '' : pair.slice(eq + 1))
  }
  return {
    host: m[2].toLowerCase().replace(/:\d+$/, '').replace(/^www\./, ''),
    parts: m[3].split('/').filter(Boolean),
    query,
    hash: m[5] ?? ''
  }
}

/**
 * The video id in a YouTube link: youtube.com/watch?v=…, youtu.be/…, /shorts/…, /live/…,
 * /embed/…, music.youtube.com, m.youtube.com, youtube-nocookie.com. A bare id works too.
 * Null if it isn't a YouTube video.
 */
export function youTubeIdFrom(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > 500) return null
  if (YT_ID.test(text)) return text
  const link = splitLink(text)
  if (!link) return null
  const { host, parts } = link
  let id: string | null = null
  if (host === 'youtu.be') id = parts[0] ?? null
  else if (['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) {
    if (parts[0] === 'watch') id = link.query.get('v') ?? null
    else if (['shorts', 'live', 'embed', 'v', 'e'].includes(parts[0] ?? '')) id = parts[1] ?? null
  }
  return id && YT_ID.test(id) ? id : null
}

/** Where a link says to start ("&t=90", "?t=1m30s", "#t=45"), in seconds, or 0. */
export function youTubeStartFrom(input: string): number {
  const link = splitLink(input)
  if (!link) return 0
  const raw = link.query.get('t') ?? link.query.get('start') ?? link.hash.match(/t=([^&]+)/)?.[1]
  if (!raw) return 0
  if (/^\d+$/.test(raw)) return Math.min(Number(raw), 24 * 3600)
  const m = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || !m[0]) return 0
  return Math.min(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0), 24 * 3600)
}

/**
 * Where the video should be (seconds) at this moment of the server's clock: still where it was
 * when paused, further on when playing. Never past the end (once the length is known).
 */
export function watchPositionAt(watch: WatchState, serverNow: number): number {
  const moved = watch.playing ? Math.max(0, serverNow - watch.at) / 1000 : 0
  const pos = Math.max(0, watch.position + moved)
  return watch.durationSec ? Math.min(pos, watch.durationSec) : pos
}

/** Has a playing video reached its end (by the server's clock)? */
export function watchEnded(watch: WatchState, serverNow: number): boolean {
  return !!watch.durationSec && watchPositionAt(watch, serverNow) >= watch.durationSec - 0.25
}

/** Can this person play, pause and skip? */
export const canControlWatch = (watch: WatchState, userId: string): boolean =>
  watch.control === 'everyone' || watch.startedBy === userId

/** "1:05", "12:48", "1:02:03" */
export function videoTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * The little line under the video after someone does something ("Jordan went back 10 seconds
 * for everyone"). `actor` is "You" for you. Null when there's nothing worth saying.
 */
export function watchActionText(watch: WatchState, actor: string): string | null {
  const last = watch.last
  if (!last) return null
  switch (last.action) {
    case 'start':
      return `${actor} started the video`
    case 'change':
      return `${actor} changed the video`
    case 'play':
      return `${actor} pressed play`
    case 'pause':
      return `${actor} paused for everyone`
    case 'seek':
      return `${actor} skipped to ${videoTime(watch.position)}`
    case 'back':
      return `${actor} went back ${WATCH_SKIP_SEC} seconds`
    case 'forward':
      return `${actor} skipped ahead ${WATCH_SKIP_SEC} seconds`
    case 'control':
      return watch.control === 'everyone'
        ? `${actor} let everyone pause and skip`
        : `Only ${actor === 'You' ? 'you' : actor} can pause and skip now`
    case 'ended':
      return 'The video ended'
    default:
      return null
  }
}

/**
 * Turns the server's clock into this device's: keeps the smallest gap seen (the answer that
 * arrived fastest), refreshed now and then in case either clock jumps.
 */
export class ServerClock {
  private offset: number | null = null
  private setAt = 0

  /** A server time (ms) just arrived. `sentAt`: when this device asked, if it asked. */
  note(serverNow: number, sentAt?: number): void {
    const now = Date.now()
    // The server's clock was read somewhere between asking and the answer: the middle is best.
    const local = sentAt !== undefined ? (sentAt + now) / 2 : now
    const guess = serverNow - local
    // A live event left the server a little while ago, so its clock looks behind: prefer
    // the larger offset, but take a fresh one every minute (clocks drift and jump).
    if (this.offset === null || guess > this.offset || now - this.setAt > 60_000) {
      this.offset = guess
      this.setAt = now
    }
  }

  /** The server's clock right now (ms). */
  now(): number {
    return Date.now() + (this.offset ?? 0)
  }
}

// ---- Checking what arrives (apps pass on only well-formed values) ----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS: readonly string[] = ['start', 'change', 'play', 'pause', 'seek', 'back', 'forward', 'control', 'ended']
const num = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null

/** A watch state with just its known fields, or null if anything's off. */
export function cleanWatchState(raw: unknown): WatchState | null {
  const x = raw as Record<string, unknown> | null
  if (!x || typeof x !== 'object') return null
  const position = num(x.position, 48 * 3600)
  const at = num(x.at, 1e14)
  const seq = num(x.seq, 1e12)
  if (
    typeof x.callId !== 'string' ||
    !UUID.test(x.callId) ||
    !isYouTubeId(x.videoId) ||
    typeof x.startedBy !== 'string' ||
    !UUID.test(x.startedBy) ||
    (x.control !== 'everyone' && x.control !== 'starter') ||
    typeof x.playing !== 'boolean' ||
    position === null ||
    at === null ||
    seq === null
  ) {
    return null
  }
  const last = x.last as { userId?: unknown; action?: unknown } | null | undefined
  return {
    callId: x.callId,
    videoId: x.videoId,
    title: typeof x.title === 'string' ? x.title.slice(0, 120) : 'YouTube video',
    channel: typeof x.channel === 'string' ? x.channel.slice(0, 120) : null,
    durationSec: num(x.durationSec, 48 * 3600),
    startedBy: x.startedBy,
    control: x.control,
    playing: x.playing,
    position,
    at,
    last:
      last && typeof last.userId === 'string' && UUID.test(last.userId) && ACTIONS.includes(last.action as string)
        ? { userId: last.userId, action: last.action as WatchAction }
        : null,
    seq
  }
}

export function cleanWatchUpdate(raw: unknown): WatchUpdate | null {
  const x = raw as Record<string, unknown> | null
  if (!x || typeof x.callId !== 'string' || !UUID.test(x.callId)) return null
  const serverNow = num(x.serverNow, 1e14)
  if (serverNow === null) return null
  const watch = x.watch === null ? null : cleanWatchState(x.watch)
  if (x.watch !== null && !watch) return null
  if (watch && watch.callId !== x.callId) return null
  return { callId: x.callId, watch, serverNow }
}

export function cleanWatchReaction(raw: unknown): WatchReactionEvent | null {
  const x = raw as Record<string, unknown> | null
  if (
    !x ||
    typeof x.callId !== 'string' ||
    !UUID.test(x.callId) ||
    typeof x.userId !== 'string' ||
    !UUID.test(x.userId) ||
    !isWatchReaction(x.reaction) ||
    typeof x.id !== 'string' ||
    x.id.length > 64
  ) {
    return null
  }
  return { callId: x.callId, userId: x.userId, reaction: x.reaction, id: x.id }
}

// ---- Keeping one player in step (the desktop app, the browser version and the phones) ----

/** What a player page says about itself (see the server's /watch/player). */
export type PlayerReport = {
  state: 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'
  /** Seconds into the video */
  time: number
  /** Seconds, 0 until known */
  duration: number
  muted: boolean
}

/** A command for the player page. */
export type PlayerCommand =
  | { cmd: 'load'; videoId: string; start: number; play: boolean }
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'seek'; to: number }
  | { cmd: 'volume'; volume?: number; muted?: boolean }

/** How this player is doing, for the pill under the video. */
export type SyncStatus = 'sync' | 'catching' | 'paused' | 'blocked' | 'ended'

/** What one player remembers between steps. */
export type SyncMemory = {
  lastSeekAt: number
  /** When "play" or "pause" was last sent */
  lastPlayAt: number
  /** "Play" sent without the player starting (a browser blocking sound until a tap) */
  playTries: number
  /** Started muted, because the browser wouldn't play it with sound */
  mutedForAutoplay: boolean
  /** The player's time at the last step (seconds; -1 = none yet), to see it moving on its own */
  lastTime: number
  /** It has played with sound once: the browser allows sound, so it's never muted for autoplay */
  heardSound: boolean
}

export const newSyncMemory = (): SyncMemory => ({ lastSeekAt: 0, lastPlayAt: 0, playTries: 0, mutedForAutoplay: false, lastTime: -1, heardSound: false })

/** How a player may behave. `neverMute`: a place that always lets videos play with sound (the desktop app). */
export type SyncOptions = { neverMute?: boolean }

/**
 * One step (twice a second): compares the player with where everyone is and says what to do.
 * Small differences are left alone (jumping all the time would be worse than being a moment
 * off); a player more than WATCH_DRIFT_SEC away jumps to where everyone is, slightly ahead so the
 * time it takes to load counts too.
 */
export function watchSyncStep(
  watch: WatchState,
  serverNow: number,
  player: PlayerReport,
  mem: SyncMemory,
  now: number = Date.now(),
  opts: SyncOptions = {}
): { commands: PlayerCommand[]; status: SyncStatus } {
  const expected = watchPositionAt(watch, serverNow)
  const commands: PlayerCommand[] = []
  // Oct 17: YouTube's player doesn't always say "playing" right away (its state can lag behind
  // for seconds while the video already plays). A time that moves forward on its own means it's
  // playing: without this, "play" counted as failed three times and the video was muted "for the
  // browser's autoplay rules" a second after its sound started (for everyone in the call).
  const moving = mem.lastTime >= 0 && player.time > mem.lastTime + 0.15 && player.time - mem.lastTime < 3
  mem.lastTime = player.time
  const playing = player.state === 'playing' || (moving && player.state !== 'paused' && player.state !== 'ended')
  if (playing && !player.muted) mem.heardSound = true
  const drift = player.time - expected
  const far = Math.abs(drift) > WATCH_DRIFT_SEC
  const ended = !!watch.durationSec && expected >= watch.durationSec - 0.25

  if (!watch.playing || ended) {
    mem.playTries = 0
    // Anything but a player known to be stopped gets "pause" (at most once a second): a player
    // whose state didn't come through (an "unstarted" one that YouTube autoplayed) must stop too.
    const stopped = player.state === 'paused' || player.state === 'ended' || player.state === 'cued'
    if (!stopped && now - mem.lastPlayAt > 1000) {
      commands.push({ cmd: 'pause' })
      mem.lastPlayAt = now
    }
    if (Math.abs(drift) > 0.5 && now - mem.lastSeekAt > 1000 && player.state !== 'unstarted') {
      commands.push({ cmd: 'seek', to: expected })
      mem.lastSeekAt = now
    }
    return { commands, status: ended ? 'ended' : 'paused' }
  }

  if (playing) {
    mem.playTries = 0
    if (far && now - mem.lastSeekAt > 2500) {
      commands.push({ cmd: 'seek', to: expected + (drift < 0 ? 0.4 : 0) })
      mem.lastSeekAt = now
      return { commands, status: 'catching' }
    }
    return { commands, status: far ? 'catching' : 'sync' }
  }
  if (player.state === 'buffering') return { commands, status: 'catching' }

  // Should be playing but isn't (paused, ended, not started yet).
  if (now - mem.lastPlayAt > 1500) {
    if (far && player.state !== 'unstarted') {
      commands.push({ cmd: 'seek', to: expected })
      mem.lastSeekAt = now
    }
    mem.playTries += 1
    // Twice without starting: the browser wants a tap before sound. Muted always may play.
    if (mem.playTries >= 3 && !mem.mutedForAutoplay && !opts.neverMute && !mem.heardSound) {
      mem.mutedForAutoplay = true
      commands.push({ cmd: 'volume', muted: true })
    }
    commands.push({ cmd: 'play' })
    mem.lastPlayAt = now
  }
  return { commands, status: mem.playTries >= 3 && !player.muted && !opts.neverMute && !mem.heardSound ? 'blocked' : 'catching' }
}

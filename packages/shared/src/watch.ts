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

/**
 * Where the video comes from (0.7.1). YouTube was the only one before, so a state without `site`
 * is YouTube, and apps older than 0.7.1 are only ever told about YouTube videos.
 */
export type WatchSite = 'youtube' | 'twitch' | 'vimeo' | 'dailymotion'
export const WATCH_SITES: readonly WatchSite[] = ['youtube', 'twitch', 'vimeo', 'dailymotion']
export const WATCH_SITE_NAMES: Record<WatchSite, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion'
}
/** The live-connection feature an app sends when it can play every site above (0.7.1). */
export const WATCH_SITES_FEATURE = 'watchSites'

/** The video a call is watching together. */
export type WatchState = {
  callId: string
  /** Which site (absent: YouTube, for older servers) */
  site?: WatchSite
  /**
   * The video on that site. YouTube: the 11-character id. Twitch: "v123456789" (a past broadcast)
   * or "c:channelname" (a live channel). Vimeo: "123456789" or "123456789:abc123" (unlisted).
   * Dailymotion: "x8abcd".
   */
  videoId: string
  /** A live stream (Twitch channels): no time line, no skipping, just play and pause */
  live?: boolean
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
  /** Starting answers (0.7.1): someone in the call has an app too old to show this site */
  someoneNeedsUpdate?: boolean
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

/** What a link shows before starting (the Start dialog). */
export type WatchPreview = {
  /** Absent from older servers: YouTube */
  site?: WatchSite
  live?: boolean
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

const TWITCH_VOD = /^v\d{5,14}$/
const TWITCH_CHANNEL = /^c:[A-Za-z0-9_]{3,25}$/
const VIMEO_ID = /^\d{5,12}(?::[0-9a-f]{6,20})?$/
const DM_ID = /^x[a-z0-9]{4,12}$/i

/** A valid video id for this site? */
export function isWatchVideoId(site: WatchSite, id: unknown): id is string {
  if (typeof id !== 'string') return false
  switch (site) {
    case 'youtube':
      return YT_ID.test(id)
    case 'twitch':
      return TWITCH_VOD.test(id) || TWITCH_CHANNEL.test(id)
    case 'vimeo':
      return VIMEO_ID.test(id)
    case 'dailymotion':
      return DM_ID.test(id)
  }
  return false
}

export const isWatchSite = (v: unknown): v is WatchSite =>
  typeof v === 'string' && (WATCH_SITES as readonly string[]).includes(v)

/** The name a video goes by until its site says ("YouTube video", "Twitch stream"…). */
export function defaultWatchTitle(site: WatchSite = 'youtube', live = false): string {
  if (site === 'twitch') return live ? 'Twitch stream' : 'Twitch video'
  return `${WATCH_SITE_NAMES[site]} video`
}

/**
 * What a link is: YouTube (as before), Twitch (twitch.tv/<channel>, twitch.tv/videos/<id>),
 * Vimeo (vimeo.com/<id>, vimeo.com/<id>/<hash>, player.vimeo.com/video/<id>) or Dailymotion
 * (dailymotion.com/video/<id>, dai.ly/<id>). Null if it's none of them.
 */
export function watchLinkFrom(input: string): { site: WatchSite; videoId: string; live: boolean; start: number } | null {
  const text = input.trim()
  if (!text || text.length > 500) return null
  const yt = youTubeIdFrom(text)
  if (yt) return { site: 'youtube', videoId: yt, live: false, start: youTubeStartFrom(text) }
  const link = splitLink(text)
  if (!link) return null
  const { host, parts } = link
  const start = youTubeStartFrom(text)
  if (host === 'twitch.tv' || host === 'm.twitch.tv' || host === 'go.twitch.tv') {
    if (parts[0] === 'videos' && /^\d{5,14}$/.test(parts[1] ?? '')) return { site: 'twitch', videoId: `v${parts[1]}`, live: false, start }
    const reserved = ['directory', 'videos', 'settings', 'p', 'downloads', 'jobs', 'search', 'login', 'signup', 'subscriptions', 'inventory', 'wallet', 'drops', 'friends', 'messages']
    const name = parts[0] ?? ''
    // twitch.tv/<channel> (live) or twitch.tv/<channel>/videos/… isn't a video; /<channel>/v/<id> is
    if (parts[1] === 'v' && /^\d{5,14}$/.test(parts[2] ?? '')) return { site: 'twitch', videoId: `v${parts[2]}`, live: false, start }
    if (parts.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(name) && !reserved.includes(name.toLowerCase())) {
      return { site: 'twitch', videoId: `c:${name.toLowerCase()}`, live: true, start: 0 }
    }
    return null
  }
  if (host === 'player.twitch.tv') {
    const video = link.query.get('video')?.replace(/^v/, '')
    if (video && /^\d{5,14}$/.test(video)) return { site: 'twitch', videoId: `v${video}`, live: false, start }
    const channel = link.query.get('channel')
    if (channel && /^[A-Za-z0-9_]{3,25}$/.test(channel)) return { site: 'twitch', videoId: `c:${channel.toLowerCase()}`, live: true, start: 0 }
    return null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const idx = host === 'player.vimeo.com' ? (parts[0] === 'video' ? 1 : -1) : parts.findIndex((p) => /^\d{5,12}$/.test(p))
    const id = idx >= 0 ? parts[idx] : undefined
    if (!id || !/^\d{5,12}$/.test(id)) return null
    const hash = (host === 'player.vimeo.com' ? link.query.get('h') : parts[idx + 1]) ?? ''
    const videoId = /^[0-9a-f]{6,20}$/.test(hash) ? `${id}:${hash}` : id
    return { site: 'vimeo', videoId, live: false, start }
  }
  if (host === 'dailymotion.com' || host === 'dai.ly' || host === 'geo.dailymotion.com') {
    let id: string | undefined
    if (host === 'dai.ly') id = parts[0]
    else if (parts[0] === 'video' || (parts[0] === 'embed' && parts[1] === 'video')) id = parts[0] === 'video' ? parts[1] : parts[2]
    else if (host === 'geo.dailymotion.com') id = link.query.get('video')
    id = id?.split('_')[0]
    if (!id || !DM_ID.test(id)) return null
    return { site: 'dailymotion', videoId: id.toLowerCase(), live: false, start }
  }
  return null
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
  const site: WatchSite = x.site === undefined ? 'youtube' : isWatchSite(x.site) ? x.site : ('?' as WatchSite)
  if (
    typeof x.callId !== 'string' ||
    !UUID.test(x.callId) ||
    !isWatchSite(site) ||
    !isWatchVideoId(site, x.videoId) ||
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
    site,
    videoId: x.videoId,
    live: site === 'twitch' && x.live === true,
    title: typeof x.title === 'string' ? x.title.slice(0, 120) : defaultWatchTitle(site, x.live === true),
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
  | { cmd: 'load'; videoId: string; start: number; play: boolean; site?: WatchSite }
  | { cmd: 'play' }
  | { cmd: 'pause' }
  | { cmd: 'seek'; to: number }
  | { cmd: 'volume'; volume?: number; muted?: boolean }
  /** 0.7.2: a "limited" player can't say how long the video is; the app passes on what it knows */
  | { cmd: 'duration'; duration: number }

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
  /** Whether the time was moving at the last step that had a fresh report (0.7.1) */
  lastMoving: boolean
  /**
   * Someone just pressed play, pause, a skip or the time line (0.7.1): the next step puts the
   * player exactly there, whatever state the player says it's in. YouTube's own state can lag
   * behind for seconds, and skips used to wait on it (so ±10 s and the time line seemed dead).
   */
  force: boolean
}

export const newSyncMemory = (): SyncMemory => ({
  lastSeekAt: 0,
  lastPlayAt: 0,
  playTries: 0,
  mutedForAutoplay: false,
  lastTime: -1,
  heardSound: false,
  lastMoving: false,
  force: false
})

/** A new state arrived (a button, or someone else's): act on it at the very next step. */
export function noteWatchChange(mem: SyncMemory, watch: WatchState | null): void {
  mem.lastSeekAt = 0
  mem.lastPlayAt = 0
  const a = watch?.last?.action
  mem.force = !!watch && (a === 'seek' || a === 'back' || a === 'forward' || a === 'play' || a === 'pause' || a === 'ended')
}

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
  const commands: PlayerCommand[] = []
  // Oct 17: YouTube's player doesn't always say "playing" right away (its state can lag behind
  // for seconds while the video already plays). A time that moves forward on its own means it's
  // playing. 0.7.1: when no new report came in since the last step (the time is exactly the
  // same), it keeps what it was, rather than "not moving" (a step right after a button used to
  // think a playing video had stopped).
  const fresh = player.time !== mem.lastTime
  const moving = fresh
    ? mem.lastTime >= 0 && player.time > mem.lastTime + 0.15 && player.time - mem.lastTime < 3
    : mem.lastMoving && player.state !== 'paused' && player.state !== 'ended'
  mem.lastTime = player.time
  mem.lastMoving = moving
  const playing = player.state === 'playing' || (moving && player.state !== 'paused' && player.state !== 'ended')
  if (playing && !player.muted) mem.heardSound = true
  const force = mem.force
  mem.force = false

  // A live stream (Twitch channel): there's no shared moment to line up, only playing or paused.
  if (watch.live) {
    if (!watch.playing && !(player.state === 'paused' || player.state === 'ended') && (force || now - mem.lastPlayAt > 1000)) {
      commands.push({ cmd: 'pause' })
      mem.lastPlayAt = now
    } else if (watch.playing && !playing && player.state !== 'buffering' && (force || now - mem.lastPlayAt > 1500)) {
      commands.push({ cmd: 'play' })
      mem.lastPlayAt = now
    }
    return { commands, status: watch.playing ? (playing ? 'sync' : 'catching') : 'paused' }
  }

  // How long the video is: the server's figure, or this player's own until the server has one
  // (so an end the server hasn't heard about is still an end, not "play it again").
  const length = watch.durationSec ?? (player.duration > 0 ? player.duration : null)
  const raw = watchPositionAt(watch, serverNow)
  const expected = length ? Math.min(raw, length) : raw
  const drift = player.time - expected
  const far = Math.abs(drift) > WATCH_DRIFT_SEC
  const ended =
    (!!length && expected >= length - 0.25) ||
    // The player itself reached the end while everyone is about there too.
    (player.state === 'ended' && !!length && expected >= length - 2)

  if (!watch.playing || ended) {
    mem.playTries = 0
    const stopped = player.state === 'paused' || player.state === 'ended' || player.state === 'cued'
    // At the end: stay on the end screen. Never seek a player that has ended: YouTube starts
    // playing again when an ended (or cued) video is asked to seek. (0.7.1: this, and the length
    // not being known yet, made videos replay by themselves.)
    if (ended) {
      // Still playing its last moments (a little behind everyone): let it reach its own end
      // screen rather than stopping it a second short.
      const finishing = playing && !!length && player.time >= length - 2.5 && raw < length + 3
      if (!stopped && !finishing && (force || now - mem.lastPlayAt > 1000)) {
        commands.push({ cmd: 'pause' })
        mem.lastPlayAt = now
      }
      return { commands, status: 'ended' }
    }
    // Anything but a player known to be stopped gets "pause" (at most once a second): a player
    // whose state didn't come through (an "unstarted" one that YouTube autoplayed) must stop too.
    if (!stopped && (force || now - mem.lastPlayAt > 1000)) {
      commands.push({ cmd: 'pause' })
      mem.lastPlayAt = now
    }
    const off = force ? Math.abs(drift) > 0.3 : Math.abs(drift) > 0.5
    if (off && (force || now - mem.lastSeekAt > 1000) && (player.state !== 'unstarted' || player.time > 0.5)) {
      commands.push({ cmd: 'seek', to: expected })
      mem.lastSeekAt = now
      // Seeking an ended or cued YouTube video makes it play: stop it again straight away.
      if (player.state === 'ended' || player.state === 'cued') commands.push({ cmd: 'pause' })
    }
    return { commands, status: 'paused' }
  }

  // Someone just skipped (or pressed play): go exactly there, whatever the player's state says.
  const loaded = player.state !== 'unstarted' || player.time > 0.5
  if (force && loaded && Math.abs(drift) > 0.3) {
    commands.push({ cmd: 'seek', to: expected + 0.2 })
    mem.lastSeekAt = now
    if (!playing) {
      commands.push({ cmd: 'play' })
      mem.lastPlayAt = now
    }
    return { commands, status: 'catching' }
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
  if (player.state === 'buffering') {
    // Loading, but somewhere else entirely (a skip landed while it was loading): go there.
    if (Math.abs(drift) > 5 && now - mem.lastSeekAt > 4000) {
      commands.push({ cmd: 'seek', to: expected })
      mem.lastSeekAt = now
    }
    return { commands, status: 'catching' }
  }

  // Should be playing but isn't (paused, ended, not started yet).
  if (force || now - mem.lastPlayAt > 1500) {
    if (far && (player.state !== 'unstarted' || player.time > 0.5)) {
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

// ---------------------------------------------------------------------------------------------
// 0.7.2: what the apps say about the player page (its problems, and the diagnostics line).

const WATCH_ERRORS: Record<number, string> = {
  2: "That link doesn't point to a video that can be played.",
  5: "This video can't be played here.",
  100: 'This video was removed or made private.',
  101: "This video can't be played outside YouTube.",
  150: "This video can't be played outside YouTube."
}

const SITE_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  vimeo: 'Vimeo',
  dailymotion: 'Dailymotion'
}

/** 0.7.2: what to say when the player page reports a problem (codes are YouTube's, or our own words) */
export function watchErrorText(code: unknown, site: string | undefined): string {
  const name = SITE_NAMES[site ?? 'youtube'] ?? 'The video site'
  if (code === 'twitch-app')
    return "Twitch can't play in the desktop app. It plays in the browser version (chat.glofly.app) and on phones."
  if (code === 'noload')
    return site === 'vimeo'
      ? "Vimeo didn't load here. Its owner may only allow it on certain websites."
      : `${name} didn't load here.`
  return (
    WATCH_ERRORS[Number(code)] ??
    (site && site !== 'youtube' ? "This video couldn't be played here." : "YouTube couldn't play this video.")
  )
}

/** What the player page last said about itself (Alt-click the sync pill to see it) */
export type PlayerDiag = {
  site?: string
  mode?: string
  from?: string
  ago?: number
  count?: number
  listens?: number
  reloads?: number
  since?: number
}

/** One line for the diagnostics: "player: ready (api) · YouTube said infoDelivery 0.3 s ago · …" */
export function watchDiagText(
  d: PlayerDiag | null,
  ready: boolean,
  report: { state: string; time: number; duration: number }
): string {
  if (!d) return `player: ${ready ? 'ready' : 'not ready'} · no word from the player page yet`
  const site = SITE_NAMES[d.site ?? 'youtube'] ?? 'site'
  const heard =
    d.from && (d.ago ?? -1) >= 0
      ? `${site} last said "${d.from}" ${d.ago} s ago (${d.count ?? 0} messages)`
      : `nothing from ${site} in ${d.since ?? 0} s`
  const parts = [
    `player: ${ready ? 'ready' : 'not ready'} (${d.mode ?? '?'})`,
    heard,
    `listening sent ${d.listens ?? 0}×`,
    d.reloads ? `reloaded ${d.reloads}×` : '',
    `state ${report.state}, ${report.time.toFixed(1)} s${report.duration ? ` of ${Math.round(report.duration)} s` : ''}`
  ]
  return parts.filter(Boolean).join(' · ')
}


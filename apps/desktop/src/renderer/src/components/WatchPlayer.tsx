import { useEffect, useRef, useState } from 'react'
import {
  newSyncMemory,
  noteWatchChange,
  watchSyncStep,
  type PlayerCommand,
  type PlayerReport,
  type ServerClock,
  type SyncStatus,
  type WatchState,
  type PlayerDiag,
  watchDiagText,
  watchErrorText
} from '@glofly/shared/watch'
import { isWeb } from '../lib/platform'
import { PlayIcon } from './icons'

// The shared video itself: the server's player page (/watch/player) in a frame, kept in step
// with everyone (watchSyncStep, twice a second). The frame itself can't be clicked: a click on
// the video is Glofly's play / pause for everyone (0.7.1: with Glofly's own round button in the
// middle while it's stopped; the site's own button under the shield did nothing). Only when the
// browser wants a tap before it plays sound does the video take taps (then the site's own button
// works).

export type PlayerInfo = {
  status: SyncStatus
  error: string | null
  muted: boolean
  time: number
  /** 0.7.2: the site's player can't be talked to here; Glofly reloads it for skips */
  limited?: boolean
  /** 0.7.2: the diagnostics line */
  diag?: string
}

type Props = Parameters<typeof Player>[0]

/**
 * 0.9.3: Twitch and Kick only play when every page above their player has a real web address.
 * The desktop app's window is a file, so for those two the player page is shown in a <webview>
 * (a page of its own at the server's address; locked down in main/watchView.ts) instead of an
 * iframe. It looks and behaves the same. The browser version always uses the iframe.
 */
export default function WatchPlayer(props: Props): React.JSX.Element {
  const view = !isWeb && (props.watch.site === 'twitch' || props.watch.site === 'kick')
  return <Player key={view ? 'view' : 'frame'} {...props} asView={view} />
}

/** The <webview> element (Electron), as far as this file uses it. */
type WebViewElement = HTMLElement & {
  executeJavaScript: (code: string) => Promise<unknown>
}

function Player({
  asView = false,
  playerUrl,
  watch,
  clock,
  volume,
  unmute,
  onInfo,
  onDuration,
  canControl,
  onToggle,
  onRefused
}: {
  playerUrl: string
  watch: WatchState
  clock: ServerClock
  /** 0–100, this person's own video volume (voices aren't affected) */
  volume: number
  /** Goes up when the person asks for sound (after the browser started the video muted) */
  unmute: number
  onInfo: (info: PlayerInfo) => void
  /** YouTube said how long the video is (and its title) */
  onDuration: (videoId: string, durationSec: number, title: string) => void
  /** May this person play and pause? */
  canControl: boolean
  /** A click on the video: play or pause for everyone */
  onToggle: () => void
  /** A click on the video by someone who may not play or pause it */
  onRefused: () => void
  /** Shown in a <webview> (desktop, Twitch and Kick) */
  asView?: boolean
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const view = useRef<WebViewElement>(null)
  const viewReady = useRef(false)
  const origin = new URL(playerUrl).origin
  const watchRef = useRef(watch)
  const volumeRef = useRef(volume)
  const cbRef = useRef({ onInfo, onDuration })
  const [tapToStart, setTapToStart] = useState(false)
  useEffect(() => {
    watchRef.current = watch
    volumeRef.current = volume
    cbRef.current = { onInfo, onDuration }
  })

  // What the player page last said, and what's been asked of it.
  const page = useRef({
    loaded: false,
    ready: false,
    videoId: null as string | null,
    report: { state: 'unstarted', time: 0, duration: 0, muted: false } as PlayerReport,
    reported: null as string | null,
    error: null as string | null,
    mem: newSyncMemory(),
    unmutedAt: 0,
    limited: false,
    diag: null as PlayerDiag | null
  })

  const send = (c: PlayerCommand): void => {
    if (asView) {
      // The command is our own plain data, written out as JSON (never text from anyone else).
      if (viewReady.current)
        void view.current
          ?.executeJavaScript(
            `window.gloflyWatch && window.gloflyWatch(${JSON.stringify({ glofly: 'watch', ...c })})`
          )
          .catch(() => undefined)
      return
    }
    frame.current?.contentWindow?.postMessage({ glofly: 'watch', ...c }, origin)
  }

  /** Loads the current video (when the page is ready, and whenever the video changes). */
  const loadCurrent = (): void => {
    const p = page.current
    const w = watchRef.current
    if (!p.loaded || p.videoId === w.videoId) return
    p.videoId = w.videoId
    p.ready = false
    p.error = null
    p.limited = false
    p.diag = null
    p.reported = null
    p.mem = newSyncMemory()
    p.report = { state: 'unstarted', time: 0, duration: 0, muted: false }
    const start = Math.floor(
      w.playing ? w.position + Math.max(0, clock.now() - w.at) / 1000 : w.position
    )
    send({ cmd: 'load', videoId: w.videoId, start, play: w.playing, site: w.site ?? 'youtube' })
  }

  /** One step: line the player up with everyone and say how it's going. */
  const tick = (): void => {
    const p = page.current
    const w = watchRef.current
    const diag = watchDiagText(p.diag, p.ready, p.report)
    if (p.error) {
      cbRef.current.onInfo({ status: 'catching', error: p.error, muted: false, time: 0, diag })
      return
    }
    if (!p.ready || p.videoId !== w.videoId) {
      cbRef.current.onInfo({
        status: 'catching',
        error: null,
        muted: false,
        time: w.position,
        diag
      })
      return
    }
    // A limited player can't say how long the video is: pass on what the server knows.
    if (p.limited && w.durationSec && !p.report.duration)
      send({ cmd: 'duration', duration: w.durationSec })
    // The desktop app always lets videos play with sound: never mute it "for autoplay" there.
    const { commands, status } = watchSyncStep(w, clock.now(), p.report, p.mem, Date.now(), {
      neverMute: !isWeb
    })
    for (const c of commands) send(c)
    // Muted without Glofly asking (YouTube muting itself): turn the sound back on (every few seconds at most).
    if (
      p.report.muted &&
      !p.mem.mutedForAutoplay &&
      volumeRef.current > 0 &&
      status === 'sync' &&
      Date.now() - p.unmutedAt > 3000
    ) {
      p.unmutedAt = Date.now()
      send({ cmd: 'volume', volume: volumeRef.current, muted: false })
    }
    setTapToStart(status === 'blocked')
    cbRef.current.onInfo({
      status,
      error: null,
      muted: p.report.muted && volumeRef.current > 0,
      time: p.report.time,
      limited: p.limited,
      diag
    })
  }

  // Messages from the player page (only from our frame, only from the server's address).
  useEffect(() => {
    const handle = (d: Record<string, unknown> | null): void => {
      if (!d || d.glofly !== 'watch') return
      const p = page.current
      if (d.ev === 'loaded') {
        p.loaded = true
        p.videoId = null
        loadCurrent()
      } else if (d.ev === 'diag') {
        if (d.diag && typeof d.diag === 'object') p.diag = d.diag as PlayerDiag
      } else if (d.ev === 'ready') {
        p.ready = true
        p.limited = d.limited === true
        send({
          cmd: 'volume',
          volume: volumeRef.current,
          muted: p.mem.mutedForAutoplay || undefined
        })
      } else if (d.ev === 'state') {
        const states = ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued']
        p.report = {
          state: (states.includes(d.state as string)
            ? d.state
            : 'unstarted') as PlayerReport['state'],
          time: typeof d.time === 'number' && Number.isFinite(d.time) ? d.time : 0,
          duration: typeof d.duration === 'number' && Number.isFinite(d.duration) ? d.duration : 0,
          muted: d.muted === true
        }
        if (d.diag && typeof d.diag === 'object') p.diag = d.diag as PlayerDiag
        if (typeof d.limited === 'boolean') p.limited = d.limited
        const w = watchRef.current
        if (p.report.duration > 0 && p.reported !== w.videoId && p.videoId === w.videoId) {
          p.reported = w.videoId
          if (w.durationSec === null || w.title === 'YouTube video') {
            cbRef.current.onDuration(
              w.videoId,
              p.report.duration,
              typeof d.title === 'string' ? d.title : ''
            )
          }
        }
      } else if (d.ev === 'error') {
        p.error = watchErrorText(d.code, watchRef.current.site)
        tick()
      }
    }
    if (asView) {
      const el = view.current
      if (!el) return
      // From the <webview>'s preload (watchHost.ts): only its 'watch' channel.
      const onIpc = (e: Event): void => {
        const ev = e as Event & { channel?: string; args?: unknown[] }
        if (ev.channel !== 'watch') return
        const d = ev.args?.[0]
        if (d && typeof d === 'object') handle(d as Record<string, unknown>)
      }
      const onReady = (): void => {
        viewReady.current = true
      }
      const onFail = (): void => handle({ glofly: 'watch', ev: 'error', code: 'noload' })
      el.addEventListener('ipc-message', onIpc)
      el.addEventListener('dom-ready', onReady)
      el.addEventListener('did-fail-load', onFail)
      return () => {
        el.removeEventListener('ipc-message', onIpc)
        el.removeEventListener('dom-ready', onReady)
        el.removeEventListener('did-fail-load', onFail)
      }
    }
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow) return
      handle(e.data as Record<string, unknown> | null)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, asView])

  useEffect(() => {
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new video, or play / pause / a skip from someone: act on it now rather than at the next step.
  useEffect(() => {
    loadCurrent()
    noteWatchChange(page.current.mem, watchRef.current)
    tick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch.videoId, watch.seq])

  // "Turn on sound" after the browser started the video muted.
  useEffect(() => {
    if (!unmute) return
    page.current.mem.mutedForAutoplay = false
    send({ cmd: 'volume', volume: volumeRef.current, muted: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unmute])

  // Your own video volume.
  useEffect(() => {
    if (page.current.ready) send({ cmd: 'volume', volume })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume])

  return (
    <div className="watch-player">
      {asView ? (
        <webview
          ref={view as React.Ref<HTMLElement>}
          className="watch-player-view"
          src={playerUrl}
          // eslint-disable-next-line react/no-unknown-property -- Electron's <webview> attribute
          partition="watch-together"
          title={`Shared video: ${watch.title}`}
          tabIndex={-1}
        />
      ) : (
        <iframe
          ref={frame}
          src={playerUrl}
          title={`Shared video: ${watch.title}`}
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin"
          tabIndex={-1}
        />
      )}
      {/* Clicks on the video are Glofly's play / pause, except when a tap is needed to start. */}
      {/* Dailymotion's new player can't be talked to: its own buttons stay usable (0.7.2). */}
      {!tapToStart && watch.site !== 'dailymotion' && watch.site !== 'kick' && (
        <div
          className={
            canControl ? 'watch-player-shield watch-player-shield--can' : 'watch-player-shield'
          }
          aria-hidden="true"
          onClick={() => (canControl ? onToggle() : onRefused())}
        >
          {!watch.playing && (
            <span className="watch-center-play">
              <PlayIcon size={30} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

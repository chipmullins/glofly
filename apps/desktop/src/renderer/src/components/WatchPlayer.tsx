import { useEffect, useRef, useState } from 'react'
import {
  newSyncMemory,
  watchSyncStep,
  type PlayerCommand,
  type PlayerReport,
  type ServerClock,
  type SyncStatus,
  type WatchState
} from '@glofly/shared/watch'
import { isWeb } from '../lib/platform'

// The shared video itself: the server's player page (/watch/player) in a frame, kept in step
// with everyone (watchSyncStep, twice a second). The frame can't be clicked: play, pause and
// skips go through Glofly's own buttons so everyone stays together. Only when the browser
// wants a tap before it plays sound does the video take taps (then YouTube's own button works).

const ERRORS: Record<number, string> = {
  2: "That link doesn't point to a video YouTube can play.",
  5: "This video can't be played here.",
  100: 'This video was removed or made private.',
  101: "This video can't be played outside YouTube.",
  150: "This video can't be played outside YouTube."
}

export type PlayerInfo = { status: SyncStatus; error: string | null; muted: boolean; time: number }

export default function WatchPlayer({
  playerUrl,
  watch,
  clock,
  volume,
  unmute,
  onInfo,
  onDuration
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
}): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
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
    unmutedAt: 0
  })

  const send = (c: PlayerCommand): void => {
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
    p.reported = null
    p.mem = newSyncMemory()
    p.report = { state: 'unstarted', time: 0, duration: 0, muted: false }
    const start = Math.floor(
      w.playing ? w.position + Math.max(0, clock.now() - w.at) / 1000 : w.position
    )
    send({ cmd: 'load', videoId: w.videoId, start, play: w.playing })
  }

  /** One step: line the player up with everyone and say how it's going. */
  const tick = (): void => {
    const p = page.current
    const w = watchRef.current
    if (p.error) {
      cbRef.current.onInfo({ status: 'catching', error: p.error, muted: false, time: 0 })
      return
    }
    if (!p.ready || p.videoId !== w.videoId) {
      cbRef.current.onInfo({ status: 'catching', error: null, muted: false, time: w.position })
      return
    }
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
      time: p.report.time
    })
  }

  // Messages from the player page (only from our frame, only from the server's address).
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow) return
      const d = e.data as Record<string, unknown> | null
      if (!d || d.glofly !== 'watch') return
      const p = page.current
      if (d.ev === 'loaded') {
        p.loaded = true
        p.videoId = null
        loadCurrent()
      } else if (d.ev === 'ready') {
        p.ready = true
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
        p.error = ERRORS[Number(d.code)] ?? "YouTube couldn't play this video."
        tick()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin])

  useEffect(() => {
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new video, or play / pause / a skip from someone: act on it now rather than at the next step.
  useEffect(() => {
    loadCurrent()
    page.current.mem.lastSeekAt = 0
    page.current.mem.lastPlayAt = 0
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
      <iframe
        ref={frame}
        src={playerUrl}
        title={`Shared video: ${watch.title}`}
        allow="autoplay; encrypted-media; picture-in-picture"
        referrerPolicy="strict-origin"
        tabIndex={-1}
      />
      {/* Clicks on the video go to Glofly's buttons, except when a tap is needed to start. */}
      {!tapToStart && <div className="watch-player-shield" aria-hidden="true" />}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { newSyncMemory, watchSyncStep, type PlayerCommand, type PlayerReport, type SyncStatus, type WatchState } from '@glofly/shared'
import { reportWatch, watchClock } from './watch'

// Keeps the phone's video player (the server's /watch/player page in a web view, or an iframe in
// the browser preview) in step with everyone: the same watchSyncStep the desktop app uses.

const ERRORS: Record<number, string> = {
  2: "That link doesn't point to a video YouTube can play.",
  5: "This video can't be played here.",
  100: 'This video was removed or made private.',
  101: "This video can't be played outside YouTube.",
  150: "This video can't be played outside YouTube.",
}

export type PlayerState = { status: SyncStatus; error: string | null; muted: boolean }

/** `send` delivers a command to the player page; feed what it says to `onMessage`. */
export function usePlayerSync(watch: WatchState, send: (c: PlayerCommand) => void, unmute: number) {
  const [state, setState] = useState<PlayerState>({ status: 'catching', error: null, muted: false })
  const w = useRef(watch)
  const sendRef = useRef(send)
  useEffect(() => {
    w.current = watch
    sendRef.current = send
  })
  const page = useRef({ loaded: false, ready: false, videoId: null as string | null, reported: null as string | null, error: null as string | null, report: { state: 'unstarted', time: 0, duration: 0, muted: false } as PlayerReport, mem: newSyncMemory() })

  const loadCurrent = () => {
    const p = page.current
    const cur = w.current
    if (!p.loaded || p.videoId === cur.videoId) return
    Object.assign(p, { videoId: cur.videoId, ready: false, error: null, reported: null, mem: newSyncMemory(), report: { state: 'unstarted', time: 0, duration: 0, muted: false } })
    const start = Math.floor(cur.playing ? cur.position + Math.max(0, watchClock.now() - cur.at) / 1000 : cur.position)
    sendRef.current({ cmd: 'load', videoId: cur.videoId, start, play: cur.playing })
  }

  const tick = () => {
    const p = page.current
    const cur = w.current
    if (p.error) return setState({ status: 'catching', error: p.error, muted: false })
    if (!p.ready || p.videoId !== cur.videoId) return setState((s) => (s.status === 'catching' && !s.error ? s : { status: 'catching', error: null, muted: false }))
    const { commands, status } = watchSyncStep(cur, watchClock.now(), p.report, p.mem)
    for (const c of commands) sendRef.current(c)
    const muted = p.report.muted && p.mem.mutedForAutoplay
    setState((s) => (s.status === status && s.muted === muted && !s.error ? s : { status, error: null, muted }))
  }

  const onMessage = (d: Record<string, unknown> | null) => {
    if (!d || d.glofly !== 'watch') return
    const p = page.current
    if (d.ev === 'loaded') {
      p.loaded = true
      p.videoId = null
      loadCurrent()
    } else if (d.ev === 'ready') {
      p.ready = true
    } else if (d.ev === 'state') {
      const states = ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued']
      p.report = {
        state: (states.includes(d.state as string) ? d.state : 'unstarted') as PlayerReport['state'],
        time: typeof d.time === 'number' && Number.isFinite(d.time) ? d.time : 0,
        duration: typeof d.duration === 'number' && Number.isFinite(d.duration) ? d.duration : 0,
        muted: d.muted === true,
      }
      const cur = w.current
      if (p.report.duration > 0 && p.reported !== cur.videoId && p.videoId === cur.videoId) {
        p.reported = cur.videoId
        if (cur.durationSec === null || cur.title === 'YouTube video') reportWatch(cur.videoId, p.report.duration, typeof d.title === 'string' && d.title ? d.title : undefined)
      }
    } else if (d.ev === 'error') {
      p.error = ERRORS[Number(d.code)] ?? "YouTube couldn't play this video."
      tick()
    }
  }

  useEffect(() => {
    const t = setInterval(tick, 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    loadCurrent()
    page.current.mem.lastSeekAt = 0
    page.current.mem.lastPlayAt = 0
    tick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watch.videoId, watch.seq])
  useEffect(() => {
    if (!unmute) return
    page.current.mem.mutedForAutoplay = false
    sendRef.current({ cmd: 'volume', volume: 100, muted: false })
  }, [unmute])

  return { state, onMessage }
}

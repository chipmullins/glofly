import { useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { newSyncMemory, noteWatchChange, watchDiagText, watchErrorText, watchSyncStep, type PlayerCommand, type PlayerDiag, type PlayerReport, type SyncStatus, type WatchState } from '@glofly/shared'
import { reportWatch, watchClock } from './watch'

// Keeps the phone's video player (the server's /watch/player page in a web view, or an iframe in
// the browser preview) in step with everyone: the same watchSyncStep the desktop app uses.

export type PlayerState = {
  status: SyncStatus
  error: string | null
  muted: boolean
  /** 0.7.2: the site's player can't be talked to here; Glofly reloads it for skips */
  limited?: boolean
  /** 0.7.2: the diagnostics line (long-press the sync pill) */
  diag?: string
}

/** `send` delivers a command to the player page; feed what it says to `onMessage`. */
export function usePlayerSync(watch: WatchState, send: (c: PlayerCommand) => void, unmute: number) {
  const [state, setState] = useState<PlayerState>({ status: 'catching', error: null, muted: false })
  const w = useRef(watch)
  const sendRef = useRef(send)
  useEffect(() => {
    w.current = watch
    sendRef.current = send
  })
  const page = useRef({ loaded: false, ready: false, videoId: null as string | null, reported: null as string | null, error: null as string | null, report: { state: 'unstarted', time: 0, duration: 0, muted: false } as PlayerReport, mem: newSyncMemory(), soundAskedAt: 0, limited: false, diag: null as PlayerDiag | null })

  const loadCurrent = () => {
    const p = page.current
    const cur = w.current
    if (!p.loaded || p.videoId === cur.videoId) return
    Object.assign(p, { videoId: cur.videoId, ready: false, error: null, reported: null, limited: false, diag: null, mem: newSyncMemory(), soundAskedAt: 0, report: { state: 'unstarted', time: 0, duration: 0, muted: false } })
    const start = Math.floor(cur.playing ? cur.position + Math.max(0, watchClock.now() - cur.at) / 1000 : cur.position)
    sendRef.current({ cmd: 'load', videoId: cur.videoId, start, play: cur.playing, site: cur.site ?? 'youtube' })
  }

  const tick = () => {
    const p = page.current
    const cur = w.current
    const diag = watchDiagText(p.diag, p.ready, p.report)
    if (p.error) return setState({ status: 'catching', error: p.error, muted: false, diag })
    if (!p.ready || p.videoId !== cur.videoId) return setState((s) => (s.status === 'catching' && !s.error && s.diag === diag ? s : { status: 'catching', error: null, muted: false, diag }))
    if (p.limited && cur.durationSec && !p.report.duration) sendRef.current({ cmd: 'duration', duration: cur.durationSec })
    // 0.7.1: the phone apps' web view always allows sound (no tap needed), so the video is never
    // muted "for autoplay" there (only the browser preview can need that).
    const { commands, status } = watchSyncStep(cur, watchClock.now(), p.report, p.mem, Date.now(), { neverMute: Platform.OS !== 'web' })
    for (const c of commands) sendRef.current(c)
    // YouTube's player can start muted by itself (its own autoplay rules, seen in phone web views),
    // not only when the sync step muted it. 0.7.1: ask for sound again every few seconds while it
    // plays muted (once per video wasn't enough: "sometimes there's no sound"). Whenever it is
    // still muted, "Turn on sound" shows.
    const playingNow = p.report.state === 'playing' || status === 'sync'
    if (p.report.muted && !p.mem.mutedForAutoplay && playingNow && Date.now() - p.soundAskedAt > 3000) {
      p.soundAskedAt = Date.now()
      sendRef.current({ cmd: 'volume', volume: 100, muted: false })
    }
    const muted = p.report.muted
    const limited = p.limited
    setState((s) => (s.status === status && s.muted === muted && !s.error && s.limited === limited && s.diag === diag ? s : { status, error: null, muted, limited, diag }))
  }

  const onMessage = (d: Record<string, unknown> | null) => {
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
    } else if (d.ev === 'state') {
      const states = ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued']
      p.report = {
        state: (states.includes(d.state as string) ? d.state : 'unstarted') as PlayerReport['state'],
        time: typeof d.time === 'number' && Number.isFinite(d.time) ? d.time : 0,
        duration: typeof d.duration === 'number' && Number.isFinite(d.duration) ? d.duration : 0,
        muted: d.muted === true,
      }
      if (d.diag && typeof d.diag === 'object') p.diag = d.diag as PlayerDiag
      if (typeof d.limited === 'boolean') p.limited = d.limited
      const cur = w.current
      if (p.report.duration > 0 && p.reported !== cur.videoId && p.videoId === cur.videoId) {
        p.reported = cur.videoId
        if (cur.durationSec === null || / video$/.test(cur.title)) reportWatch(cur.videoId, p.report.duration, typeof d.title === 'string' && d.title ? d.title : undefined)
      }
    } else if (d.ev === 'error') {
      p.error = watchErrorText(d.code, w.current.site)
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
    noteWatchChange(page.current.mem, w.current)
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

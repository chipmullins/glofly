import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ServerClock,
  type WatchControl,
  type WatchState,
  type WatchUpdate
} from '@glofly/shared/watch'
import type { ApiResult, WatchControlAction } from '../../../preload/api-types'

// Watch Together (0.5.0): what a call is watching, kept up to date from the server, and the
// buttons that change it. Every button goes through the server, which tells everyone (this
// device too) the new state; the answer to the button is used straight away so it feels instant.

export type WatchValue = {
  watch: WatchState | null
  /** The server's clock, for working out where the video should be */
  clock: ServerClock
  /** Asked the server at least once */
  loaded: boolean
  start: (link: string, control: WatchControl) => Promise<ApiResult<WatchUpdate>>
  control: (action: WatchControlAction, to?: number) => void
  setControl: (control: WatchControl) => void
  stop: () => void
  react: (reaction: Parameters<typeof window.glofly.watch.react>[1]) => void
  report: (videoId: string, durationSec: number, title?: string) => void
}

/**
 * The video a call is watching. `onProblem` gets the server's explanation when a button is
 * refused ("Only Jordan can pause and skip this video.").
 */
export function useWatch(callId: string | null, onProblem: (message: string) => void): WatchValue {
  // Kept with the call it belongs to: another call's state never shows.
  const [state, setState] = useState<{
    callId: string | null
    watch: WatchState | null
    loaded: boolean
  }>({
    callId: null,
    watch: null,
    loaded: false
  })
  const [clock] = useState(() => new ServerClock())
  const watch = state.callId === callId ? state.watch : null
  const loaded = state.callId === callId && state.loaded
  const seqRef = useRef(0)
  const callRef = useRef(callId)
  const problemRef = useRef(onProblem)
  useEffect(() => {
    problemRef.current = onProblem
  })

  /** Takes an update unless an even newer one is already here. */
  const take = useCallback(
    (u: WatchUpdate, sentAt?: number) => {
      if (u.callId !== callRef.current) return
      clock.note(u.serverNow, sentAt)
      // An older state never wins over a newer one (stopping resets the count: a new video
      // starts again from 1).
      if (u.watch && u.watch.seq < seqRef.current) return
      seqRef.current = u.watch?.seq ?? 0
      setState((s) => ({
        callId: u.callId,
        watch: u.watch,
        loaded: s.callId === u.callId && s.loaded
      }))
    },
    [clock]
  )

  const refresh = useCallback(async () => {
    const id = callRef.current
    if (!id) return
    const sentAt = Date.now()
    const r = await window.glofly.watch.get(id)
    if (r.ok && id === callRef.current) {
      seqRef.current = 0 // the server's answer is the truth (it may have restarted)
      take(r.data, sentAt)
      setState((s) => (s.callId === id ? { ...s, loaded: true } : s))
    }
  }, [take])

  useEffect(() => {
    callRef.current = callId
    seqRef.current = 0
    if (!callId) return
    void refresh()
    return window.glofly.onEvent((e) => {
      if (e.type === 'watch:updated' && e.callId === callId) take(e)
      if (e.type === 'connection' && e.connected) void refresh()
    })
  }, [callId, refresh, take])

  /** Runs a button through the server; the answer is shown at once. */
  const run = useCallback(
    async (
      ask: (id: string) => Promise<ApiResult<WatchUpdate>>
    ): Promise<ApiResult<WatchUpdate>> => {
      const id = callRef.current
      if (!id) return { ok: false, error: 'invalid', message: 'Not in a call.' }
      const sentAt = Date.now()
      const r = await ask(id)
      if (r.ok) take(r.data, sentAt)
      else if (r.error !== 'unauthorized') problemRef.current(r.message)
      return r
    },
    [take]
  )

  const start = useCallback(
    async (link: string, control: WatchControl) => {
      const id = callRef.current
      if (!id) return { ok: false as const, error: 'invalid' as const, message: 'Not in a call.' }
      const sentAt = Date.now()
      const r = await window.glofly.watch.start(id, link, control)
      if (r.ok) take(r.data, sentAt)
      return r // the Start dialog shows the problem itself
    },
    [take]
  )

  return {
    watch,
    clock,
    loaded,
    start,
    control: (action, to) => void run((id) => window.glofly.watch.control(id, action, to)),
    setControl: (control) => void run((id) => window.glofly.watch.settings(id, control)),
    stop: () => void run((id) => window.glofly.watch.stop(id)),
    react: (reaction) => {
      const id = callRef.current
      if (!id) return
      void window.glofly.watch.react(id, reaction).then((r) => {
        if (!r.ok && r.error === 'too_many_requests') problemRef.current(r.message)
      })
    },
    report: (videoId, durationSec, title) => {
      const id = callRef.current
      if (id) void window.glofly.watch.report(id, videoId, durationSec, title)
    }
  }
}
